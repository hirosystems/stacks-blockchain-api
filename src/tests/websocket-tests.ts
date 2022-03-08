import * as WebSocket from 'ws';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { DbTxTypeId, DbTxStatus } from '../datastore/common';
import { waiter, Waiter } from '../helpers';
import { PoolClient } from 'pg';
import { once } from 'events';
import { RpcWebSocketClient } from 'rpc-websocket-client';
import {
  RpcTxUpdateSubscriptionParams,
  RpcTxUpdateNotificationParams,
  RpcAddressTxSubscriptionParams,
  RpcAddressTxNotificationParams,
  RpcAddressBalanceSubscriptionParams,
  RpcAddressBalanceNotificationParams,
  RpcMempoolSubscriptionParams,
  MempoolTransaction,
  TransactionStatus,
  MempoolTransactionStatus,
  RpcBlockSubscriptionParams,
  Block,
  RpcMicroblockSubscriptionParams,
  Microblock,
} from '@stacks/stacks-blockchain-api-types';
import { connectWebSocketClient } from '../../client/src';
import { ChainID } from '@stacks/transactions';
import {
  TestBlockBuilder,
  testMempoolTx,
  TestMicroblockStreamBuilder,
} from '../test-utils/test-builders';

describe('websocket notifications', () => {
  let apiServer: ApiServer;

  let db: PgDataStore;
  let dbClient: PoolClient;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect({ usageName: 'tests' });
    dbClient = await db.pool.connect();
    apiServer = await startApiServer({
      datastore: db,
      chainId: ChainID.Testnet,
      httpLogLevel: 'silly',
    });
  });

  test('websocket rpc - tx subscription updates', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const socket = new WebSocket(wsAddress);
    const txId = '0x8912000000000000000000000000000000000000000000000000000000000000';

    try {
      await once(socket, 'open');
      const client = new RpcWebSocketClient();

      client.changeSocket(socket);
      client.listenMessages();

      // Subscribe to particular tx
      const subParams1: RpcTxUpdateSubscriptionParams = {
        event: 'tx_update',
        tx_id: txId,
      };
      const result = await client.call('subscribe', subParams1);
      expect(result).toEqual({ tx_id: txId });

      // Subscribe to mempool
      const subParams2: RpcMempoolSubscriptionParams = {
        event: 'mempool',
      };
      const result2 = await client.call('subscribe', subParams2);
      expect(result2).toEqual({});

      // watch for update to this tx
      let updateIndex = 0;
      const txUpdates: Waiter<TransactionStatus | MempoolTransactionStatus>[] = [
        waiter(),
        waiter(),
        waiter(),
        waiter(),
      ];
      const mempoolWaiter: Waiter<MempoolTransaction> = waiter();
      client.onNotification.push(msg => {
        if (msg.method === 'tx_update') {
          const txUpdate: RpcTxUpdateNotificationParams = msg.params;
          txUpdates[updateIndex++]?.finish(txUpdate.tx_status);
        }
        if (msg.method === 'mempool') {
          const mempoolTx: MempoolTransaction = msg.params;
          mempoolWaiter.finish(mempoolTx);
        }
      });

      const block = new TestBlockBuilder().addTx().build();
      await db.update(block);

      const mempoolTx = testMempoolTx({ tx_id: txId, status: DbTxStatus.Pending });
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

      const microblock = new TestMicroblockStreamBuilder()
        .addMicroblock()
        .addTx({ tx_id: txId })
        .build();
      await db.updateMicroblocks(microblock);

      // check for tx update notification
      const txStatus1 = await txUpdates[0];
      expect(txStatus1).toBe('pending');

      // check for mempool update
      const mempoolUpdate = await mempoolWaiter;
      expect(mempoolUpdate.tx_id).toBe(txId);

      // check for microblock tx update notification
      const txStatus2 = await txUpdates[1];
      expect(txStatus2).toBe('pending');

      // update DB with TX after WS server is sent txid to monitor
      db.emit('txUpdate', txId);

      // check for tx update notification
      const txStatus3 = await txUpdates[2];
      expect(txStatus3).toBe('pending');

      // unsubscribe from notifications for this tx
      const unsubscribeResult = await client.call('unsubscribe', subParams1);
      expect(unsubscribeResult).toEqual({ tx_id: txId });

      // ensure tx updates no longer received
      db.emit('txUpdate', txId);
      await new Promise(resolve => setImmediate(resolve));
      expect(txUpdates[3].isFinished).toBe(false);
    } finally {
      socket.terminate();
    }
  });

  test('websocket rpc - block updates', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const socket = new WebSocket(wsAddress);

    await once(socket, 'open');
    const client = new RpcWebSocketClient();
    client.changeSocket(socket);
    client.listenMessages();

    const subParams: RpcBlockSubscriptionParams = {
      event: 'block',
    };
    const subResult = await client.call('subscribe', subParams);
    expect(subResult).toEqual({});

    const updateWaiter: Waiter<Block> = waiter();
    client.onNotification.push(msg => {
      if (msg.method === 'block') {
        const blockUpdate: Block = msg.params;
        updateWaiter.finish(blockUpdate);
      }
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
      socket.terminate();
    }
  });

  test('websocket rpc - microblock updates', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const socket = new WebSocket(wsAddress);

    await once(socket, 'open');
    const client = new RpcWebSocketClient();
    client.changeSocket(socket);
    client.listenMessages();

    const subParams: RpcMicroblockSubscriptionParams = {
      event: 'microblock',
    };
    const subResult = await client.call('subscribe', subParams);
    expect(subResult).toEqual({});

    const updateWaiter: Waiter<Microblock> = waiter();
    client.onNotification.push(msg => {
      if (msg.method === 'microblock') {
        const microblockUpdate: Microblock = msg.params;
        updateWaiter.finish(microblockUpdate);
      }
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
      socket.terminate();
    }
  });

  test('websocket rpc - address tx subscription updates', async () => {
    const wsAddress = `ws://${apiServer.address}/extended/v1/ws`;
    const socket = new WebSocket(wsAddress);
    const client = new RpcWebSocketClient();
    const addr = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const subParams: RpcAddressTxSubscriptionParams = {
      event: 'address_tx_update',
      address: addr,
    };

    try {
      await once(socket, 'open');
      client.changeSocket(socket);
      client.listenMessages();
      const result = await client.call('subscribe', subParams);
      expect(result).toEqual({ address: addr });

      let updateIndex = 0;
      const addrTxUpdates: Waiter<RpcAddressTxNotificationParams>[] = [waiter(), waiter()];
      client.onNotification.push(msg => {
        if (msg.method === 'address_tx_update') {
          const txUpdate: RpcAddressTxNotificationParams = msg.params;
          addrTxUpdates[updateIndex++]?.finish(txUpdate);
        } else {
          fail(msg.method);
        }
      });

      const block = new TestBlockBuilder({
        block_height: 1,
        block_hash: '0x01',
        index_block_hash: '0x01',
      })
        .addTx({
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
          sender_address: addr,
          type_id: DbTxTypeId.TokenTransfer,
          status: DbTxStatus.Success,
        })
        .addTxStxEvent({ sender: addr })
        .build();
      await db.update(block);
      const txUpdate1 = await addrTxUpdates[0];
      expect(txUpdate1).toEqual({
        address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
        tx_status: 'success',
        tx_type: 'token_transfer',
      });

      const microblock = new TestMicroblockStreamBuilder()
        .addMicroblock({
          microblock_hash: '0x11',
          parent_index_block_hash: '0x01',
        })
        .addTx({
          tx_id: '0x8913',
          sender_address: addr,
          token_transfer_amount: 150n,
          fee_rate: 50n,
          type_id: DbTxTypeId.TokenTransfer,
        })
        .addTxStxEvent({ sender: addr, amount: 150n })
        .build();
      await db.updateMicroblocks(microblock);
      const txUpdate2 = await addrTxUpdates[1];
      expect(txUpdate2).toEqual({
        address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        tx_id: '0x8913',
        tx_status: 'success',
        tx_type: 'token_transfer',
      });
    } finally {
      await client.call('unsubscribe', subParams);
      socket.terminate();
    }
  });

  test('websocket rpc - address balance subscription updates', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const socket = new WebSocket(wsAddress);

    try {
      await once(socket, 'open');
      const client = new RpcWebSocketClient();
      const addr2 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

      client.changeSocket(socket);
      client.listenMessages();
      const subParams1: RpcAddressBalanceSubscriptionParams = {
        event: 'address_balance_update',
        address: addr2,
      };
      const result = await client.call('subscribe', subParams1);
      expect(result).toEqual({ address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6' });

      // watch for update to this tx
      let updateIndex = 0;
      const balanceUpdates: Waiter<RpcAddressBalanceNotificationParams>[] = [
        waiter(),
        waiter(),
        waiter(),
      ];
      client.onNotification.push(msg => {
        if (msg.method === 'address_balance_update') {
          const txUpdate: RpcAddressBalanceNotificationParams = msg.params;
          balanceUpdates[updateIndex++]?.finish(txUpdate);
        }
      });

      const block = new TestBlockBuilder()
        .addTx({
          token_transfer_recipient_address: addr2,
          token_transfer_amount: 100n,
        })
        .addTxStxEvent({ recipient: addr2, amount: 100n })
        .build();
      await db.update(block);

      // check for balance update notification
      const txUpdate1 = await balanceUpdates[0];
      expect(txUpdate1).toEqual({
        address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        balance: '100',
      });

      const unsubscribeResult = await client.call('unsubscribe', subParams1);
      expect(unsubscribeResult).toEqual({ address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6' });
    } finally {
      socket.terminate();
    }
  });

  test('websocket rpc client lib', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const client = await connectWebSocketClient(wsAddress);
    try {
      const addrTxUpdates: Waiter<RpcAddressTxNotificationParams> = waiter();
      const subscription = await client.subscribeAddressTransactions(
        'ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA',
        event => addrTxUpdates.finish(event)
      );

      const block = new TestBlockBuilder()
        .addTx({
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
          sender_address: 'ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA',
          type_id: DbTxTypeId.TokenTransfer,
          status: DbTxStatus.Success,
        })
        .addTxStxEvent({ sender: addr })
        .build();
      await db.update(block);

      // check for tx update notification
      const txUpdate1 = await addrTxUpdates;
      expect(txUpdate1).toEqual({
        address: 'ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA',
        tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
        tx_status: 'success',
        tx_type: 'token_transfer',
      });
      await subscription.unsubscribe();
    } finally {
      client.webSocket.close();
    }
  });

  afterEach(async () => {
    await apiServer.terminate();
    dbClient.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
