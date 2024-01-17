import * as WebSocket from 'ws';
import { startApiServer, ApiServer } from '../api/init';
import { DbTxTypeId, DbTxStatus, DbAssetEventTypeId } from '../datastore/common';
import { once } from 'events';
import { RpcWebSocketClient } from 'rpc-websocket-client';
import {
  RpcTxUpdateSubscriptionParams,
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
  RpcNftEventSubscriptionParams,
  RpcNftAssetEventSubscriptionParams,
  RpcNftCollectionEventSubscriptionParams,
  NftEvent,
} from '@stacks/stacks-blockchain-api-types';
import { connectWebSocketClient } from '../../client/src';
import { ChainID } from '@stacks/transactions';
import {
  TestBlockBuilder,
  testMempoolTx,
  TestMicroblockStreamBuilder,
} from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { migrate } from '../test-utils/test-helpers';
import { Waiter, waiter } from '@hirosystems/api-toolkit';

describe('websocket notifications', () => {
  let apiServer: ApiServer;
  let db: PgWriteStore;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', skipMigrations: true });
    apiServer = await startApiServer({
      datastore: db,
      chainId: ChainID.Testnet,
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
      expect(txStatus2).toBe('success');

      // update DB with TX after WS server is sent txid to monitor
      db.eventEmitter.emit('txUpdate', txId);

      // check for tx update notification
      const txStatus3 = await txUpdates[2];
      expect(txStatus3).toBe('success');

      // unsubscribe from notifications for this tx
      const unsubscribeResult = await client.call('unsubscribe', subParams1);
      expect(unsubscribeResult).toEqual({ tx_id: txId });

      // ensure tx updates no longer received
      db.eventEmitter.emit('txUpdate', txId);
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
      expect(txUpdate2).toEqual({
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
      expect(unsubscribeResult).toEqual({ address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6' });
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
      client.changeSocket(socket);
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
      expect(result1).toEqual({});

      const subParams2: RpcNftAssetEventSubscriptionParams = {
        event: 'nft_asset_event',
        asset_identifier: crashPunks,
        value: valueHex1,
      };
      const result2 = await client.call('subscribe', subParams2);
      expect(result2).toEqual({ asset_identifier: crashPunks, value: valueHex1 });

      const subParams3: RpcNftCollectionEventSubscriptionParams = {
        event: 'nft_collection_event',
        asset_identifier: wastelandApes,
      };
      const result3 = await client.call('subscribe', subParams3);
      expect(result3).toEqual({ asset_identifier: wastelandApes });

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

      expect(event0).toEqual(expectedEvent0);
      expect(event1).toEqual(expectedEvent1);
      expect(event2).toEqual(expectedEvent2);
      expect(event3).toEqual(expectedEvent3);

      expect(crashEvent).toEqual(expectedEvent0);

      expect(apeEvent0).toEqual(expectedEvent2);
      expect(apeEvent1).toEqual(expectedEvent3);

      const unsubscribeResult1 = await client.call('unsubscribe', subParams1);
      expect(unsubscribeResult1).toEqual({});

      const unsubscribeResult2 = await client.call('unsubscribe', subParams2);
      expect(unsubscribeResult2).toEqual({ asset_identifier: crashPunks, value: valueHex1 });

      const unsubscribeResult3 = await client.call('unsubscribe', subParams3);
      expect(unsubscribeResult3).toEqual({ asset_identifier: wastelandApes });
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
        stx_received: '0',
        stx_sent: '50',
        stx_transfers: [],
        tx: {
          anchor_mode: 'any',
          block_hash: '0x123456',
          block_height: 1,
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
        },
      });
      await subscription.unsubscribe();
    } finally {
      client.webSocket.close();
    }
  });
});
