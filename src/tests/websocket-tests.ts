import * as WebSocket from 'ws';
import { startApiServer, ApiServer } from '../api/init';
import { MemoryDataStore } from '../datastore/memory-store';
import { waiter } from '../helpers';
import {
  DbTx,
  DbTxTypeId,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbStxEvent,
  DataStoreUpdateData,
  DbBlock,
} from '../datastore/common';

describe('websocket notifications', () => {
  let apiServer: ApiServer;

  let db: MemoryDataStore;
  let map: Map<string, Set<WebSocket>>;

  beforeEach(async () => {
    db = new MemoryDataStore();
    map = new Map();
    apiServer = await startApiServer(db, map);
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
      status: 1,
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
    const client = new WebSocket(wsAddress);

    // promise that completes upon first message from a client
    const wssSubscribed = waiter();
    apiServer.wss.once('connection', ws => ws.once('message', wssSubscribed.finish));

    try {
      await new Promise((resolve, reject) => {
        client.once('open', resolve);
        client.once('error', reject);
      });

      // subscribe client to a transaction
      await new Promise((resolve, reject) =>
        client.send('0x1234', error => (error ? reject(error) : resolve()))
      );

      // allow server to finish handling the client ws subscription
      await wssSubscribed;

      // client listen for tx updates
      const msgReceived = waiter<string>();
      client.once('message', msgReceived.finish);

      // update DB with TX after WS server is sent txid to monitor
      await db.update(dbUpdate);

      // check that the tx update message is what we expect
      const msgResult = await msgReceived;
      expect(JSON.parse(msgResult)).toEqual({ txId: tx.tx_id, status: 'success' });
    } finally {
      client.terminate();
    }
  });

  afterEach(async () => {
    await apiServer.terminate();
  });
});
