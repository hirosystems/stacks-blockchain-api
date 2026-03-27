import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { DbTxTypeId, DbTxStatus, DbAssetEventTypeId } from '../../../src/datastore/common.ts';
import { RpcWebSocketClient } from 'rpc-websocket-client';
import WebSocket from 'ws';
import { once } from 'events';
import { TestBlockBuilder, testMempoolTx, TestMicroblockStreamBuilder } from '../test-builders.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { Waiter, waiter } from '@stacks/api-toolkit';
import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import {
  RpcTxUpdateSubscriptionParams,
  RpcMempoolSubscriptionParams,
  RpcAddressTxNotificationParams,
  MempoolTransaction,
  RpcBlockSubscriptionParams,
  RpcMicroblockSubscriptionParams,
  Microblock,
  RpcAddressTxSubscriptionParams,
  RpcAddressBalanceSubscriptionParams,
  RpcAddressBalanceNotificationParams,
  RpcNftEventSubscriptionParams,
  RpcNftAssetEventSubscriptionParams,
  RpcNftCollectionEventSubscriptionParams,
  NftEvent,
  Block,
} from '../../../client/src/types.ts';
import WsClient from '../../../client/src/ws/index.ts';
import { STACKS_TESTNET } from '@stacks/network';

type RpcClientSocket = Parameters<RpcWebSocketClient['changeSocket']>[0];

