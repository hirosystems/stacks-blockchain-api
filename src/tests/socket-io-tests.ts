import { io } from 'socket.io-client';
import { ChainID } from '@stacks/common';
import { ApiServer, startApiServer } from '../api/init';
import { DbAssetEventTypeId, DbTxStatus } from '../datastore/common';
import {
  TestBlockBuilder,
  testMempoolTx,
  TestMicroblockStreamBuilder,
} from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { migrate } from '../test-utils/test-helpers';
import { Waiter, waiter } from '@hirosystems/api-toolkit';
import { StacksApiSocketClient } from '../../client/src/socket-io';
import {
  AddressStxBalanceResponse,
  AddressTransactionWithTransfers,
  Block,
  MempoolTransaction,
  Microblock,
  NftEvent,
  Transaction,
} from 'client/src/types';

describe('socket-io', () => {
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

  test('socket-io-client > block updates', async () => {
    const client = new StacksApiSocketClient({
      url: `http://${apiServer.address}`,
      socketOpts: { reconnection: false },
    });

    const updateWaiter: Waiter<Block> = waiter();
    const subResult = client.subscribeBlocks(block => updateWaiter.finish(block));

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
      subResult.unsubscribe();
      client.socket.close();
    }
  });

  test('socket-io-client > tx updates', async () => {
    const client = new StacksApiSocketClient({
      url: `http://${apiServer.address}`,
      socketOpts: { reconnection: false },
    });

    const mempoolWaiter: Waiter<MempoolTransaction> = waiter();
    const txWaiters: Waiter<MempoolTransaction | Transaction>[] = [waiter(), waiter()];

    const mempoolSub = client.subscribeMempool(tx => mempoolWaiter.finish(tx));
    const txSub = client.subscribeTransaction('0x01', tx => {
      if (tx.tx_status === 'pending') {
        txWaiters[0].finish(tx);
      } else {
        txWaiters[1].finish(tx);
      }
    });

    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);

    const mempoolTx = testMempoolTx({ tx_id: '0x01', status: DbTxStatus.Pending });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const mempoolResult = await mempoolWaiter;
    const txResult = await txWaiters[0];

    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock()
      .addTx({ tx_id: '0x01' })
      .build();
    await db.updateMicroblocks(microblock);
    const txMicroblockResult = await txWaiters[1];

    try {
      expect(mempoolResult.tx_status).toEqual('pending');
      expect(mempoolResult.tx_id).toEqual('0x01');
      expect(txResult.tx_status).toEqual('pending');
      expect(txResult.tx_id).toEqual('0x01');
      expect(txMicroblockResult.tx_id).toEqual('0x01');
      expect(txMicroblockResult.tx_status).toEqual('success');
    } finally {
      mempoolSub.unsubscribe();
      txSub.unsubscribe();
      client.socket.close();
    }
  });

  test('socket-io > block updates', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: { subscriptions: 'block' },
    });
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
    const socket = io(`http://${apiServer.address}`, {
      reconnection: false,
      query: { subscriptions: 'microblock' },
    });
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
        parent_index_block_hash: '0x4343',
      })
      .addTx({ tx_id: '0xf6f6' })
      .build();
    await db.updateMicroblocks(microblocks);

    const result = await updateWaiter;
    try {
      expect(result.microblock_hash).toEqual('0xff01');
      expect(result.parent_block_hash).toEqual('0x1212');
      expect(result.txs[0]).toEqual('0xf6f6');
    } finally {
      socket.emit('unsubscribe', 'microblock');
      socket.close();
    }
  });

  test('socket-io > tx updates', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: { subscriptions: 'mempool,transaction:0x01' },
    });
    const mempoolWaiter: Waiter<MempoolTransaction> = waiter();
    const txWaiters: Waiter<MempoolTransaction | Transaction>[] = [waiter(), waiter()];
    socket.on('mempool', tx => {
      mempoolWaiter.finish(tx);
    });
    socket.on('transaction:0x01', tx => {
      if (tx.tx_status === 'pending') {
        txWaiters[0].finish(tx);
      } else {
        txWaiters[1].finish(tx);
      }
    });

    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);

    const mempoolTx = testMempoolTx({ tx_id: '0x01', status: DbTxStatus.Pending });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const mempoolResult = await mempoolWaiter;
    const txResult = await txWaiters[0];

    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock()
      .addTx({ tx_id: '0x01' })
      .build();
    await db.updateMicroblocks(microblock);
    const txMicroblockResult = await txWaiters[1];

    try {
      expect(mempoolResult.tx_status).toEqual('pending');
      expect(mempoolResult.tx_id).toEqual('0x01');
      expect(txResult.tx_status).toEqual('pending');
      expect(txResult.tx_id).toEqual('0x01');
      expect(txMicroblockResult.tx_id).toEqual('0x01');
      expect(txMicroblockResult.tx_status).toEqual('success');
    } finally {
      socket.emit('unsubscribe', 'mempool');
      socket.emit('unsubscribe', 'transaction:0x01');
      socket.close();
    }
  });

  test('socket-io > mempool txs', async () => {
    process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD = '0';

    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: { subscriptions: 'mempool' },
    });
    const txWaiters: Waiter<MempoolTransaction | Transaction>[] = [waiter(), waiter()];
    socket.on('mempool', tx => {
      if (tx.tx_status === 'pending') {
        txWaiters[0].finish(tx);
      } else {
        txWaiters[1].finish(tx);
      }
    });

    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({ tx_id: '0x0101' })
      .build();
    await db.update(block1);
    const mempoolTx = testMempoolTx({ tx_id: '0x01', status: DbTxStatus.Pending });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const pendingResult = await txWaiters[0];

    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x0201' })
      .build();
    await db.update(block2);
    const droppedResult = await txWaiters[1];

    try {
      expect(pendingResult.tx_id).toEqual('0x01');
      expect(pendingResult.tx_status).toEqual('pending');
      expect(droppedResult.tx_id).toEqual('0x01');
      expect(droppedResult.tx_status).toEqual('dropped_stale_garbage_collect');
    } finally {
      socket.emit('unsubscribe', 'mempool');
      socket.close();
    }
  });

  test('socket-io > address tx updates', async () => {
    const addr1 = 'ST28D4Q6RCQSJ6F7TEYWQDS4N1RXYEP9YBWMYSB97';
    const socket = io(`http://${apiServer.address}`, {
      reconnection: false,
      query: { subscriptions: `address-transaction:${addr1}` },
    });
    let updateIndex = 0;
    const addrTxUpdates: Waiter<AddressTransactionWithTransfers>[] = [waiter(), waiter()];
    socket.on(`address-transaction:${addr1}`, (_, tx) => {
      addrTxUpdates[updateIndex++]?.finish(tx);
    });

    const block = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x01',
      index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x8912', sender_address: addr1, token_transfer_amount: 100n, fee_rate: 50n })
      .addTxStxEvent({ sender: addr1, amount: 100n })
      .build();
    await db.update(block);
    const blockResult = await addrTxUpdates[0];

    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x11',
        parent_index_block_hash: '0x01',
      })
      .addTx({
        tx_id: '0x8913',
        sender_address: addr1,
        token_transfer_amount: 150n,
        fee_rate: 50n,
      })
      .addTxStxEvent({ sender: addr1, amount: 150n })
      .build();
    await db.updateMicroblocks(microblock);
    const microblockResult = await addrTxUpdates[1];

    try {
      expect(blockResult.tx.tx_id).toEqual('0x8912');
      expect(blockResult.stx_sent).toEqual('150'); // Incl. fees
      expect(blockResult.stx_transfers[0].amount).toEqual('100');
      expect(microblockResult.tx.tx_id).toEqual('0x8913');
      expect(microblockResult.stx_sent).toEqual('200'); // Incl. fees
      expect(microblockResult.stx_transfers[0].amount).toEqual('150');
    } finally {
      socket.emit('unsubscribe', `address-transaction:${addr1}`);
      socket.close();
    }
  });

  test('socket-io > address balance updates', async () => {
    const addr2 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: { subscriptions: `address-stx-balance:${addr2}` },
    });
    const updateWaiter: Waiter<AddressStxBalanceResponse> = waiter();

    socket.on(`address-stx-balance:${addr2}`, (_, tx) => {
      updateWaiter.finish(tx);
    });
    const block = new TestBlockBuilder()
      .addTx({
        token_transfer_recipient_address: addr2,
        token_transfer_amount: 100n,
      })
      .addTxStxEvent({ recipient: addr2, amount: 100n })
      .build();
    await db.update(block);

    const result = await updateWaiter;
    try {
      expect(result.balance).toEqual('100');
    } finally {
      socket.emit('unsubscribe', `address-stx-balance:${addr2}`);
      socket.close();
    }
  });

  test('socket-io > nft event updates', async () => {
    const crashPunks = 'SP3QSAJQ4EA8WXEDSRRKMZZ29NH91VZ6C5X88FGZQ.crashpunks-v2::crashpunks-v2';
    const wastelandApes =
      'SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.wasteland-apes-nft::Wasteland-Apes';
    const valueHex1 = '0x0100000000000000000000000000000d55';
    const valueHex2 = '0x0100000000000000000000000000000095';
    const stxAddress1 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: {
        subscriptions: `nft-event,nft-asset-event:${crashPunks}+${valueHex1},nft-collection-event:${wastelandApes}`,
      },
    });

    const nftEventWaiters: Waiter<NftEvent>[] = [waiter(), waiter(), waiter(), waiter()];
    const crashPunksWaiter: Waiter<NftEvent> = waiter();
    const apeWaiters: Waiter<NftEvent>[] = [waiter(), waiter()];
    socket.on(`nft-event`, event => {
      nftEventWaiters[event.event_index].finish(event);
    });
    socket.on(`nft-asset-event:${crashPunks}+${valueHex1}`, (assetIdentifier, value, event) => {
      if (assetIdentifier == crashPunks && value == valueHex1) {
        crashPunksWaiter.finish(event);
      }
    });
    socket.on(`nft-collection-event:${wastelandApes}`, (assetIdentifier, event) => {
      if (assetIdentifier == wastelandApes) {
        if (event.event_index == 2) {
          apeWaiters[0].finish(event);
        } else if (event.event_index == 3) {
          apeWaiters[1].finish(event);
        }
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
      tx_index: 0,
      asset_identifier: 'SP3QSAJQ4EA8WXEDSRRKMZZ29NH91VZ6C5X88FGZQ.crashpunks-v2::crashpunks-v2',
      block_height: 1,
      event_index: 0,
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      sender: null,
      tx_id: '0x01',
      value: { hex: '0x0100000000000000000000000000000d55', repr: 'u3413' },
    };
    const expectedEvent1 = {
      asset_event_type: 'mint',
      tx_index: 0,
      asset_identifier: 'SP3QSAJQ4EA8WXEDSRRKMZZ29NH91VZ6C5X88FGZQ.crashpunks-v2::crashpunks-v2',
      block_height: 1,
      event_index: 1,
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      sender: null,
      tx_id: '0x01',
      value: { hex: '0x0100000000000000000000000000000095', repr: 'u149' },
    };
    const expectedEvent2 = {
      asset_event_type: 'mint',
      tx_index: 0,
      asset_identifier:
        'SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.wasteland-apes-nft::Wasteland-Apes',
      block_height: 1,
      event_index: 2,
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      sender: null,
      tx_id: '0x01',
      value: { hex: '0x0100000000000000000000000000000d55', repr: 'u3413' },
    };
    const expectedEvent3 = {
      asset_event_type: 'mint',
      tx_index: 0,
      asset_identifier:
        'SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.wasteland-apes-nft::Wasteland-Apes',
      block_height: 1,
      event_index: 3,
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      sender: null,
      tx_id: '0x01',
      value: { hex: '0x0100000000000000000000000000000095', repr: 'u149' },
    };

    const event0 = await nftEventWaiters[0];
    const event1 = await nftEventWaiters[1];
    const event2 = await nftEventWaiters[2];
    const event3 = await nftEventWaiters[3];
    const crashEvent = await crashPunksWaiter;
    const apeEvent0 = await apeWaiters[0];
    const apeEvent1 = await apeWaiters[1];
    try {
      expect(event0).toEqual(expectedEvent0);
      expect(event1).toEqual(expectedEvent1);
      expect(event2).toEqual(expectedEvent2);
      expect(event3).toEqual(expectedEvent3);

      expect(crashEvent).toEqual(expectedEvent0);

      expect(apeEvent0).toEqual(expectedEvent2);
      expect(apeEvent1).toEqual(expectedEvent3);
    } finally {
      socket.emit('unsubscribe', `nft-event`);
      socket.emit('unsubscribe', `nft-asset-event:${crashPunks}+${valueHex1}`);
      socket.emit('unsubscribe', `nft-collection-event:${wastelandApes}`);
      socket.close();
    }
  });

  test('socket-io > invalid topic connection', async () => {
    const faultyAddr = 'faulty address';
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: { subscriptions: `address-stx-balance:${faultyAddr}` },
    });
    const updateWaiter: Waiter<Error> = waiter();

    socket.on(`connect_error`, err => {
      updateWaiter.finish(err);
    });

    const result = await updateWaiter;
    try {
      throw result;
    } catch (err: any) {
      expect(err.message).toEqual(`Invalid topic: address-stx-balance:${faultyAddr}`);
    } finally {
      socket.close();
    }
  });

  test('socket-io > multiple invalid topic connection', async () => {
    const faultyAddrStx = 'address-stx-balance:faulty address';
    const faultyTx = 'transaction:0x1';
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: { subscriptions: `${faultyAddrStx},${faultyTx}` },
    });
    const updateWaiter: Waiter<Error> = waiter();

    socket.on(`connect_error`, err => {
      updateWaiter.finish(err);
    });

    const result = await updateWaiter;
    try {
      throw result;
    } catch (err: any) {
      expect(err.message).toEqual(`Invalid topic: ${faultyAddrStx}, ${faultyTx}`);
    } finally {
      socket.close();
    }
  });

  test('socket-io > valid socket subscription', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      query: { subscriptions: '' },
    });
    const updateWaiter: Waiter<Block> = waiter();

    socket.on('block', block => {
      updateWaiter.finish(block);
    });

    socket.emit('subscribe', 'block');

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

  // Per message timeout is not enabled (we don't want to require clients to explicitly reply to events)
  test.skip('message timeout disconnects client', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
      // Block message will go unanswered, triggering a disconnect.
      query: { subscriptions: `block` },
    });

    process.env['STACKS_API_WS_MESSAGE_TIMEOUT'] = '0';
    const disconnectWaiter = waiter();
    let disconnectReason = '';

    socket.on('disconnect', reason => {
      disconnectReason = reason;
      socket.close();
      disconnectWaiter.finish();
    });

    socket.on('connect', async () => {
      const block = new TestBlockBuilder().addTx().build();
      await db.update(block);
    });

    await disconnectWaiter;
    expect(disconnectReason).toBe('io server disconnect');
  });

  test('ping timeout disconnects client', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, {
      reconnection: false,
    });

    process.env['STACKS_API_WS_PING_TIMEOUT'] = '0';
    const disconnectWaiter = waiter();
    let disconnectReason = '';

    socket.on('disconnect', reason => {
      disconnectReason = reason;
      socket.close();
      disconnectWaiter.finish();
    });

    socket.on('connect', () => {
      // Make all pings go unanswered.
      socket.io.engine['onPacket'] = () => {};
    });

    await disconnectWaiter;
    expect(['ping timeout', 'transport close']).toContain(disconnectReason);
  });
});
