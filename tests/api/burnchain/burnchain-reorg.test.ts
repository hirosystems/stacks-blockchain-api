import { DbBurnBlockPoxTx, DbBurnchainReward, DbRewardSlotHolder } from '../../../src/datastore/common.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { MIGRATIONS_DIR } from '../../../src/datastore/pg-store.ts';
import { getConnectionArgs } from '../../../src/datastore/connection.ts';
import { PgSqlClient, runMigrations } from '@stacks/api-toolkit';
import { TestBlockBuilder } from '../test-builders.ts';
import { migrate } from '../../test-helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('burnchain re-org handling', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;

  const ADDR_1 = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
  const ADDR_2 = '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z';

  function reward(args: {
    hash: string;
    height: number;
    index?: number;
    recipient?: string;
    amount?: bigint;
  }): DbBurnchainReward {
    return {
      canonical: true,
      burn_block_hash: args.hash,
      burn_block_height: args.height,
      reward_recipient: args.recipient ?? ADDR_1,
      reward_amount: args.amount ?? 1000n,
      reward_index: args.index ?? 0,
    };
  }

  function poxTx(args: {
    hash: string;
    height: number;
    txId?: string;
    utxoIdx?: number;
    recipient?: string;
    amount?: bigint;
  }): DbBurnBlockPoxTx {
    return {
      canonical: true,
      burn_block_hash: args.hash,
      burn_block_height: args.height,
      tx_id: args.txId ?? '0x0001',
      recipient: args.recipient ?? ADDR_1,
      utxo_idx: args.utxoIdx ?? 0,
      amount: args.amount ?? 1000n,
    };
  }

  function slotHolder(args: {
    hash: string;
    height: number;
    index?: number;
    address?: string;
  }): DbRewardSlotHolder {
    return {
      canonical: true,
      burn_block_hash: args.hash,
      burn_block_height: args.height,
      address: args.address ?? ADDR_1,
      slot_index: args.index ?? 0,
    };
  }

  /** Ingests one `/new_burn_block` event the way the event server does. */
  async function deliverBurnBlock(args: {
    hash: string;
    height: number;
    burnAmount?: bigint;
    rewards?: DbBurnchainReward[];
    slotHolders?: DbRewardSlotHolder[];
    poxTxs?: DbBurnBlockPoxTx[];
  }) {
    await db.sqlWriteTransaction(async () => {
      await db.updateBurnchainBlock({
        burnchainBlockHash: args.hash,
        burnchainBlockHeight: args.height,
        burnAmount: args.burnAmount ?? 0n,
        rewardAmount: (args.rewards ?? []).reduce((total, r) => total + r.reward_amount, 0n),
      });
      await db.updateBurnchainRewards({
        burnchainBlockHash: args.hash,
        burnchainBlockHeight: args.height,
        rewards: args.rewards ?? [],
      });
      await db.updateBurnchainRewardSlotHolders({
        burnchainBlockHash: args.hash,
        burnchainBlockHeight: args.height,
        slotHolders: args.slotHolders ?? [],
      });
      await db.updateBurnBlockPoxTxs({
        burnchainBlockHash: args.hash,
        burnchainBlockHeight: args.height,
        burnBlockPoxTxs: args.poxTxs ?? [],
      });
    });
  }

  async function rewardRows(): Promise<
    { burn_block_hash: string; burn_block_height: number; reward_index: number; canonical: boolean }[]
  > {
    return await client`
      SELECT burn_block_hash, burn_block_height, reward_index, canonical
      FROM burnchain_rewards
      ORDER BY burn_block_height, burn_block_hash, reward_index
    `;
  }

  async function canonicalRewardSum(): Promise<bigint> {
    const result = await client<{ sum: string | null }[]>`
      SELECT SUM(reward_amount) AS sum FROM burnchain_rewards WHERE canonical = true
    `;
    return BigInt(result[0].sum ?? 0);
  }

  async function poxTxCount(recipient: string): Promise<number> {
    const result = await client<{ count: number }[]>`
      SELECT count FROM burn_block_pox_tx_counts WHERE recipient = ${recipient}
    `;
    return result.length > 0 ? result[0].count : 0;
  }

  async function slotHolderRows(): Promise<
    { burn_block_hash: string; burn_block_height: number; slot_index: number; canonical: boolean }[]
  > {
    return await client`
      SELECT burn_block_hash, burn_block_height, slot_index, canonical
      FROM reward_slot_holders
      ORDER BY burn_block_height, burn_block_hash, slot_index
    `;
  }

  async function burnchainBlockRows(): Promise<
    {
      burn_block_hash: string;
      burn_block_height: number;
      burn_amount: string;
      reward_amount: string;
      canonical: boolean;
    }[]
  > {
    return await client`
      SELECT burn_block_hash, burn_block_height, burn_amount::text AS burn_amount,
        reward_amount::text AS reward_amount, canonical
      FROM burn_blocks
      ORDER BY burn_block_height, burn_block_hash
    `;
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
  });

  afterEach(async () => {
    await db?.close();
    await migrate('down');
  });

  test('re-delivered burn block events are idempotent', async () => {
    const block = {
      hash: '0xaa01',
      height: 100,
      burnAmount: 5000n,
      rewards: [
        reward({ hash: '0xaa01', height: 100, index: 0, recipient: ADDR_1 }),
        reward({ hash: '0xaa01', height: 100, index: 1, recipient: ADDR_2 }),
      ],
      slotHolders: [
        slotHolder({ hash: '0xaa01', height: 100, index: 0, address: ADDR_1 }),
        slotHolder({ hash: '0xaa01', height: 100, index: 1, address: ADDR_2 }),
      ],
      poxTxs: [
        poxTx({ hash: '0xaa01', height: 100, txId: '0x0001', utxoIdx: 0, recipient: ADDR_1 }),
        poxTx({ hash: '0xaa01', height: 100, txId: '0x0001', utxoIdx: 1, recipient: ADDR_2 }),
      ],
    };
    await deliverBurnBlock(block);
    // The node re-delivers the same event, e.g. after a restart or a retried request.
    await deliverBurnBlock(block);

    const rewards = await rewardRows();
    assert.equal(rewards.length, 2);
    assert.ok(rewards.every(r => r.canonical));
    assert.equal(await canonicalRewardSum(), 2000n);

    const holders = await slotHolderRows();
    assert.equal(holders.length, 2);
    assert.ok(holders.every(h => h.canonical));

    const burnBlocks = await burnchainBlockRows();
    assert.deepEqual([...burnBlocks], [
      {
        burn_block_hash: '0xaa01',
        burn_block_height: 100,
        burn_amount: '5000',
        reward_amount: '2000',
        canonical: true,
      },
    ]);

    const poxTxs = await client<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM burn_block_pox_txs`;
    assert.equal(poxTxs[0].count, '2');
    assert.equal(await poxTxCount(ADDR_1), 1);
    assert.equal(await poxTxCount(ADDR_2), 1);
  });

  test('a same-height burnchain fork orphans the rival block', async () => {
    await deliverBurnBlock({
      hash: '0xaa01',
      height: 100,
      rewards: [
        reward({ hash: '0xaa01', height: 100, index: 0, recipient: ADDR_1 }),
        reward({ hash: '0xaa01', height: 100, index: 1, recipient: ADDR_1, amount: 500n }),
      ],
      slotHolders: [slotHolder({ hash: '0xaa01', height: 100, address: ADDR_1 })],
      poxTxs: [poxTx({ hash: '0xaa01', height: 100, recipient: ADDR_1 })],
    });
    // The burnchain forks: a replacement block at the same height pays different recipients.
    await deliverBurnBlock({
      hash: '0xbb01',
      height: 100,
      rewards: [reward({ hash: '0xbb01', height: 100, index: 0, recipient: ADDR_2, amount: 700n })],
      slotHolders: [slotHolder({ hash: '0xbb01', height: 100, address: ADDR_2 })],
      poxTxs: [poxTx({ hash: '0xbb01', height: 100, recipient: ADDR_2, amount: 700n })],
    });

    const rewards = await rewardRows();
    assert.equal(rewards.length, 3);
    for (const row of rewards) {
      assert.equal(row.canonical, row.burn_block_hash === '0xbb01');
    }
    const holders = await slotHolderRows();
    assert.equal(holders.length, 2);
    for (const row of holders) {
      assert.equal(row.canonical, row.burn_block_hash === '0xbb01');
    }
    assert.equal(await canonicalRewardSum(), 700n);
    const total1 = await db.getBurnchainRewardsTotal(ADDR_1);
    assert.equal(total1.reward_amount, 0n);
    const total2 = await db.getBurnchainRewardsTotal(ADDR_2);
    assert.equal(total2.reward_amount, 700n);

    assert.equal(await poxTxCount(ADDR_1), 0);
    assert.equal(await poxTxCount(ADDR_2), 1);
  });

  test('a zero-reward replacement block orphans the rival block', async () => {
    await deliverBurnBlock({
      hash: '0xaa01',
      height: 100,
      rewards: [reward({ hash: '0xaa01', height: 100 })],
      slotHolders: [slotHolder({ hash: '0xaa01', height: 100 })],
      poxTxs: [poxTx({ hash: '0xaa01', height: 100 })],
    });
    // The replacement block paid no rewards (e.g. all commits burned, like a pox-1 through pox-4
    // prepare-phase block): the node still announces it, with empty recipients and the burned
    // total in `burn_amount`. This is the only signal that the previous block was orphaned.
    await deliverBurnBlock({ hash: '0xbb01', height: 100, burnAmount: 40000n });

    const rewards = await rewardRows();
    assert.equal(rewards.length, 1);
    assert.equal(rewards[0].canonical, false);
    assert.equal(await canonicalRewardSum(), 0n);
    const holders = await slotHolderRows();
    assert.equal(holders.length, 1);
    assert.equal(holders[0].canonical, false);
    assert.equal(await poxTxCount(ADDR_1), 0);
    // The zero-recipient block still persists its burned amount.
    const burnBlocks = await burnchainBlockRows();
    assert.deepEqual([...burnBlocks], [
      {
        burn_block_hash: '0xaa01',
        burn_block_height: 100,
        burn_amount: '0',
        reward_amount: '1000',
        canonical: false,
      },
      {
        burn_block_hash: '0xbb01',
        burn_block_height: 100,
        burn_amount: '40000',
        reward_amount: '0',
        canonical: true,
      },
    ]);
  });

  test('forking back to a previously orphaned burn block restores it', async () => {
    const blockA = {
      hash: '0xaa01',
      height: 100,
      rewards: [reward({ hash: '0xaa01', height: 100 })],
      slotHolders: [slotHolder({ hash: '0xaa01', height: 100, address: ADDR_1 })],
      poxTxs: [poxTx({ hash: '0xaa01', height: 100 })],
    };
    await deliverBurnBlock(blockA);
    await deliverBurnBlock({
      hash: '0xbb01',
      height: 100,
      rewards: [reward({ hash: '0xbb01', height: 100, recipient: ADDR_2, amount: 700n })],
      slotHolders: [slotHolder({ hash: '0xbb01', height: 100, address: ADDR_2 })],
      poxTxs: [poxTx({ hash: '0xbb01', height: 100, recipient: ADDR_2, amount: 700n })],
    });
    // The burnchain forks back to the original block; the node re-announces it.
    await deliverBurnBlock(blockA);

    const rewards = await rewardRows();
    assert.equal(rewards.length, 2);
    for (const row of rewards) {
      assert.equal(row.canonical, row.burn_block_hash === '0xaa01');
    }
    assert.equal(await canonicalRewardSum(), 1000n);
    const holders = await slotHolderRows();
    assert.equal(holders.length, 2);
    for (const row of holders) {
      assert.equal(row.canonical, row.burn_block_hash === '0xaa01');
    }
    const burnBlocks = await burnchainBlockRows();
    assert.equal(burnBlocks.length, 2);
    for (const row of burnBlocks) {
      assert.equal(row.canonical, row.burn_block_hash === '0xaa01');
    }
    assert.equal(await poxTxCount(ADDR_1), 1);
    assert.equal(await poxTxCount(ADDR_2), 0);
  });

  test('a deep burnchain fork is resolved as each replacement block arrives', async () => {
    for (const [hash, height] of [
      ['0xaa01', 100],
      ['0xaa02', 101],
      ['0xaa03', 102],
    ] as const) {
      await deliverBurnBlock({ hash, height, rewards: [reward({ hash, height })] });
    }
    assert.equal(await canonicalRewardSum(), 3000n);

    // A 3-block burnchain re-org: the node announces each replacement block individually.
    await deliverBurnBlock({
      hash: '0xbb01',
      height: 100,
      rewards: [reward({ hash: '0xbb01', height: 100, amount: 100n })],
    });
    // Not-yet-replaced heights are only orphaned once their replacement arrives.
    assert.equal(await canonicalRewardSum(), 2100n);
    await deliverBurnBlock({
      hash: '0xbb02',
      height: 101,
      rewards: [reward({ hash: '0xbb02', height: 101, amount: 100n })],
    });
    await deliverBurnBlock({
      hash: '0xbb03',
      height: 102,
      rewards: [reward({ hash: '0xbb03', height: 102, amount: 100n })],
    });

    const rewards = await rewardRows();
    assert.equal(rewards.length, 6);
    for (const row of rewards) {
      assert.equal(row.canonical, row.burn_block_hash.startsWith('0xbb'));
    }
    assert.equal(await canonicalRewardSum(), 300n);
  });

  test('re-delivering an old burn block does not orphan newer blocks', async () => {
    for (const [hash, height] of [
      ['0xaa01', 100],
      ['0xaa02', 101],
      ['0xaa03', 102],
    ] as const) {
      await deliverBurnBlock({
        hash,
        height,
        rewards: [reward({ hash, height })],
        slotHolders: [slotHolder({ hash, height })],
      });
    }
    // The node may re-emit an old burn block outside a full ordered replay. Data at heights above
    // it must be left alone.
    await deliverBurnBlock({
      hash: '0xaa01',
      height: 100,
      rewards: [reward({ hash: '0xaa01', height: 100 })],
      slotHolders: [slotHolder({ hash: '0xaa01', height: 100 })],
    });

    const rewards = await rewardRows();
    assert.equal(rewards.length, 3);
    assert.ok(rewards.every(r => r.canonical));
    assert.equal(await canonicalRewardSum(), 3000n);
    const holders = await slotHolderRows();
    assert.equal(holders.length, 3);
    assert.ok(holders.every(h => h.canonical));
  });

  test('stacks-level re-orgs do not affect burnchain rewards or pox transactions', async () => {
    await deliverBurnBlock({
      hash: '0xbb02',
      height: 101,
      rewards: [reward({ hash: '0xbb02', height: 101 })],
      poxTxs: [poxTx({ hash: '0xbb02', height: 101 })],
    });
    // Tenure 1 (burn block 0xbb01) mines block 1; tenure 2 (burn block 0xbb02) mines block 2.
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: '0xa1',
        index_block_hash: '0xa1',
        parent_index_block_hash: '0x00',
        burn_block_hash: '0xbb01',
        burn_block_height: 100,
        signer_bitvec: '1111',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xa2',
        index_block_hash: '0xa2',
        parent_index_block_hash: '0xa1',
        parent_block_hash: '0xa1',
        burn_block_hash: '0xbb02',
        burn_block_height: 101,
        signer_bitvec: '1111',
      }).build()
    );
    // A stacks-level re-org replaces all of tenure 2 with a sibling tenure anchored to a different
    // burn block. No canonical block anchors to 0xbb02 anymore, but the rewards paid on it are a
    // burnchain-level fact and must remain canonical.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xb2',
        index_block_hash: '0xb2',
        parent_index_block_hash: '0xa1',
        parent_block_hash: '0xa1',
        burn_block_hash: '0xbb03',
        burn_block_height: 102,
        signer_bitvec: '1111',
      }).build()
    );

    const blocks = await client<{ index_block_hash: string; canonical: boolean }[]>`
      SELECT index_block_hash, canonical FROM blocks ORDER BY block_height, index_block_hash
    `;
    assert.deepEqual(
      blocks.map(b => [b.index_block_hash, b.canonical]),
      [
        ['0xa1', true],
        ['0xa2', false],
        ['0xb2', true],
      ]
    );

    const rewards = await rewardRows();
    assert.equal(rewards.length, 1);
    assert.equal(rewards[0].canonical, true);
    assert.equal(await canonicalRewardSum(), 1000n);
    assert.equal(await poxTxCount(ADDR_1), 1);
  });

  test('repair migration dedupes rewards and recomputes canonical state', async () => {
    const repairMigration = '1779800000014_burnchain-canonical-repair';
    // Recreate the corrupted state left behind by the previous write paths: the unique constraints
    // did not exist, duplicate rows accumulated from re-delivered events, both sides of burnchain
    // forks stayed canonical, and stacks-level re-orgs wrongly orphaned rows.
    await client`ALTER TABLE burnchain_rewards DROP CONSTRAINT burnchain_rewards_unique_idx`;
    await client`ALTER TABLE reward_slot_holders DROP CONSTRAINT reward_slot_holders_unique_idx`;
    const seedRewards = [
      // Height 100: a fork where both hashes are canonical, plus a duplicated delivery of 0xaa01.
      // 0xbb01 is inserted first (lower ids) so that only its anchoring canonical stacks block --
      // not insertion order -- can make it win.
      { hash: '0xbb01', height: 100, index: 0, canonical: true },
      { hash: '0xaa01', height: 100, index: 0, canonical: true },
      { hash: '0xaa01', height: 100, index: 0, canonical: true },
      // Height 101: single hash wrongly orphaned by a stacks-level re-org (undercount damage).
      { hash: '0xaa02', height: 101, index: 0, canonical: false },
      { hash: '0xaa02', height: 101, index: 1, canonical: false },
    ];
    for (const r of seedRewards) {
      await client`
        INSERT INTO burnchain_rewards
          (canonical, burn_block_hash, burn_block_height, reward_recipient, reward_amount, reward_index)
        VALUES (${r.canonical}, ${r.hash}, ${r.height}, ${ADDR_1}, 1000, ${r.index})
      `;
    }
    const seedPoxTxs = [
      { hash: '0xaa01', height: 100, canonical: true, recipient: ADDR_1 },
      { hash: '0xbb01', height: 100, canonical: true, recipient: ADDR_2 },
      { hash: '0xaa02', height: 101, canonical: false, recipient: ADDR_1 },
    ];
    for (const t of seedPoxTxs) {
      await client`
        INSERT INTO burn_block_pox_txs
          (canonical, burn_block_hash, burn_block_height, tx_id, recipient, utxo_idx, amount)
        VALUES (${t.canonical}, ${t.hash}, ${t.height}, '0x0001', ${t.recipient}, 0, 1000)
      `;
    }
    // Both fork sides counted: the corruption the reseed must fix.
    await client`
      INSERT INTO burn_block_pox_tx_counts (recipient, count) VALUES (${ADDR_1}, 1), (${ADDR_2}, 1)
    `;
    const seedSlotHolders = [
      // Height 100: duplicated delivery of the losing fork side, both sides canonical. 0xbb01 is
      // inserted first so only its anchoring canonical stacks block can make it win.
      { hash: '0xbb01', height: 100, index: 0, canonical: true },
      { hash: '0xaa01', height: 100, index: 0, canonical: true },
      { hash: '0xaa01', height: 100, index: 0, canonical: true },
      // Height 101: wrongly orphaned by the legacy `>= height` invalidation (undercount damage).
      { hash: '0xaa02', height: 101, index: 0, canonical: false },
    ];
    for (const s of seedSlotHolders) {
      await client`
        INSERT INTO reward_slot_holders (canonical, burn_block_hash, burn_block_height, address, slot_index)
        VALUES (${s.canonical}, ${s.hash}, ${s.height}, ${ADDR_1}, ${s.index})
      `;
    }
    // A canonical stacks block anchors to 0xbb01, proving it canonical at height 100 despite the
    // 0xaa01 rows being inserted later.
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: '0xa1',
        index_block_hash: '0xa1',
        parent_index_block_hash: '0x00',
        burn_block_hash: '0xbb01',
        burn_block_height: 100,
      }).build()
    );

    // Re-run only the repair migration.
    await client`DELETE FROM pgmigrations WHERE name = ${repairMigration}`;
    await runMigrations(MIGRATIONS_DIR, 'up', getConnectionArgs());

    const rewards = await rewardRows();
    assert.deepEqual(
      rewards.map(r => [r.burn_block_hash, r.burn_block_height, r.reward_index, r.canonical]),
      [
        ['0xaa01', 100, 0, false],
        ['0xbb01', 100, 0, true],
        ['0xaa02', 101, 0, true],
        ['0xaa02', 101, 1, true],
      ]
    );
    const poxTxs = await client<{ burn_block_hash: string; canonical: boolean }[]>`
      SELECT burn_block_hash, canonical FROM burn_block_pox_txs
      ORDER BY burn_block_height, burn_block_hash
    `;
    assert.deepEqual(
      poxTxs.map(t => [t.burn_block_hash, t.canonical]),
      [
        ['0xaa01', false],
        ['0xbb01', true],
        ['0xaa02', true],
      ]
    );
    assert.equal(await poxTxCount(ADDR_1), 1);
    assert.equal(await poxTxCount(ADDR_2), 1);

    const holders = await slotHolderRows();
    assert.deepEqual(
      holders.map(h => [h.burn_block_hash, h.burn_block_height, h.slot_index, h.canonical]),
      [
        ['0xaa01', 100, 0, false],
        ['0xbb01', 100, 0, true],
        ['0xaa02', 101, 0, true],
      ]
    );
  });

  test('burnchain blocks migration backfills burn amounts from raw events', async () => {
    const burnBlocksMigration = '1779800000015_burn-blocks';
    // Raw `/new_burn_block` payloads: a fork at height 100 (0xbb01 received last wins by arrival
    // order), a re-delivered duplicate of 0xbb01 (latest payload per hash wins), and a
    // zero-recipient prepare-phase-style block at 101 whose burn amount only exists here.
    const rawEvents = [
      { hash: '0xaa01', height: 100, burn: 1000, recipients: [] as { recipient: string; amt: number }[] },
      { hash: '0xbb01', height: 100, burn: 2000, recipients: [
        { recipient: ADDR_1, amt: 500 },
        { recipient: ADDR_2, amt: 700 },
      ] },
      { hash: '0xbb01', height: 100, burn: 2000, recipients: [
        { recipient: ADDR_1, amt: 500 },
        { recipient: ADDR_2, amt: 700 },
      ] },
      { hash: '0xcc01', height: 101, burn: 30000, recipients: [] },
    ];
    for (const e of rawEvents) {
      const payload = {
        burn_block_hash: e.hash,
        burn_block_height: e.height,
        burn_amount: e.burn,
        reward_recipients: e.recipients,
        reward_slot_holders: [],
      };
      await client`
        INSERT INTO event_observer_requests (event_path, payload)
        VALUES ('/new_burn_block', ${payload})
      `;
    }
    // A block at height 102 missing from raw events but present in burnchain_rewards: the
    // gap-fill path must pick it up from there. Restore the legacy `burn_amount` column the
    // migration's gap-fill reads (and then drops again) to recreate pre-migration state.
    await client`ALTER TABLE burnchain_rewards ADD COLUMN burn_amount numeric NOT NULL DEFAULT 0`;
    await deliverBurnBlock({
      hash: '0xdd01',
      height: 102,
      rewards: [reward({ hash: '0xdd01', height: 102 })],
    });
    await client`UPDATE burnchain_rewards SET burn_amount = 2000 WHERE burn_block_hash = ${'0xdd01'}`;
    // A burnchain fork at height 103 present only in burnchain_rewards (no raw events): the
    // gap-fill must stay consistent with the repaired rewards table, where 0xee02 won.
    for (const f of [
      { hash: '0xee01', burn: 500, canonical: false },
      { hash: '0xee02', burn: 600, canonical: true },
    ]) {
      await client`
        INSERT INTO burnchain_rewards
          (canonical, burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index)
        VALUES (${f.canonical}, ${f.hash}, 103, ${f.burn}, ${ADDR_1}, 1000, 0)
      `;
    }
    // Re-run only the burn_blocks migration (the delivery above also wrote to the live
    // table; drop it so the migration recreates and backfills from scratch).
    await client`DROP TABLE burn_blocks`;
    await client`DELETE FROM pgmigrations WHERE name = ${burnBlocksMigration}`;
    await runMigrations(MIGRATIONS_DIR, 'up', getConnectionArgs());

    const burnBlocks = await burnchainBlockRows();
    assert.deepEqual(
      burnBlocks.map(b => [
        b.burn_block_hash,
        b.burn_block_height,
        b.burn_amount,
        b.reward_amount,
        b.canonical,
      ]),
      [
        ['0xaa01', 100, '1000', '0', false],
        ['0xbb01', 100, '2000', '1200', true],
        ['0xcc01', 101, '30000', '0', true],
        ['0xdd01', 102, '2000', '1000', true],
        ['0xee01', 103, '500', '1000', false],
        ['0xee02', 103, '600', '1000', true],
      ]
    );
  });
});
