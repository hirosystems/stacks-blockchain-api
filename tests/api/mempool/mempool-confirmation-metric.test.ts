import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { DbTxTypeId, MinedMempoolTx } from '../../../src/datastore/common.ts';
import { getMempoolTxConfirmationTimes } from '../../../src/datastore/helpers.ts';
import {
  EventStreamServer,
  getEventReceiptTime,
  SNP_TIMESTAMP_HEADER,
  startEventServer,
} from '../../../src/event-stream/event-server.ts';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { PgSqlClient } from '@stacks/api-toolkit';
import { migrate } from '../../test-helpers.ts';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';

// A real token transfer taken from the `epoch-3-transition` SNP dump.
const RAW_MEMPOOL_TX =
  '0x80800000000400ad08341feab8ea788ef8045c343d21dcedc4483e0000000000000000000000000000012c00018ebc106d9348b2638573b891aa0ebaad6303d8f18f801a3600e4175baf7d44d412d2af6ec95a541a9224a538a22b7c82055730f8293fcd91899eb3757d426f6003020000000000051a62b0e91cc557e583c3d1f9dfe468ace76d2f037400000000000003e800000000000000000000000000000000000000000000000000000000000000000000';

describe('mempool confirmation time helpers', () => {
  test('getEventReceiptTime parses SNP timestamps', () => {
    assert.equal(getEventReceiptTime('1710343460976'), 1710343461);
    assert.equal(getEventReceiptTime('1710343460276'), 1710343460);
    assert.equal(getEventReceiptTime('2024-03-13 15:24:20.97639+00'), 1710343461);
    assert.equal(getEventReceiptTime(['1710343460000', '1']), 1710343460);
  });

  test('getEventReceiptTime falls back to the current time', () => {
    // Includes values that parse but don't fit a positive 32-bit integer of seconds.
    for (const header of [undefined, '', 'not-a-date', '0', '999999999999999999', '1969-12-31']) {
      const before = Math.round(Date.now() / 1000);
      const receiptTime = getEventReceiptTime(header);
      const after = Math.round(Date.now() / 1000);
      assert.ok(receiptTime >= before && receiptTime <= after);
    }
  });

  test('getMempoolTxConfirmationTimes labels by tx type and clamps negatives', () => {
    const txs: MinedMempoolTx[] = [
      { tx_id: '0x01', type_id: DbTxTypeId.TokenTransfer, receipt_time: 940 },
      { tx_id: '0x02', type_id: DbTxTypeId.ContractCall, receipt_time: 1000 },
      { tx_id: '0x03', type_id: DbTxTypeId.VersionedSmartContract, receipt_time: 1003 },
    ];
    assert.deepEqual(getMempoolTxConfirmationTimes({ blockTime: 1000, txs }, 1010, 300), [
      { type: 'token_transfer', seconds: 60 },
      { type: 'contract_call', seconds: 0 },
      { type: 'smart_contract', seconds: 0 },
    ]);
  });

  test('getMempoolTxConfirmationTimes skips blocks older than the max lag', () => {
    const txs: MinedMempoolTx[] = [
      { tx_id: '0x01', type_id: DbTxTypeId.TokenTransfer, receipt_time: 900 },
    ];
    assert.equal(getMempoolTxConfirmationTimes({ blockTime: 1000, txs }, 1300, 300).length, 1);
    assert.deepEqual(getMempoolTxConfirmationTimes({ blockTime: 1000, txs }, 1301, 300), []);
  });
});

