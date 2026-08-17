import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { Pox5EventName } from '@stacks/codec';
import { PgSqlClient } from '@stacks/api-toolkit';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';

/**
 * GET /extended/v3/staking/cycles/current/signers — the current cycle's reward set (`pox_sets`)
 * joined with the signer manager key bindings (`signer_key_grants`: register-signer /
 * grant-signer-key / revoke-signer-grant) that were effective when the cycle's reward set was
 * calculated, i.e. bindings strictly before the cycle's anchor block. Bindings at or after the
 * anchor surface as pending key updates effective next cycle.
 */

const MANAGER_A = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.manager-a';
const MANAGER_B = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5.manager-b';
const MANAGER_C = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG.manager-c';
const MANAGER_D = 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC.manager-d';
const MANAGER_E = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.manager-e';

const KEY1 = '0x' + '02'.repeat(33);
const KEY2 = '0x' + '03'.repeat(33);
// Seeded into the set without a binding. Impossible on a real chain (stake can
// only be committed under a bound key), but the endpoint should degrade to an
// empty manager list rather than erroring if the data is ever inconsistent.
const KEY4 = '0x' + '04'.repeat(33);
const KEY5 = '0x' + '05'.repeat(33); // pending rotation target
const KEY6 = '0x' + '06'.repeat(33); // pending rotation target that gets revoked
const KEY9 = '0x' + '09'.repeat(33); // bound, never in the set

const CYCLE = 100;
const ANCHOR_HEIGHT = 10;

const hash = (n: number) => '0x' + n.toString(16).padStart(2, '0');
const txId = (n: number) => '0x' + n.toString(16).padStart(2, '0').repeat(32);