describe('websocket notifications', () => {
  let apiServer: ApiServer;
  let db: PgWriteStore;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', skipMigrations: true });
    apiServer = await startApiServer({
      datastore: db,
      chainId: STACKS_TESTNET.chainId,
    });
  });

  afterEach(async () => {
    await apiServer.terminate();
    await db?.close();
    await migrate('down');
  });

  test('websocket rpc - tx subscription updates', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const socket = new WebSocket(wsAddress);
    const txId = '0x8912000000000000000000000000000000000000000000000000000000000000';

    try {
      await once(socket, 'open');
      const client = new RpcWebSocketClient();

      client.changeSocket(socket as unknown as RpcClientSocket);
      client.listenMessages();

      // Subscribe to particular tx
      const subParams1: RpcTxUpdateSubscriptionParams = {
        event: 'tx_update',
        tx_id: txId,
      };
      const result = await client.call('subscribe', subParams1);
      assert.deepEqual(result, { tx_id: txId });

      // Subscribe to mempool
      const subParams2: RpcMempoolSubscriptionParams = {
        event: 'mempool',
      };
      const result2 = await client.call('subscribe', subParams2);
      assert.deepEqual(result2, {});

      // watch for update to this tx
      let updateIndex = 0;
      const txUpdates: Waiter<RpcAddressTxNotificationParams['tx_status']>[] = [
        waiter(),
        waiter(),
        waiter(),
        waiter(),
      ];
      const mempoolWaiter: Waiter<MempoolTransaction> = waiter();
      client.onNotification.push(msg => {
        if (msg.method === 'tx_update') {
          const txUpdate: RpcAddressTxNotificationParams = msg.params;
          txUpdates[updateIndex++]?.finish(txUpdate.tx_status);
        }
        if (msg.method === 'mempool') {
          const mempoolTx: MempoolTransaction = msg.params;
          mempoolWaiter.finish(mempoolTx);
        }
      });

      const block = new TestBlockBuilder().addTx().build();
      await db.update(block);

      const mempoolTx = testMempoolTx({
        tx_id: txId,
        status: DbTxStatus.Pending,
        sender_address: 'TEST',
      });
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

      const microblock = new TestMicroblockStreamBuilder()
        .addMicroblock()
        .addTx({ tx_id: txId })
        .build();
      await db.updateMicroblocks(microblock);

      // check for tx update notification
      const txStatus1 = await txUpdates[0];
      assert.equal(txStatus1, 'pending');

      // check for mempool update
      const mempoolUpdate = await mempoolWaiter;
      assert.equal(mempoolUpdate.tx_id, txId);

      // check for microblock tx update notification
      const txStatus2 = await txUpdates[1];
      assert.equal(txStatus2, 'success');

      // update DB with TX after WS server is sent txid to monitor
      db.eventEmitter.emit('txUpdate', txId);

      // check for tx update notification
      const txStatus3 = await txUpdates[2];
      assert.equal(txStatus3, 'success');

      // unsubscribe from notifications for this tx
      const unsubscribeResult = await client.call('unsubscribe', subParams1);
      assert.deepEqual(unsubscribeResult, { tx_id: txId });

      // ensure tx updates no longer received
      db.eventEmitter.emit('txUpdate', txId);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(txUpdates[3].isFinished, false);
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
    client.changeSocket(socket as unknown as RpcClientSocket);
    client.listenMessages();

    const subParams: RpcBlockSubscriptionParams = {
      event: 'block',
    };
    const subResult = await client.call('subscribe', subParams);
    assert.deepEqual(subResult, {});

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
      assert.equal(result.hash, '0x1234');
      assert.equal(result.burn_block_hash, '0x5454');
      assert.equal(result.txs[0], '0x4321');
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
    client.changeSocket(socket as unknown as RpcClientSocket);
    client.listenMessages();

    const subParams: RpcMicroblockSubscriptionParams = {
      event: 'microblock',
    };
    const subResult = await client.call('subscribe', subParams);
    assert.deepEqual(subResult, {});

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
      assert.equal(result.microblock_hash, '0xff01');
      assert.equal(result.microblock_parent_hash, '0x1212');
      assert.equal(result.txs[0], '0xf6f6');
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
      client.changeSocket(socket as unknown as RpcClientSocket);
      client.listenMessages();
      const result = await client.call('subscribe', subParams);
      assert.deepEqual(result, { address: addr });

      let updateIndex = 0;
      const addrTxUpdates: Waiter<RpcAddressTxNotificationParams>[] = [waiter(), waiter()];
      client.onNotification.push(msg => {
        if (msg.method === 'address_tx_update') {
          const txUpdate: RpcAddressTxNotificationParams = msg.params;
          addrTxUpdates[updateIndex++]?.finish(txUpdate);
        } else {
          assert.fail(msg.method);
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
      assert.deepEqual(txUpdate1, {
        address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
        tx_status: 'success',
        tx_type: 'token_transfer',
        stx_received: '100',
        stx_sent: '150',
        stx_transfers: [
          {
            amount: '100',
            recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          },
        ],
        tx: {
          anchor_mode: 'any',
          block_hash: '0x01',
          block_height: 1,
          block_time: 94869287,
          block_time_iso: '1973-01-03T00:34:47.000Z',
          burn_block_height: 1,
          burn_block_time: 94869286,
          burn_block_time_iso: '1973-01-03T00:34:46.000Z',
          canonical: true,
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          fee_rate: '50',
          is_unanchored: false,
          microblock_canonical: true,
          microblock_hash: '0x123466',
          microblock_sequence: 0,
          nonce: 0,
          parent_block_hash: '0x123456',
          parent_burn_block_time: 94869286,
          parent_burn_block_time_iso: '1973-01-03T00:34:46.000Z',
          post_condition_mode: 'allow',
          post_conditions: [],
          sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          sponsored: false,
          token_transfer: {
            amount: '100',
            memo: '0x',
            recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
          tx_index: 0,
          tx_result: {
            hex: '0x0703',
            repr: '(ok true)',
          },
          tx_status: 'success',
          tx_type: 'token_transfer',
          vm_error: null,
        },
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
      assert.deepEqual(txUpdate2, {
        address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        tx_id: '0x8913',
        tx_status: 'success',
        tx_type: 'token_transfer',
        stx_received: '150',
        stx_sent: '200',
        stx_transfers: [
          {
            amount: '150',
            recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            sender: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          },
        ],
        tx: {
          anchor_mode: 'any',
          block_hash: '0x123456',
          block_height: 2,
          block_time: 94869287,
          block_time_iso: '1973-01-03T00:34:47.000Z',
          burn_block_height: 1,
          burn_block_time: 94869286,
          burn_block_time_iso: '1973-01-03T00:34:46.000Z',
          canonical: true,
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          fee_rate: '50',
          is_unanchored: false,
          microblock_canonical: true,
          microblock_hash: '0x11',
          microblock_sequence: 0,
          nonce: 0,
          parent_block_hash: '0x01',
          parent_burn_block_time: 94869286,
          parent_burn_block_time_iso: '1973-01-03T00:34:46.000Z',
          post_condition_mode: 'allow',
          post_conditions: [],
          sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          sponsored: false,
          token_transfer: {
            amount: '150',
            memo: '0x',
            recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          },
          tx_id: '0x8913',
          tx_index: 0,
          tx_result: {
            hex: '0x0703',
            repr: '(ok true)',
          },
          tx_status: 'success',
          tx_type: 'token_transfer',
          vm_error: null,
        },
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

      client.changeSocket(socket as unknown as RpcClientSocket);
      client.listenMessages();
      const subParams1: RpcAddressBalanceSubscriptionParams = {
        event: 'address_balance_update',
        address: addr2,
      };
      const result = await client.call('subscribe', subParams1);
      assert.deepEqual(result, { address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6' });

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
      assert.deepEqual(txUpdate1, {
        address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        balance: '100',
        burnchain_lock_height: 0,
        burnchain_unlock_height: 0,
        lock_height: 0,
        lock_tx_id: '',
        locked: '0',
        total_fees_sent: '0',
        total_miner_rewards_received: '0',
        total_received: '100',
        total_sent: '0',
      });

      const unsubscribeResult = await client.call('unsubscribe', subParams1);
      assert.deepEqual(unsubscribeResult, { address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6' });
    } finally {
      socket.terminate();
    }
  });

  test('websocket rpc - nft event updates', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const socket = new WebSocket(wsAddress);

    try {
      await once(socket, 'open');
      const client = new RpcWebSocketClient();
      client.changeSocket(socket as unknown as RpcClientSocket);
      client.listenMessages();

      const crashPunks = 'SP3QSAJQ4EA8WXEDSRRKMZZ29NH91VZ6C5X88FGZQ.crashpunks-v2::crashpunks-v2';
      const wastelandApes =
        'SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.wasteland-apes-nft::Wasteland-Apes';
      const valueHex1 = '0x0100000000000000000000000000000d55';
      const valueHex2 = '0x0100000000000000000000000000000095';
      const stxAddress1 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

      // subscribe
      const subParams1: RpcNftEventSubscriptionParams = {
        event: 'nft_event',
      };
      const result1 = await client.call('subscribe', subParams1);
      assert.deepEqual(result1, {});

      const subParams2: RpcNftAssetEventSubscriptionParams = {
        event: 'nft_asset_event',
        asset_identifier: crashPunks,
        value: valueHex1,
      };
      const result2 = await client.call('subscribe', subParams2);
      assert.deepEqual(result2, { asset_identifier: crashPunks, value: valueHex1 });

      const subParams3: RpcNftCollectionEventSubscriptionParams = {
        event: 'nft_collection_event',
        asset_identifier: wastelandApes,
      };
      const result3 = await client.call('subscribe', subParams3);
      assert.deepEqual(result3, { asset_identifier: wastelandApes });

      const nftEventWaiters: Waiter<NftEvent>[] = [waiter(), waiter(), waiter(), waiter()];
      const crashPunksWaiter: Waiter<NftEvent> = waiter();
      const apeWaiters: Waiter<NftEvent>[] = [waiter(), waiter()];
      client.onNotification.push(msg => {
        const event: NftEvent = msg.params;
        switch (msg.method) {
          case 'nft_event':
            nftEventWaiters[event.event_index].finish(event);
            break;
          case 'nft_asset_event':
            if (event.asset_identifier == crashPunks && event.value.hex == valueHex1) {
              crashPunksWaiter.finish(event);
            }
            break;
          case 'nft_collection_event':
            if (event.asset_identifier == wastelandApes) {
              if (event.event_index == 2) {
                apeWaiters[0].finish(event);
              } else if (event.event_index == 3) {
                apeWaiters[1].finish(event);
              }
            }
            break;
        }
      });

      const block = new TestBlockBuilder()
        .addTx({
          tx_id: '0x01',
        })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Mint,
          asset_identifier: crashPunks,
          value: valueHex1,
          recipient: stxAddress1,
          event_index: 0,
        })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Mint,
          asset_identifier: crashPunks,
          value: valueHex2,
          recipient: stxAddress1,
          event_index: 1,
        })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Mint,
          asset_identifier: wastelandApes,
          value: valueHex1,
          recipient: stxAddress1,
          event_index: 2,
        })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Mint,
          asset_identifier: wastelandApes,
          value: valueHex2,
          recipient: stxAddress1,
          event_index: 3,
        })
        .build();
      await db.update(block);

      const expectedEvent0 = {
        asset_event_type: 'mint',
        asset_identifier: 'SP3QSAJQ4EA8WXEDSRRKMZZ29NH91VZ6C5X88FGZQ.crashpunks-v2::crashpunks-v2',
        block_height: 1,
        event_index: 0,
        recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        sender: null,
        tx_id: '0x01',
        tx_index: 0,
        value: { hex: '0x0100000000000000000000000000000d55', repr: 'u3413' },
      };
      const expectedEvent1 = {
        asset_event_type: 'mint',
        asset_identifier: 'SP3QSAJQ4EA8WXEDSRRKMZZ29NH91VZ6C5X88FGZQ.crashpunks-v2::crashpunks-v2',
        block_height: 1,
        event_index: 1,
        recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        sender: null,
        tx_id: '0x01',
        tx_index: 0,
        value: { hex: '0x0100000000000000000000000000000095', repr: 'u149' },
      };
      const expectedEvent2 = {
        asset_event_type: 'mint',
        asset_identifier:
          'SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.wasteland-apes-nft::Wasteland-Apes',
        block_height: 1,
        event_index: 2,
        recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        sender: null,
        tx_id: '0x01',
        tx_index: 0,
        value: { hex: '0x0100000000000000000000000000000d55', repr: 'u3413' },
      };
      const expectedEvent3 = {
        asset_event_type: 'mint',
        asset_identifier:
          'SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.wasteland-apes-nft::Wasteland-Apes',
        block_height: 1,
        event_index: 3,
        recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        sender: null,
        tx_id: '0x01',
        tx_index: 0,
        value: { hex: '0x0100000000000000000000000000000095', repr: 'u149' },
      };

      const event0 = await nftEventWaiters[0];
      const event1 = await nftEventWaiters[1];
      const event2 = await nftEventWaiters[2];
      const event3 = await nftEventWaiters[3];
      const crashEvent = await crashPunksWaiter;
      const apeEvent0 = await apeWaiters[0];
      const apeEvent1 = await apeWaiters[1];

      assert.deepEqual(event0, expectedEvent0);
      assert.deepEqual(event1, expectedEvent1);
      assert.deepEqual(event2, expectedEvent2);
      assert.deepEqual(event3, expectedEvent3);

      assert.deepEqual(crashEvent, expectedEvent0);

      assert.deepEqual(apeEvent0, expectedEvent2);
      assert.deepEqual(apeEvent1, expectedEvent3);

      const unsubscribeResult1 = await client.call('unsubscribe', subParams1);
      assert.deepEqual(unsubscribeResult1, {});

      const unsubscribeResult2 = await client.call('unsubscribe', subParams2);
      assert.deepEqual(unsubscribeResult2, { asset_identifier: crashPunks, value: valueHex1 });

      const unsubscribeResult3 = await client.call('unsubscribe', subParams3);
      assert.deepEqual(unsubscribeResult3, { asset_identifier: wastelandApes });
    } finally {
      socket.terminate();
    }
  });

  test('websocket rpc client lib', async () => {
    const addr = apiServer.address;
    const wsAddress = `ws://${addr}/extended/v1/ws`;
    const client = await WsClient.StacksApiWebSocketClient.connect(wsAddress);
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
      assert.deepEqual(txUpdate1, {
        address: 'ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA',
        tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
        tx_status: 'success',
        tx_type: 'token_transfer',
        stx_received: '0',
        stx_sent: '50',
        stx_transfers: [],
        tx: {
          anchor_mode: 'any',
          block_hash: '0x123456',
          block_height: 1,
          block_time: 94869287,
          block_time_iso: '1973-01-03T00:34:47.000Z',
          burn_block_height: 1,
          burn_block_time: 94869286,
          burn_block_time_iso: '1973-01-03T00:34:46.000Z',
          canonical: true,
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          fee_rate: '50',
          is_unanchored: false,
          microblock_canonical: true,
          microblock_hash: '0x123466',
          microblock_sequence: 0,
          nonce: 0,
          parent_block_hash: '0x123456',
          parent_burn_block_time: 94869286,
          parent_burn_block_time_iso: '1973-01-03T00:34:46.000Z',
          post_condition_mode: 'allow',
          post_conditions: [],
          sender_address: 'ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA',
          sponsored: false,
          token_transfer: {
            amount: '100',
            memo: '0x',
            recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
          tx_index: 0,
          tx_result: {
            hex: '0x0703',
            repr: '(ok true)',
          },
          tx_status: 'success',
          tx_type: 'token_transfer',
          vm_error: null,
        },
      });
      await subscription.unsubscribe();
    } finally {
      client.webSocket.close();
    }
  });
});
