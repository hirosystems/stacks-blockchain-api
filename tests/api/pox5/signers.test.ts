import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { Pox5EventName } from '@stacks/codec';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';

/**
 * pox-5 `register-signer` → materialized `staking_signers` registry, surfaced at
 * GET /extended/v3/staking/signers. The contract keys its `signers` map by the
 * signer principal and overwrites on re-registration (latest-wins).
 */

const SIGNER_A = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const SIGNER_B = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5.signer-manager';
const KEY1 = '0x' + '02'.repeat(33);
const KEY2 = '0x' + '03'.repeat(33);
const KEY_B = '0x' + '04'.repeat(33);

interface StakingSignerItem {
  signer: string;
  signer_key: string;
}
interface SignersPage {
  total: number;
  limit: number;
  cursor: { next: string | null; previous: string | null; current: string | null };
  results: StakingSignerItem[];
}

describe('pox-5 staking signers', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  async function getSigners(query: Record<string, string> = {}): Promise<SignersPage> {
    const res = await supertest(api.server).get('/extended/v3/staking/signers').query(query);
    assert.equal(res.status, 200, res.text);
    return JSON.parse(res.text) as SignersPage;
  }
  function registerSignerBlock(args: {
    block_height: number;
    block_hash: string;
    index_block_hash: string;
    parent_block_hash?: string;
    parent_index_block_hash?: string;
    tx_id: string;
    signer: string;
    signer_key: string;
  }) {
    return new TestBlockBuilder(args)
      .addTx({ tx_id: args.tx_id })
      .addTxPox5Event({
        name: Pox5EventName.RegisterSigner,
        data: { signer: args.signer, signer_key: args.signer_key },
      })
      .build();
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false, skipMigrations: true });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('a register-signer event appears in GET /staking/signers', async () => {
    await db.update(
      registerSignerBlock({
        block_height: 1,
        block_hash: '0x01',
        index_block_hash: '0x01',
        tx_id: '0x' + 'a1'.repeat(32),
        signer: SIGNER_A,
        signer_key: KEY1,
      })
    );
    const page = await getSigners();
    assert.equal(page.total, 1);
    assert.equal(page.results.length, 1);
    assert.equal(page.results[0].signer, SIGNER_A);
    assert.equal(page.results[0].signer_key, KEY1);
  });

  test('re-registration rotates the key (latest-wins, one row per signer)', async () => {
    await db.update(
      registerSignerBlock({
        block_height: 1,
        block_hash: '0x01',
        index_block_hash: '0x01',
        tx_id: '0x' + 'a1'.repeat(32),
        signer: SIGNER_A,
        signer_key: KEY1,
      })
    );
    await db.update(
      registerSignerBlock({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
        tx_id: '0x' + 'a2'.repeat(32),
        signer: SIGNER_A,
        signer_key: KEY2,
      })
    );
    const page = await getSigners();
    assert.equal(page.total, 1, 'still a single signer row');
    assert.equal(page.results[0].signer_key, KEY2, 'key rotated to the latest registration');
  });

  test('paginates signers by signer principal', async () => {
    // SIGNER_A (ST3N…) sorts after SIGNER_B (ST1S…); ordering is by signer ASC.
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' })
        .addTx({ tx_id: '0x' + 'a1'.repeat(32) })
        .addTxPox5Event({
          name: Pox5EventName.RegisterSigner,
          data: { signer: SIGNER_A, signer_key: KEY1 },
        })
        .addTxPox5Event({
          name: Pox5EventName.RegisterSigner,
          data: { signer: SIGNER_B, signer_key: KEY_B },
        })
        .build()
    );
    const page1 = await getSigners({ limit: '1' });
    assert.equal(page1.total, 2);
    assert.equal(page1.results.length, 1);
    assert.equal(page1.results[0].signer, SIGNER_B);
    assert.equal(page1.cursor.next, SIGNER_A);

    const page2 = await getSigners({ limit: '1', cursor: page1.cursor.next as string });
    assert.equal(page2.results[0].signer, SIGNER_A);
    assert.equal(page2.cursor.next, null);
    assert.equal(page2.cursor.previous, SIGNER_B);
  });

  test('orphaning the registration block removes the signer', async () => {
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' }).build()
    );
    await db.update(
      registerSignerBlock({
        block_height: 2,
        block_hash: '0xa2',
        index_block_hash: '0xa2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
        tx_id: '0x' + 'a2'.repeat(32),
        signer: SIGNER_A,
        signer_key: KEY1,
      })
    );
    assert.equal((await getSigners()).total, 1);

    // Fork B branches from genesis and overtakes, orphaning the registration.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xb2',
        index_block_hash: '0xb2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0xb2',
        parent_index_block_hash: '0xb2',
      }).build()
    );
    assert.equal((await getSigners()).total, 0, 'signer gone after the registration was orphaned');
  });

  test('orphaning a re-registration reverts to the prior key', async () => {
    // Block 1 (canonical seed): SIGNER_A registers KEY1.
    await db.update(
      registerSignerBlock({
        block_height: 1,
        block_hash: '0x01',
        index_block_hash: '0x01',
        tx_id: '0x' + 'a1'.repeat(32),
        signer: SIGNER_A,
        signer_key: KEY1,
      })
    );
    // Fork A block 2: rotate to KEY2.
    await db.update(
      registerSignerBlock({
        block_height: 2,
        block_hash: '0xa2',
        index_block_hash: '0xa2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
        tx_id: '0x' + 'a2'.repeat(32),
        signer: SIGNER_A,
        signer_key: KEY2,
      })
    );
    assert.equal((await getSigners()).results[0].signer_key, KEY2);

    // Fork B (blocks 2 + 3) overtakes, orphaning the KEY2 rotation only.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xb2',
        index_block_hash: '0xb2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0xb2',
        parent_index_block_hash: '0xb2',
      }).build()
    );
    const page = await getSigners();
    assert.equal(page.total, 1, 'signer still registered');
    assert.equal(page.results[0].signer_key, KEY1, 'reverted to the prior canonical key');
  });

  test('GET /staking/signers/:principal returns the signer with registration transaction details', async () => {
    const txId = '0x' + 'a1'.repeat(32);
    await db.update(
      registerSignerBlock({
        block_height: 1,
        block_hash: '0x01',
        index_block_hash: '0x01',
        tx_id: txId,
        signer: SIGNER_A,
        signer_key: KEY1,
      })
    );
    const res = await supertest(api.server).get(`/extended/v3/staking/signers/${SIGNER_A}`);
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.signer, SIGNER_A);
    assert.equal(body.signer_key, KEY1);
    // The registration transaction's block position is joined in from `txs`.
    assert.equal(body.transaction.tx_id, txId);
    assert.equal(body.transaction.block.height, 1);
    assert.equal(body.transaction.block.index_hash, '0x01');
    assert.equal(typeof body.transaction.block.hash, 'string');
    assert.equal(typeof body.transaction.block.tx_index, 'number');
    assert.equal(typeof body.transaction.bitcoin_block.height, 'number');
    assert.equal(typeof body.transaction.bitcoin_block.time, 'number');
  });

  test('GET /staking/signers/:principal returns 404 for an unregistered principal', async () => {
    const res = await supertest(api.server).get(`/extended/v3/staking/signers/${SIGNER_A}`);
    assert.equal(res.status, 404);
  });
});
