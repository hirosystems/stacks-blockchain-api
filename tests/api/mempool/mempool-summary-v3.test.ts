import { describe, test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { hex } from '../test-helpers.ts';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { DbTxTypeId } from '../../../src/datastore/common.ts';

const BLOCK_SENDER = 'SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2';
const SENDER = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';

const getSummary = async (api: ApiServer) => {
  const response = await api.fastifyApp.inject({ method: 'GET', url: '/extended/v3/mempool' });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body);
};

/** A raw tx hex of `bytes` length, so `tx_size` (a generated `length(raw_tx)`) is predictable. */
const rawTxOfSize = (bytes: number) => '0x' + '11'.repeat(bytes);

describe('v3 mempool summary', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('an empty mempool reports zero counts and null percentiles', async () => {
    const body = await getSummary(api);
    assert.equal(body.count, 0);
    for (const metric of ['fee_rate', 'tx_size', 'receipt_time', 'receipt_block_height']) {
      assert.deepEqual(
        body[metric],
        { p25: null, p50: null, p75: null, p95: null },
        `${metric} percentiles are null on an empty mempool`
      );
    }
    // Every type bucket is still present, so the response shape does not depend on mempool content.
    assert.deepEqual(Object.keys(body.by_type).sort(), [
      'contract_call',
      'smart_contract',
      'token_transfer',
    ]);
    for (const [name, bucket] of Object.entries<{ count: number }>(body.by_type)) {
      assert.equal(bucket.count, 0, `${name} count is zero`);
    }
  });

  describe('with a seeded mempool', () => {
    beforeEach(async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(99), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          // Four token transfers with fees 100/200/300/400 and sizes 10/20/30/40 bytes.
          ...[100, 200, 300, 400].map((fee, i) =>
            testMempoolTx({
              tx_id: hex(i + 1),
              type_id: DbTxTypeId.TokenTransfer,
              sender_address: SENDER,
              nonce: i,
              fee_rate: BigInt(fee),
              raw_tx: rawTxOfSize((i + 1) * 10),
              receipt_time: 1000 + i,
            })
          ),
          // Two contract calls.
          ...[1000, 2000].map((fee, i) =>
            testMempoolTx({
              tx_id: hex(i + 10),
              type_id: DbTxTypeId.ContractCall,
              sender_address: SENDER,
              nonce: 10 + i,
              fee_rate: BigInt(fee),
              raw_tx: rawTxOfSize(100),
              receipt_time: 2000 + i,
            })
          ),
          // A versioned smart contract (type 6), which must report as `smart_contract`.
          testMempoolTx({
            tx_id: hex(20),
            type_id: DbTxTypeId.VersionedSmartContract,
            smart_contract_clarity_version: 2,
            sender_address: SENDER,
            nonce: 20,
            fee_rate: 50n,
            raw_tx: rawTxOfSize(200),
            receipt_time: 3000,
          }),
          // A pruned transaction, which must be excluded from every bucket.
          testMempoolTx({
            tx_id: hex(30),
            type_id: DbTxTypeId.TokenTransfer,
            sender_address: SENDER,
            nonce: 30,
            fee_rate: 999999n,
            pruned: true,
            receipt_time: 4000,
          }),
        ],
      });
    });

    test('percentiles are discrete: every value is one a pending transaction actually has', async () => {
      const body = await getSummary(api);
      // Fees 100/200/300/400. `percentile_disc` returns observed values; `percentile_cont` would
      // interpolate to 175/250/325/385, so this assertion pins the discrete behavior.
      assert.deepEqual(body.by_type.token_transfer.fee_rate, {
        p25: '100',
        p50: '200',
        p75: '300',
        p95: '400',
      });
    });

    test('fee rates are string-quoted integers', async () => {
      const body = await getSummary(api);
      for (const p of ['p25', 'p50', 'p75', 'p95']) {
        assert.equal(typeof body.fee_rate[p], 'string', `fee_rate.${p} is a string`);
        assert.match(body.fee_rate[p], /^[0-9]+$/);
      }
    });

    test('the overall count equals the sum of the per-type counts', async () => {
      const body = await getSummary(api);
      const summed = Object.values<{ count: number }>(body.by_type).reduce(
        (acc, b) => acc + b.count,
        0
      );
      assert.equal(body.count, 7, 'the pruned transaction is excluded');
      assert.equal(summed, body.count);
    });

    test('overall percentiles span every type', async () => {
      const body = await getSummary(api);
      // Unpruned fees ascending: 50, 100, 200, 300, 400, 1000, 2000.
      assert.deepEqual(body.fee_rate, { p25: '100', p50: '300', p75: '1000', p95: '2000' });
    });

    test('a versioned smart contract is counted as a smart contract', async () => {
      const body = await getSummary(api);
      assert.equal(body.by_type.smart_contract.count, 1);
      assert.equal(body.by_type.smart_contract.fee_rate.p50, '50');
    });

    test('per-type buckets report their own counts and sizes', async () => {
      const body = await getSummary(api);
      assert.equal(body.by_type.token_transfer.count, 4);
      assert.equal(body.by_type.contract_call.count, 2);
      // Sizes 10/20/30/40 bytes, discrete.
      assert.deepEqual(body.by_type.token_transfer.tx_size, {
        p25: 10,
        p50: 20,
        p75: 30,
        p95: 40,
      });
    });

    test('receipt percentiles are absolute, with the oldest transactions at p25', async () => {
      const body = await getSummary(api);
      // Receipt times ascending: 1000..1003, 2000, 2001, 3000.
      assert.equal(body.receipt_time.p25, 1001);
      assert.equal(body.receipt_time.p95, 3000);
      assert.ok(
        body.receipt_time.p25 < body.receipt_time.p95,
        'p25 is older than p95, not the reverse'
      );
      // All were received at the same chain tip, so every height percentile is that height.
      assert.deepEqual(body.receipt_block_height, { p25: 1, p50: 1, p75: 1, p95: 1 });
    });

    test('pruned transactions are excluded from percentiles', async () => {
      const body = await getSummary(api);
      // The pruned tx has by far the highest fee; if it leaked in it would surface at p95.
      assert.notEqual(body.fee_rate.p95, '999999');
    });
  });
});
