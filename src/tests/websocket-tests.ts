import * as WebSocket from 'ws';
import { startApiServer, ApiServer } from '../api/init';
import { MemoryDataStore } from '../datastore/memory-store';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import {
  DbTx,
  DbTxTypeId,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbStxEvent,
  DataStoreUpdateData,
  DbBlock,
  DbTxStatus,
} from '../datastore/common';
import { PoolClient } from 'pg';
import { once } from 'events';

describe('websocket notifications', () => {
  let apiServer: ApiServer;

  let db: PgDataStore;
  let dbClient: PoolClient;
  let subscribers: Map<string, Set<WebSocket>>;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    dbClient = await db.pool.connect();

    subscribers = new Map();

    apiServer = await startApiServer(db, subscribers);
  });

  test('websocket connect endpoint', async () => {
    // build the db block, tx, and event
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1,
      burn_block_time: 94869286,
      canonical: true,
    };

    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.TokenTransfer,
      status: DbTxStatus.Pending,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA',
      origin_hash_mode: 1,
      token_transfer_recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      token_transfer_amount: BigInt(100),
      token_transfer_memo: new Buffer('memo'),
    };

    const stxEvent: DbStxEvent = {
      canonical: tx.canonical,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      amount: tx.token_transfer_amount as bigint,
      recipient: tx.token_transfer_recipient_address,
      sender: tx.sender_address,
    };

    const dbUpdate: DataStoreUpdateData = {
      block,
      txs: [
        {
          tx,
          stxEvents: [stxEvent],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
        },
      ],
    };

    // set up the websocket client
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/sidecar/v1`;
    const wsClient = new WebSocket(wsAddress);

    // get the WS server's client connection
    const [serverWSClient] = await once(apiServer.wss, 'connection');

    try {
      // wait for WS client connection to open
      await once(wsClient, 'open');

      // subscribe client to a transaction
      await new Promise((resolve, reject) =>
        wsClient.send('0x1234', error => (error ? reject(error) : resolve()))
      );

      // wait for serever to receive tx subscription message from client
      await once(serverWSClient, 'message');

      // update mempool tx
      await db.updateMempoolTx({ mempoolTx: tx });
      const [msg1] = await once(wsClient, 'message');
      expect(JSON.parse(msg1.data)).toEqual({ txId: tx.tx_id, status: 'pending' });

      // update DB with TX after WS server is sent txid to monitor
      tx.status = DbTxStatus.Success;
      await db.update(dbUpdate);
      const [msg2] = await once(wsClient, 'message');
      expect(JSON.parse(msg2.data)).toEqual({ txId: tx.tx_id, status: 'success' });
    } finally {
      wsClient.terminate();
    }
  });

  afterEach(async () => {
    await apiServer.terminate();
    dbClient.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