describe('pox-5 cycle signers', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  function bindingBlock(args: { height: number; name: Pox5EventName; data: unknown }) {
    return new TestBlockBuilder({
      block_height: args.height,
      block_hash: hash(args.height),
      index_block_hash: hash(args.height),
      parent_block_hash: hash(args.height - 1),
      parent_index_block_hash: hash(args.height - 1),
    })
      .addTx({ tx_id: txId(args.height) })
      .addTxPox5Event({ name: args.name, data: args.data })
      .build();
  }

  async function seedCycle(
    cycle: number,
    anchorHeight: number,
    signers: { key: string; weight: number; stacked: string }[]
  ) {
    const totalWeight = signers.reduce((acc, s) => acc + s.weight, 0);
    const totalStacked = signers.reduce((acc, s) => acc + BigInt(s.stacked), 0n);
    await client`
      INSERT INTO pox_cycles (
        block_height, index_block_hash, parent_index_block_hash, cycle_number,
        canonical, total_weight, total_stacked_amount, total_signers
      )
      VALUES (
        ${anchorHeight}, ${hash(anchorHeight)}, ${hash(anchorHeight - 1)}, ${cycle},
        true, ${totalWeight}, ${totalStacked}, ${signers.length}
      )
    `;
    for (const s of signers) {
      await client`
        INSERT INTO pox_sets (
          block_height, index_block_hash, parent_index_block_hash, cycle_number,
          pox_ustx_threshold, canonical, signing_key, weight, stacked_amount,
          weight_percent, stacked_amount_percent, total_weight, total_stacked_amount
        )
        VALUES (
          ${anchorHeight}, ${hash(anchorHeight)}, ${hash(anchorHeight - 1)}, ${cycle},
          1000000, true, ${s.key}, ${s.weight}, ${s.stacked},
          ${(s.weight / totalWeight) * 100},
          ${Number((BigInt(s.stacked) * 100n) / totalStacked)},
          ${totalWeight}, ${totalStacked}
        )
      `;
    }
  }

  async function getCycleSigners(query: Record<string, string> = {}) {
    const res = await supertest(api.server)
      .get('/extended/v3/staking/cycles/current/signers')
      .query(query);
    return res;
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false, skipMigrations: true });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('404 when no PoX cycle exists', async () => {
    const res = await getCycleSigners();
    assert.equal(res.status, 404, res.text);
  });

  test('only `current` is accepted as the cycle number', async () => {
    // The route is generic (`/staking/cycles/:cycle_number/signers`) so it can
    // later serve previous cycles, but for now the param only allows `current`.
    const res = await supertest(api.server).get('/extended/v3/staking/cycles/100/signers');
    assert.equal(res.status, 400, res.text);
  });

  test('cycle signers with registered, granted, revoked, and pending keys', async () => {
    // Registrations before the anchor block (effective bindings for the cycle):
    // 1: MANAGER_A registers KEY1.
    await db.update(
      bindingBlock({
        height: 1,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_A, signer_key: KEY1 },
      })
    );
    // 2: KEY1 granted to MANAGER_B, 3: which registers it (multi-manager key).
    await db.update(
      bindingBlock({
        height: 2,
        name: Pox5EventName.GrantSignerKey,
        data: { signer_key: KEY1, signer_manager: MANAGER_B, auth_id: '111' },
      })
    );
    await db.update(
      bindingBlock({
        height: 3,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_B, signer_key: KEY1 },
      })
    );
    // 4: KEY2 granted to MANAGER_C, 5: which registers it.
    await db.update(
      bindingBlock({
        height: 4,
        name: Pox5EventName.GrantSignerKey,
        data: { signer_key: KEY2, signer_manager: MANAGER_C, auth_id: '555' },
      })
    );
    await db.update(
      bindingBlock({
        height: 5,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_C, signer_key: KEY2 },
      })
    );
    // 6: KEY2 granted to MANAGER_D, 7: then revoked. D never registers, so it is
    // not a binding either way and the revoked grant is not live.
    await db.update(
      bindingBlock({
        height: 6,
        name: Pox5EventName.GrantSignerKey,
        data: { signer_key: KEY2, signer_manager: MANAGER_D, auth_id: '222' },
      })
    );
    await db.update(
      bindingBlock({
        height: 7,
        name: Pox5EventName.RevokeSignerGrant,
        data: { signer_key: KEY2, signer_manager: MANAGER_D },
      })
    );
    // 8: KEY9 granted to MANAGER_E — a grant alone binds nothing, and E never
    // registers, so E must not appear as a manager anywhere.
    await db.update(
      bindingBlock({
        height: 8,
        name: Pox5EventName.GrantSignerKey,
        data: { signer_key: KEY9, signer_manager: MANAGER_E, auth_id: '333' },
      })
    );
    // 9: KEY5 granted to MANAGER_A — a live authorization A may register later.
    await db.update(
      bindingBlock({
        height: 9,
        name: Pox5EventName.GrantSignerKey,
        data: { signer_key: KEY5, signer_manager: MANAGER_A, auth_id: '444' },
      })
    );

    // The cycle's reward set, anchored at block 10.
    await seedCycle(CYCLE, ANCHOR_HEIGHT, [
      { key: KEY1, weight: 5, stacked: '500000000000' },
      { key: KEY2, weight: 3, stacked: '300000000000' },
      { key: KEY4, weight: 1, stacked: '100000000000' },
    ]);

    // Events at/after the anchor:
    // 10: MANAGER_A registers KEY5 — a pending key update, effective next cycle.
    await db.update(
      bindingBlock({
        height: 10,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_A, signer_key: KEY5 },
      })
    );
    // 11: MANAGER_B's grant for KEY1 is revoked — revokes only end grants and
    // never unbind a registration, so B stays a manager of KEY1 (with its
    // grant no longer active).
    await db.update(
      bindingBlock({
        height: 11,
        name: Pox5EventName.RevokeSignerGrant,
        data: { signer_key: KEY1, signer_manager: MANAGER_B },
      })
    );
    // 12/13: MANAGER_C receives a grant for KEY6 but it gets revoked — not a
    // live authorization, and never a pending update (only registrations are).
    await db.update(
      bindingBlock({
        height: 12,
        name: Pox5EventName.GrantSignerKey,
        data: { signer_key: KEY6, signer_manager: MANAGER_C, auth_id: '666' },
      })
    );
    await db.update(
      bindingBlock({
        height: 13,
        name: Pox5EventName.RevokeSignerGrant,
        data: { signer_key: KEY6, signer_manager: MANAGER_C },
      })
    );

    const res = await getCycleSigners();
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.total, 3);
    assert.equal(body.results.length, 3);

    // Ordered by weight descending.
    const [signer1, signer2, signer4] = body.results;

    assert.equal(signer1.signing_key, KEY1);
    // Weight 5 of 9 total, 500B of 900B total stacked.
    assert.deepEqual(signer1.weight, { amount: 5, percent: (5 / 9) * 100 });
    assert.deepEqual(signer1.staked_stx, { amount: '500000000000', percent: 55 });
    // Managers sorted by principal ascending: MANAGER_B ('ST1…') < MANAGER_A ('ST3…').
    assert.deepEqual(
      signer1.signer_managers.map((m: { signer_manager: string }) => m.signer_manager),
      [MANAGER_B, MANAGER_A]
    );
    const [entryB, entryA] = signer1.signer_managers;
    // MANAGER_A self-registered KEY1 without a grant, holds a live
    // authorization for KEY5, and registered it after the anchor, so the
    // rotation is pending and effective next cycle.
    assert.equal(entryA.registered_at.block_height, 1);
    assert.equal(entryA.registered_at.tx_id, txId(1));
    assert.equal(typeof entryA.registered_at.bitcoin_block_height, 'number');
    assert.deepEqual(entryA.granted_keys, [
      { signer_key: KEY5, auth_id: '444', tx_id: txId(9) },
    ]);
    assert.equal(entryA.grant_active, false);
    assert.deepEqual(entryA.pending_key_update, {
      signer_key: KEY5,
      effective_cycle: CYCLE + 1,
      tx_id: txId(10),
    });
    // MANAGER_B's grant for KEY1 was revoked post-anchor: it stays bound (a
    // revoke never unbinds a registration) but its grant is no longer active,
    // and no pending key update is created.
    assert.equal(entryB.registered_at.block_height, 3);
    assert.deepEqual(entryB.granted_keys, []);
    assert.equal(entryB.grant_active, false);
    assert.equal(entryB.pending_key_update, null);

    // KEY2: MANAGER_C bound via registration with its grant still live;
    // MANAGER_D only ever held a (revoked) grant and never registered, so it
    // is not a manager.
    assert.equal(signer2.signing_key, KEY2);
    assert.deepEqual(
      signer2.signer_managers.map((m: { signer_manager: string }) => m.signer_manager),
      [MANAGER_C]
    );
    // MANAGER_C's KEY2 grant is live; its grant for KEY6 was revoked (not
    // live) and was never registered (not pending).
    assert.deepEqual(signer2.signer_managers[0].granted_keys, [
      { signer_key: KEY2, auth_id: '555', tx_id: txId(4) },
    ]);
    assert.equal(signer2.signer_managers[0].grant_active, true);
    assert.equal(signer2.signer_managers[0].pending_key_update, null);

    // KEY4 was seeded without bindings (impossible on a real chain) — the
    // endpoint degrades to an empty manager list instead of erroring.
    assert.equal(signer4.signing_key, KEY4);
    assert.deepEqual(signer4.signer_managers, []);
  });

  test('registrations after a newer cycle anchor stop being pending for it', async () => {
    // MANAGER_A registers KEY1 before cycle 100's anchor, then registers KEY5
    // before cycle 101's anchor. For current cycle 101, KEY5 is effective (not
    // pending) and matches the new reward set entry.
    await db.update(
      bindingBlock({
        height: 1,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_A, signer_key: KEY1 },
      })
    );
    await seedCycle(CYCLE, 2, [{ key: KEY1, weight: 1, stacked: '100000000000' }]);
    await db.update(
      bindingBlock({
        height: 2,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_A, signer_key: KEY5 },
      })
    );
    await seedCycle(CYCLE + 1, 3, [{ key: KEY5, weight: 1, stacked: '100000000000' }]);

    const res = await getCycleSigners();
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.total, 1);
    const [signer] = body.results;
    assert.equal(signer.signing_key, KEY5);
    assert.equal(signer.signer_managers.length, 1);
    assert.equal(signer.signer_managers[0].signer_manager, MANAGER_A);
    assert.equal(signer.signer_managers[0].registered_at.block_height, 2);
    assert.equal(signer.signer_managers[0].pending_key_update, null);
  });

  test('registrations overwrite each other; grants and revokes never change bindings', async () => {
    // MANAGER_A registers KEY1 then registers KEY2 — the signers map is keyed
    // by principal, so only KEY2 is bound.
    await db.update(
      bindingBlock({
        height: 1,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_A, signer_key: KEY1 },
      })
    );
    await db.update(
      bindingBlock({
        height: 2,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_A, signer_key: KEY2 },
      })
    );
    // MANAGER_C registers KEY9, then receives and loses a grant for KEY4 — its
    // KEY9 registration stays bound throughout (grants rotate nothing, and
    // revokes never unbind a registration).
    await db.update(
      bindingBlock({
        height: 3,
        name: Pox5EventName.RegisterSigner,
        data: { signer: MANAGER_C, signer_key: KEY9 },
      })
    );
    await db.update(
      bindingBlock({
        height: 4,
        name: Pox5EventName.GrantSignerKey,
        data: { signer_key: KEY4, signer_manager: MANAGER_C, auth_id: '888' },
      })
    );
    await db.update(
      bindingBlock({
        height: 5,
        name: Pox5EventName.RevokeSignerGrant,
        data: { signer_key: KEY4, signer_manager: MANAGER_C },
      })
    );
    await seedCycle(CYCLE, 6, [
      { key: KEY1, weight: 3, stacked: '300000000000' },
      { key: KEY2, weight: 2, stacked: '200000000000' },
      { key: KEY9, weight: 1, stacked: '100000000000' },
    ]);

    const res = await getCycleSigners();
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    const managersByKey = Object.fromEntries(
      body.results.map((r: { signing_key: string; signer_managers: { signer_manager: string }[] }) => [
        r.signing_key,
        r.signer_managers.map(m => m.signer_manager),
      ])
    );
    assert.deepEqual(managersByKey, {
      [KEY1]: [], // overwritten by MANAGER_A's registration of KEY2
      [KEY2]: [MANAGER_A],
      [KEY9]: [MANAGER_C], // untouched by the KEY4 grant/revoke
    });
  });

  test('paginates by weight descending with signing key cursor', async () => {
    await seedCycle(CYCLE, 1, [
      { key: KEY1, weight: 5, stacked: '500000000000' },
      { key: KEY2, weight: 3, stacked: '300000000000' },
      { key: KEY4, weight: 1, stacked: '100000000000' },
    ]);

    const page1 = await getCycleSigners({ limit: '2' });
    assert.equal(page1.status, 200, page1.text);
    const body1 = JSON.parse(page1.text);
    assert.equal(body1.total, 3);
    assert.deepEqual(
      body1.results.map((r: { signing_key: string }) => r.signing_key),
      [KEY1, KEY2]
    );
    assert.equal(body1.cursor.next, KEY4);
    assert.equal(body1.cursor.previous, null);
    assert.equal(body1.cursor.current, KEY1);

    const page2 = await getCycleSigners({ limit: '2', cursor: body1.cursor.next });
    assert.equal(page2.status, 200, page2.text);
    const body2 = JSON.parse(page2.text);
    assert.deepEqual(
      body2.results.map((r: { signing_key: string }) => r.signing_key),
      [KEY4]
    );
    assert.equal(body2.cursor.next, null);
    assert.equal(body2.cursor.previous, KEY1);
    assert.equal(body2.cursor.current, KEY4);

    // A cursor without the 0x prefix is normalized to the same page.
    const page2b = await getCycleSigners({ limit: '2', cursor: body1.cursor.next.slice(2) });
    assert.equal(page2b.status, 200, page2b.text);
    assert.deepEqual(
      JSON.parse(page2b.text).results.map((r: { signing_key: string }) => r.signing_key),
      [KEY4]
    );

    // A well-formed cursor that is not one of the cycle's signing keys is a 404,
    // not a silently empty page.
    const unknown = await getCycleSigners({ limit: '2', cursor: KEY5 });
    assert.equal(unknown.status, 404, unknown.text);
  });
});
