import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { EventStreamServer, startEventServer } from '../../../src/event-stream/event-server.ts';
import { httpPostRequest } from '../../../src/helpers.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { MIGRATIONS_DIR } from '../../../src/datastore/pg-store.ts';
import { getConnectionArgs } from '../../../src/datastore/connection.ts';
import { PgSqlClient, runMigrations } from '@stacks/api-toolkit';
import { migrate } from '../../test-helpers.ts';

describe('staking rewards totals', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;
  let eventServer: EventStreamServer;

  const ADDR_1 = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';

  /** POSTs a simulated `/new_burn_block` payload through the event server. */
  async function deliverBurnBlock(args: {
    hash: string;
    height: number;
    burnAmount?: bigint;
    rewardAmount?: bigint;
  }) {
    const payload = {
      burn_block_hash: args.hash,
      burn_block_height: args.height,
      burn_amount: Number(args.burnAmount ?? 0n),
      reward_recipients:
        (args.rewardAmount ?? 0n) > 0n
          ? [{ recipient: ADDR_1, amt: Number(args.rewardAmount) }]
          : [],
      reward_slot_holders: [],
      pox_transactions: [],
    };
    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_burn_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });
  }

  async function getTotals(): Promise<{
    btc: { reward_amount: string; burn_amount: string; total_amount: string };
  }> {
    const res = await supertest(api.server).get(`/extended/v3/staking/rewards`);
    assert.equal(res.status, 200);
    assert.equal(res.type, 'application/json');
    return JSON.parse(res.text);
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    eventServer = await startEventServer({
      datastore: db,
      chainId: STACKS_TESTNET.chainId,
      serverHost: '127.0.0.1',
      serverPort: 0,
    });
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('burn blocks accumulate reward and burn totals idempotently', async () => {
    assert.deepEqual(await getTotals(), {
      btc: { reward_amount: '0', burn_amount: '0', total_amount: '0' },
    });

    await deliverBurnBlock({ hash: '0xaa01', height: 100, burnAmount: 500n, rewardAmount: 1000n });
    await deliverBurnBlock({ hash: '0xaa02', height: 101, burnAmount: 250n, rewardAmount: 2000n });
    assert.deepEqual(await getTotals(), {
      btc: { reward_amount: '3000', burn_amount: '750', total_amount: '3750' },
    });

    // Re-delivered events must not double count.
    await deliverBurnBlock({ hash: '0xaa02', height: 101, burnAmount: 250n, rewardAmount: 2000n });
    assert.deepEqual(await getTotals(), {
      btc: { reward_amount: '3000', burn_amount: '750', total_amount: '3750' },
    });
  });

  test('burnchain forks adjust the totals and restore on fork-back', async () => {
    await deliverBurnBlock({ hash: '0xaa01', height: 100, burnAmount: 500n, rewardAmount: 1000n });
    // A replacement block at the same height with different amounts.
    await deliverBurnBlock({ hash: '0xbb01', height: 100, burnAmount: 800n, rewardAmount: 300n });
    assert.deepEqual(await getTotals(), {
      btc: { reward_amount: '300', burn_amount: '800', total_amount: '1100' },
    });

    // Fork back to the original block.
    await deliverBurnBlock({ hash: '0xaa01', height: 100, burnAmount: 500n, rewardAmount: 1000n });
    assert.deepEqual(await getTotals(), {
      btc: { reward_amount: '1000', burn_amount: '500', total_amount: '1500' },
    });
  });

  test('a zero-reward replacement block leaves only its burn in the totals', async () => {
    await deliverBurnBlock({ hash: '0xaa01', height: 100, rewardAmount: 1000n });
    // A prepare-phase-style replacement: all commits burned, nothing paid.
    await deliverBurnBlock({ hash: '0xbb01', height: 100, burnAmount: 40000n });
    assert.deepEqual(await getTotals(), {
      btc: { reward_amount: '0', burn_amount: '40000', total_amount: '40000' },
    });
  });

  test('migration backfill reproduces the live counters', async () => {
    const migrationName = '1779800000016_chain-tip-staking-rewards';
    await deliverBurnBlock({ hash: '0xaa01', height: 100, burnAmount: 500n, rewardAmount: 1000n });
    // A pox-5-era block: the payout is the sBTC peg custody inflow and counts as rewards.
    await deliverBurnBlock({ hash: '0xaa02', height: 200, burnAmount: 0n, rewardAmount: 9999n });
    // An orphaned fork side that must not count.
    await deliverBurnBlock({ hash: '0xbb02', height: 200, burnAmount: 30n, rewardAmount: 5555n });
    const live = await getTotals();
    assert.deepEqual(live, {
      btc: { reward_amount: '6555', burn_amount: '530', total_amount: '7085' },
    });

    // Recompute from scratch: the backfill must land on the same values.
    await client`ALTER TABLE chain_tip DROP COLUMN staking_reward_amount, DROP COLUMN staking_burn_amount`;
    await client`DELETE FROM pgmigrations WHERE name = ${migrationName}`;
    await runMigrations(MIGRATIONS_DIR, 'up', getConnectionArgs());
    assert.deepEqual(await getTotals(), live);
  });
});
