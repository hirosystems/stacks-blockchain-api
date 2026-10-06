import { describe, test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import { NewBlockMessage } from '@stacks/node-publisher-client';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { parseNewBlockMessage } from '../../../src/event-stream/event-server.ts';
import {
  BACKFILL_PRINCIPAL_MINER_REWARD_TOTALS_SQL,
  BACKFILL_REWARD_INDEX_SQL,
} from '../../../migrations/1779800000028_miner-reward-index-and-totals.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { hex } from '../test-helpers.ts';

describe('principal mining', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const miner = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
  const zeroShareMiner = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const contractRecipient = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.mining-pool';
  const emptyPrincipal = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';

  const noFees = {
    tx_fees_anchored: 0n,
    tx_fees_streamed_confirmed: 0n,
    tx_fees_streamed_produced: 0n,
  };

  /** A block at `height` whose hashes are derived from `id`, building off `parentId`. */
  const block = (height: number, id: number, parentId: number) =>
    new TestBlockBuilder({
      block_height: height,
      block_hash: hex(id),
      index_block_hash: hex(id),
      parent_index_block_hash: hex(parentId),
      parent_block_hash: hex(parentId),
      block_time: 1_700_000_000 + id,
    });

  const get = (url: string, headers: Record<string, string> = {}) =>
    api.fastifyApp.inject({ method: 'GET', url, headers });

  const getRewards = async (principal: string, query = '') => {
    const res = await get(`/extended/v3/principals/${principal}/mining/rewards${query}`);
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };

  const getSummary = async (principal: string) => {
    const res = await get(`/extended/v3/principals/${principal}/mining`);
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    // Blocks 1 and 2 are the reward sources; their rewards mature in blocks 3 and 4.
    await db.update(block(1, 1, 0).build());
    await db.update(block(2, 2, 1).build());
    // Block 3 matures block 1's rewards. Like mainnet blocks 1352 and 1379, it credits the miner
    // twice: its own reward and its parent-miner share of streamed fees. It also carries an empty
    // parent-miner share for another principal.
    await db.update(
      block(3, 3, 2)
        .addMinerReward({
          recipient: miner,
          block_hash: hex(1),
          from_index_block_hash: hex(1),
          coinbase_amount: 1000n,
          tx_fees_anchored: 10n,
          tx_fees_streamed_confirmed: 5n,
          tx_fees_streamed_produced: 0n,
        })
        .addMinerReward({
          recipient: miner,
          block_hash: hex(1),
          from_index_block_hash: hex(1),
          coinbase_amount: 0n,
          ...noFees,
          tx_fees_streamed_produced: 7n,
        })
        .addMinerReward({
          recipient: zeroShareMiner,
          block_hash: hex(1),
          from_index_block_hash: hex(1),
          coinbase_amount: 0n,
          ...noFees,
        })
        .build()
    );
    // Block 4 matures block 2's rewards, one of them paid to a contract (an alternate coinbase
    // recipient, allowed since Stacks 2.1).
    await db.update(
      block(4, 4, 3)
        .addMinerReward({
          recipient: miner,
          block_hash: hex(2),
          from_index_block_hash: hex(2),
          coinbase_amount: 1000n,
          ...noFees,
        })
        .addMinerReward({
          recipient: contractRecipient,
          block_hash: hex(2),
          from_index_block_hash: hex(2),
          coinbase_amount: 500n,
          ...noFees,
        })
        .build()
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('ingestion assigns each matured reward its position in the block', () => {
    const reward = {
      recipient: 'SP1NQA8H0000000000000000000000000000000',
      miner_address: 'SP1NQA8H0000000000000000000000000000000',
      coinbase_amount: '2466400000',
      tx_fees_anchored: '0',
      tx_fees_streamed_confirmed: '0',
      tx_fees_streamed_produced: '0',
      from_stacks_block_hash: '0x1234',
      from_index_consensus_hash: '0x5678',
    };
    const msg: NewBlockMessage = {
      block_time: 1716238792,
      block_height: 1352,
      block_hash: '0x1234',
      index_block_hash: '0x5678',
      parent_index_block_hash: '0x9abc',
      parent_block_hash: '0x1234',
      parent_microblock: '0x1234',
      parent_microblock_sequence: 0,
      parent_burn_block_hash: '0x1234',
      parent_burn_block_height: 0,
      parent_burn_block_timestamp: 0,
      burn_block_time: 1234567890,
      burn_block_hash: '0x1234',
      burn_block_height: 1,
      miner_txid: '0x1234',
      events: [],
      transactions: [],
      matured_miner_rewards: [
        reward,
        { ...reward, coinbase_amount: '0', tx_fees_streamed_produced: '368' },
      ],
      signer_signature_hash: '0x1234',
      miner_signature: '0x1234',
    };
    const { dbData } = parseNewBlockMessage(STACKS_MAINNET.chainId, msg, false);
    assert.deepEqual(
      dbData.minerRewards.map(r => [r.recipient, r.reward_index, r.mature_block_height]),
      [
        [reward.recipient, 0, 1352],
        [reward.recipient, 1, 1352],
      ]
    );
  });

  test('lists matured rewards, most recent first, with stable ids', async () => {
    const page = await getRewards(miner);
    assert.equal(page.total, 3);
    assert.deepEqual(page.results, [
      {
        id: `${hex(4)}:0`,
        recipient: miner,
        miner: miner,
        block: { height: 4, hash: hex(4), index_hash: hex(4), time: 1_700_000_004 },
        source_block: { height: 2, hash: hex(2), index_hash: hex(2), time: 1_700_000_002 },
        coinbase: '1000',
        fees: '0',
        total: '1000',
      },
      {
        id: `${hex(3)}:1`,
        recipient: miner,
        miner: miner,
        block: { height: 3, hash: hex(3), index_hash: hex(3), time: 1_700_000_003 },
        source_block: { height: 1, hash: hex(1), index_hash: hex(1), time: 1_700_000_001 },
        coinbase: '0',
        fees: '7',
        total: '7',
      },
      {
        id: `${hex(3)}:0`,
        recipient: miner,
        miner: miner,
        block: { height: 3, hash: hex(3), index_hash: hex(3), time: 1_700_000_003 },
        source_block: { height: 1, hash: hex(1), index_hash: hex(1), time: 1_700_000_001 },
        coinbase: '1000',
        fees: '15',
        total: '1015',
      },
    ]);
  });

  test('cursor pagination walks rewards that share a maturity height', async () => {
    const page1 = await getRewards(miner, '?limit=1');
    assert.equal(page1.total, 3);
    assert.deepEqual(page1.cursor, { current: '4:0', next: '3:1', previous: null });
    assert.deepEqual(
      page1.results.map((r: { id: string }) => r.id),
      [`${hex(4)}:0`]
    );

    const page2 = await getRewards(miner, `?limit=1&cursor=${page1.cursor.next}`);
    assert.equal(page2.total, 3);
    assert.deepEqual(page2.cursor, { current: '3:1', next: '3:0', previous: '4:0' });
    assert.deepEqual(
      page2.results.map((r: { id: string }) => r.id),
      [`${hex(3)}:1`]
    );

    const page3 = await getRewards(miner, `?limit=1&cursor=${page2.cursor.next}`);
    assert.deepEqual(page3.cursor, { current: '3:0', next: null, previous: '3:1' });
    assert.deepEqual(
      page3.results.map((r: { id: string }) => r.id),
      [`${hex(3)}:0`]
    );

    const twoPerPage = await getRewards(miner, '?limit=2&cursor=3:1');
    assert.deepEqual(twoPerPage.cursor, { current: '3:1', next: null, previous: '4:0' });
    assert.equal(twoPerPage.results.length, 2);
  });

  test('summary reports lifetime totals independent of pagination', async () => {
    assert.deepEqual(await getSummary(miner), {
      rewards: {
        count: 3,
        coinbase: '2000',
        fees: '22',
        total: '2022',
      },
    });
    assert.deepEqual(await getSummary(contractRecipient), {
      rewards: {
        count: 1,
        coinbase: '500',
        fees: '0',
        total: '500',
      },
    });
    const contractRewards = await getRewards(contractRecipient);
    assert.equal(contractRewards.total, 1);
    assert.equal(contractRewards.results[0].id, `${hex(4)}:1`);
  });

  test('zero-value rewards and principals without rewards read as empty', async () => {
    const zeros = {
      rewards: {
        count: 0,
        coinbase: '0',
        fees: '0',
        total: '0',
      },
    };
    for (const principal of [zeroShareMiner, emptyPrincipal]) {
      assert.deepEqual(await getSummary(principal), zeros);
      const page = await getRewards(principal);
      assert.equal(page.total, 0);
      assert.deepEqual(page.results, []);
      assert.deepEqual(page.cursor, { current: null, next: null, previous: null });
    }
  });

  test('re-orgs roll rewards back and restore them, invalidating the cache', async () => {
    const summaryUrl = `/extended/v3/principals/${miner}/mining`;
    const rewardsUrl = `/extended/v3/principals/${miner}/mining/rewards`;
    const before = await get(summaryUrl);
    const summaryEtag = before.headers['etag'] as string;
    const rewardsEtag = (await get(rewardsUrl)).headers['etag'] as string;
    assert.ok(summaryEtag);
    assert.ok(rewardsEtag);
    assert.equal((await get(summaryUrl, { 'if-none-match': summaryEtag })).statusCode, 304);

    // A longer fork off block 3 orphans block 4 and the rewards it matured.
    await db.update(block(4, 0x4b, 3).build());
    await db.update(block(5, 0x5b, 0x4b).build());

    const orphaned = await get(summaryUrl, { 'if-none-match': summaryEtag });
    assert.equal(orphaned.statusCode, 200);
    assert.notEqual(orphaned.headers['etag'], summaryEtag);
    assert.deepEqual(JSON.parse(orphaned.body).rewards, {
      count: 2,
      coinbase: '1000',
      fees: '22',
      total: '1022',
    });
    const orphanedRewards = await get(rewardsUrl, { 'if-none-match': rewardsEtag });
    assert.equal(orphanedRewards.statusCode, 200);
    assert.deepEqual(
      JSON.parse(orphanedRewards.body).results.map((r: { id: string }) => r.id),
      [`${hex(3)}:1`, `${hex(3)}:0`]
    );
    assert.equal(JSON.parse(orphanedRewards.body).total, 2);
    assert.equal((await getSummary(contractRecipient)).rewards.count, 0);

    // The original fork overtakes it again: block 4's rewards come back with the same ids.
    await db.update(block(5, 5, 4).build());
    await db.update(block(6, 6, 5).build());

    const restored = await getRewards(miner);
    assert.equal(restored.total, 3);
    assert.deepEqual(
      restored.results.map((r: { id: string }) => r.id),
      [`${hex(4)}:0`, `${hex(3)}:1`, `${hex(3)}:0`]
    );
    assert.equal((await getSummary(miner)).rewards.total, '2022');
    assert.equal((await getSummary(contractRecipient)).rewards.total, '500');
  });

  test('migration backfills match the write path', async () => {
    // Leave block 4 orphaned so the backfill has non-canonical rows to skip.
    await db.update(block(4, 0x4b, 3).build());
    await db.update(block(5, 0x5b, 0x4b).build());

    const readState = async () => ({
      indexes: await db.sql`
        SELECT index_block_hash, reward_index FROM miner_rewards ORDER BY id
      `,
      totals: await db.sql`
        SELECT * FROM principal_miner_reward_totals
        WHERE reward_count <> 0 OR coinbase_amount <> 0 OR fees_amount <> 0
        ORDER BY principal
      `,
    });
    const expected = await readState();

    await db.sql`UPDATE miner_rewards SET reward_index = 99`;
    await db.sql`DELETE FROM principal_miner_reward_totals`;
    await db.sql.unsafe(BACKFILL_REWARD_INDEX_SQL);
    await db.sql.unsafe(BACKFILL_PRINCIPAL_MINER_REWARD_TOTALS_SQL);

    assert.deepEqual(await readState(), expected);
    assert.deepEqual(
      expected.indexes.map(r => r.reward_index),
      [0, 1, 2, 0, 1]
    );
  });

  test('rejects out-of-range cursors', async () => {
    for (const cursor of ['3:40000', '99999999999:0', 'abc']) {
      const res = await get(`/extended/v3/principals/${miner}/mining/rewards?cursor=${cursor}`);
      assert.equal(res.statusCode, 400, `${cursor}: ${res.body}`);
    }
  });
});
