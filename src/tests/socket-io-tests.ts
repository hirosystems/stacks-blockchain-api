import { io } from 'socket.io-client';
import { ChainID } from '@stacks/common';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { cycleMigrations, runMigrations, PgDataStore } from '../datastore/postgres-store';
import {
  DbAssetEventTypeId,
  DbBlock,
  DbEventTypeId,
  DbMempoolTx,
  DbStxEvent,
  DbTx,
  DbTxStatus,
  DbTxTypeId,
} from '../datastore/common';
import { I32_MAX, waiter, Waiter } from '../helpers';
import {
  Block,
  Microblock,
  MempoolTransaction,
  AddressTransactionWithTransfers,
  AddressStxBalanceResponse,
} from '../../docs/generated';
import {
  TestBlockBuilder,
  testMempoolTx,
  TestMicroblockStreamBuilder,
} from '../test-utils/test-builders';

describe('socket-io', () => {
  let apiServer: ApiServer;
  let db: PgDataStore;
  let dbClient: PoolClient;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    dbClient = await db.pool.connect();
    apiServer = await startApiServer({
      datastore: db,
      chainId: ChainID.Testnet,
      httpLogLevel: 'silly',
    });
  });

  test('socket-io > block updates', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, { query: { subscriptions: 'block' } });
    const updateWaiter: Waiter<Block> = waiter();
    socket.on('block', block => {
      updateWaiter.finish(block);
    });

    const block = new TestBlockBuilder({ block_hash: '0x1234', burn_block_hash: '0x5454' })
      .addTx({ tx_id: '0x4321' })
      .build();
    await db.update(block);

    const result = await updateWaiter;
    try {
      expect(result.hash).toEqual('0x1234');
      expect(result.burn_block_hash).toEqual('0x5454');
      expect(result.txs[0]).toEqual('0x4321');
    } finally {
      socket.emit('unsubscribe', 'block');
      socket.close();
    }
  });

  test('socket-io > microblock updates', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, { query: { subscriptions: 'microblock' } });
    const updateWaiter: Waiter<Microblock> = waiter();
    socket.on('microblock', microblock => {
      updateWaiter.finish(microblock);
    });

    const block = new TestBlockBuilder({ block_hash: '0x1212', index_block_hash: '0x4343' })
      .addTx()
      .build();
    await db.update(block);
    const microblocks = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0xff01',
        microblock_parent_hash: '0x1212',
        parent_index_block_hash: '0x4343',
      })
      .addTx({ tx_id: '0xf6f6' })
      .build();
    await db.updateMicroblocks(microblocks);

    const result = await updateWaiter;
    try {
      expect(result.microblock_hash).toEqual('0xff01');
      expect(result.microblock_parent_hash).toEqual('0x1212');
      expect(result.txs[0]).toEqual('0xf6f6');
    } finally {
      socket.emit('unsubscribe', 'microblock');
      socket.close();
    }
  });

  test('socket-io > tx updates', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      query: { subscriptions: 'mempool,transaction:0x01' },
    });
    const mempoolWaiter: Waiter<MempoolTransaction> = waiter();
    const txWaiter: Waiter<MempoolTransaction> = waiter();
    socket.on('mempool', tx => {
      mempoolWaiter.finish(tx);
    });
    socket.on('transaction', tx => {
      txWaiter.finish(tx);
    });

    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);

    const mempoolTx = testMempoolTx({ tx_id: '0x01', status: DbTxStatus.Pending });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const mempoolResult = await mempoolWaiter;
    const txResult = await txWaiter;
    try {
      expect(mempoolResult.tx_status).toEqual('pending');
      expect(mempoolResult.tx_id).toEqual('0x01');
      expect(txResult.tx_status).toEqual('pending');
      expect(txResult.tx_id).toEqual('0x01');
    } finally {
      socket.emit('unsubscribe', 'mempool');
      socket.emit('unsubscribe', 'transaction:0x01');
      socket.close();
    }
  });

  test('socket-io > address tx updates', async () => {
    const addr1 = 'ST28D4Q6RCQSJ6F7TEYWQDS4N1RXYEP9YBWMYSB97';
    const addr2 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx1: DbTx = {
      tx_id: '0x8912',
      tx_index: 1,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('raw-tx-test'),
      index_block_hash: block.block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 50n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: addr1,
      origin_hash_mode: 1,
      token_transfer_recipient_address: addr2,
      token_transfer_amount: 100n,
      token_transfer_memo: Buffer.from('memo'),
      event_count: 1,
      parent_index_block_hash: '',
      parent_block_hash: '',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const stxEvent: DbStxEvent = {
      canonical: tx1.canonical,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: tx1.tx_id,
      tx_index: tx1.tx_index,
      block_height: tx1.block_height,
      amount: tx1.token_transfer_amount as bigint,
      recipient: tx1.token_transfer_recipient_address,
      sender: tx1.sender_address,
    };

    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      query: { subscriptions: `address-transaction:${addr1}` },
    });
    const updateWaiter: Waiter<AddressTransactionWithTransfers> = waiter();

    socket.on(`address-transaction:${addr1}`, (_, tx) => {
      updateWaiter.finish(tx);
    });
    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [stxEvent],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    });

    const result = await updateWaiter;
    try {
      expect(result.tx.tx_id).toEqual('0x8912');
      expect(result.stx_sent).toEqual('150'); // Incl. fees
      expect(result.stx_transfers[0].amount).toEqual('100');
    } finally {
      socket.emit('unsubscribe', `address-transaction:${addr1}`);
      socket.close();
    }
  });

  test('socket-io > address balance updates', async () => {
    const addr1 = 'ST28D4Q6RCQSJ6F7TEYWQDS4N1RXYEP9YBWMYSB97';
    const addr2 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx1: DbTx = {
      tx_id: '0x01',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: addr1,
      origin_hash_mode: 1,
      token_transfer_recipient_address: addr2,
      token_transfer_amount: 100n,
      token_transfer_memo: Buffer.from('memo'),
      event_count: 1,
      parent_index_block_hash: '',
      parent_block_hash: '',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const stxEvent: DbStxEvent = {
      canonical: tx1.canonical,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: tx1.tx_id,
      tx_index: tx1.tx_index,
      block_height: tx1.block_height,
      amount: tx1.token_transfer_amount as bigint,
      recipient: tx1.token_transfer_recipient_address,
      sender: tx1.sender_address,
    };

    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      query: { subscriptions: `address-stx-balance:${addr2}` },
    });
    const updateWaiter: Waiter<AddressStxBalanceResponse> = waiter();

    socket.on(`address-stx-balance:${addr2}`, (_, tx) => {
      updateWaiter.finish(tx);
    });
    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [stxEvent],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    });

    const result = await updateWaiter;
    try {
      expect(result.balance).toEqual('100');
    } finally {
      socket.emit('unsubscribe', `address-stx-balance:${addr2}`);
      socket.close();
    }
  });

  afterEach(async () => {
    await apiServer.terminate();
    dbClient.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
