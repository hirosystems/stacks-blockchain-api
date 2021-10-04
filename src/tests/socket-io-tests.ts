import { io } from 'socket.io-client';
import { ChainID } from '@stacks/common';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { cycleMigrations, runMigrations, PgDataStore } from '../datastore/postgres-store';
import { DbBlock, DbMicroblockPartial, DbTx, DbTxTypeId } from '../datastore/common';
import { I32_MAX, waiter, Waiter } from '../helpers';
import { Microblock } from '../../docs/generated';

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

  test('socket-io > microblock updates', async () => {
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
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: addr1,
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
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
    const mb1: DbMicroblockPartial = {
      microblock_hash: '0xff01',
      microblock_sequence: 0,
      microblock_parent_hash: block.block_hash,
      parent_index_block_hash: block.index_block_hash,
      parent_burn_block_height: 123,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    };
    const mbTx1: DbTx = {
      tx_id: '0x02',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      type_id: DbTxTypeId.TokenTransfer,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: addr1,
      sponsor_address: undefined,
      origin_hash_mode: 1,
      token_transfer_amount: 50n,
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: addr2,
      event_count: 1,
      parent_index_block_hash: block.index_block_hash,
      parent_block_hash: block.block_hash,
      microblock_canonical: true,
      microblock_sequence: mb1.microblock_sequence,
      microblock_hash: mb1.microblock_hash,
      parent_burn_block_time: mb1.parent_burn_block_time,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      index_block_hash: '',
      block_hash: '',
      burn_block_time: -1,
      block_height: -1,
    };

    const address = apiServer.address;
    const socket = io(`http://${address}`, { query: { subscriptions: 'microblock' } });
    const updateWaiter: Waiter<Microblock> = waiter();

    socket.on('microblock', microblock => {
      updateWaiter.finish(microblock);
    });
    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    });
    await db.updateMicroblocks({
      microblocks: [mb1],
      txs: [
        {
          tx: mbTx1,
          stxLockEvents: [],
          stxEvents: [],
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
      expect(result.microblock_hash).toEqual('0xff01');
      expect(result.microblock_parent_hash).toEqual(block.block_hash);
      expect(result.txs[0]).toEqual(mbTx1.tx_id);
    } finally {
      socket.emit('unsubscribe', 'microblock');
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