describe('mempool confirmation time ingestion', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let eventServer: EventStreamServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    eventServer = await startEventServer({
      datastore: db,
      chainId: STACKS_TESTNET.chainId,
      serverHost: '127.0.0.1',
      serverPort: 0,
    });
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    await db?.close();
    await migrate('down');
  });

  const getReceiptTimes = async () =>
    (await client<{ receipt_time: number }[]>`SELECT receipt_time FROM mempool_txs`).map(
      r => r.receipt_time
    );

  test('mempool receipt time comes from the SNP timestamp header', async () => {
    const response = await eventServer.fastifyInstance.inject({
      method: 'POST',
      url: '/new_mempool_tx',
      payload: [RAW_MEMPOOL_TX],
      headers: { [SNP_TIMESTAMP_HEADER]: '1710343460976' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(await getReceiptTimes(), [1710343461]);
  });

  test('mempool receipt time is the current time without an SNP timestamp', async () => {
    const before = Math.round(Date.now() / 1000);
    const response = await eventServer.fastifyInstance.inject({
      method: 'POST',
      url: '/new_mempool_tx',
      payload: [RAW_MEMPOOL_TX],
    });
    const after = Math.round(Date.now() / 1000);
    assert.equal(response.statusCode, 200);
    const [receipt_time] = await getReceiptTimes();
    assert.ok(receipt_time >= before && receipt_time <= after);
  });

  test('emits only the mined txs of a canonical block', async () => {
    const sender = 'SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2';
    await db.update(new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' }).build());
    await db.updateMempoolTxs({
      mempoolTxs: [
        // Mined in the next block.
        testMempoolTx({
          tx_id: '0xaa',
          sender_address: sender,
          nonce: 0,
          receipt_time: 1000,
        }),
        // Shares the mined tx's nonce slot, so it's pruned but was not mined.
        testMempoolTx({
          tx_id: '0xbb',
          type_id: DbTxTypeId.ContractCall,
          sender_address: sender,
          nonce: 0,
          fee_rate: 1n,
          receipt_time: 1001,
        }),
        // Unrelated, stays in the mempool.
        testMempoolTx({ tx_id: '0xcc', nonce: 0, receipt_time: 1002 }),
      ],
    });

    const emitted: { blockTime: number; txs: MinedMempoolTx[] }[] = [];
    db.eventEmitter.on('mempoolTxsMined', info => emitted.push({ ...info, txs: [...info.txs] }));

    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x02',
        parent_index_block_hash: '0x01',
        block_time: 1030,
      })
        .addTx({
          tx_id: '0xaa',
          sender_address: sender,
          nonce: 0,
        })
        .build()
    );
    assert.deepEqual(emitted, [
      {
        blockTime: 1030,
        txs: [{ tx_id: '0xaa', type_id: DbTxTypeId.TokenTransfer, receipt_time: 1000 }],
      },
    ]);

    // A block whose txs never went through the mempool emits nothing.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        index_block_hash: '0x03',
        parent_index_block_hash: '0x02',
      })
        .addTx({ tx_id: '0xdd', nonce: 5 })
        .build()
    );
    assert.equal(emitted.length, 1);
  });

  test('emits a mined tx that was already pruned by replace-by-fee', async () => {
    const sender = 'SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2';
    await db.update(new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' }).build());
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0xaa',
          sender_address: sender,
          nonce: 0,
          fee_rate: 1n,
          receipt_time: 1000,
        }),
      ],
    });
    // A higher fee tx for the same nonce slot replaces it.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0xbb',
          sender_address: sender,
          nonce: 0,
          fee_rate: 100n,
          receipt_time: 1010,
        }),
      ],
    });
    const [replaced] = await client<{ pruned: boolean }[]>`
      SELECT pruned FROM mempool_txs WHERE tx_id = '\\xaa'
    `;
    assert.equal(replaced.pruned, true);

    const emitted: { blockTime: number; txs: MinedMempoolTx[] }[] = [];
    db.eventEmitter.on('mempoolTxsMined', info => emitted.push({ ...info, txs: [...info.txs] }));

    // The miner confirms the replaced tx anyway.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x02',
        parent_index_block_hash: '0x01',
        block_time: 1030,
      })
        .addTx({ tx_id: '0xaa', sender_address: sender, nonce: 0 })
        .build()
    );
    assert.deepEqual(emitted, [
      {
        blockTime: 1030,
        txs: [{ tx_id: '0xaa', type_id: DbTxTypeId.TokenTransfer, receipt_time: 1000 }],
      },
    ]);
  });
});
