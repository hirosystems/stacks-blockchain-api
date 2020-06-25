import * as WebSocket from 'ws';
import { Server } from 'http';
import { startApiServer } from '../api/init';
import { MemoryDataStore } from '../datastore/memory-store';
import { ExpressWithAsync } from '@awaitjs/express';
import {
  DbTx,
  DbTxTypeId,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbStxEvent,
  DataStoreUpdateData,
  DbBlock,
} from '../datastore/common';

import WebSocketAsPromised = require('websocket-as-promised');

describe('websocket notifications', () => {
  let apiServer: {
    expressApp: ExpressWithAsync;
    server: Server;
    wss: WebSocket.Server;
    address: string;
  };

  let db: MemoryDataStore;
  let map: Map<string, Set<WebSocket>>;

  beforeAll(async () => {
    db = new MemoryDataStore();
    map = new Map();
    apiServer = await startApiServer(db, map);
  });

  test('websocket connect endpoint', async done => {
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

    // ws
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/sidecar/v1/ws`;
    // const ws = new WebSocket(wsAddress);
    const wsp = new WebSocketAsPromised(wsAddress, {
      // @ts-ignore
      createWebSocket: url => new WebSocket(url),
      extractMessageData: (event: any) => event,
    });

    wsp.onSend.addListener(async () => {
      await db.update(dbUpdate);
    });

    wsp.onMessage.addListener(async (data: any) => {
      expect(JSON.parse(data)).toEqual({ txId: tx.tx_id, status: 'success' });
      await wsp.close();
      done();
    });

    await wsp.open();
    wsp.send('0x1234');
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => {
      apiServer.server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  });
});
