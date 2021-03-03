import { MemoryDataStore } from '../datastore/memory-store';
import {
  DbBlock,
  DbTx,
  DbTxTypeId,
  DbStxEvent,
  DbAssetEventTypeId,
  DbEventTypeId,
  DbFtEvent,
  DbNftEvent,
  DbSmartContractEvent,
  DbSmartContract,
  DbMempoolTx,
  DbTxStatus,
  DbMinerReward,
  DbStxLockEvent,
  DbBurnchainReward,
} from '../datastore/common';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { parseDbEvent } from '../api/controllers/db-controller';
import * as assert from 'assert';

describe('in-memory datastore', () => {
  let db: MemoryDataStore;

  beforeEach(() => {
    db = new MemoryDataStore();
  });

  test('in-memory block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x5678',
      parent_microblock: '987',
      block_height: 123,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
    };
    await db.updateBlock(block);
    const blockQuery = await db.getBlock(block.block_hash);
    assert(blockQuery.found);
    expect(blockQuery.result).toEqual(block);
  });
});

describe('postgres datastore', () => {
  let db: PgDataStore;
  let client: PoolClient;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
  });

  test('pg address STX balances', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0x9876',
      index_block_hash: '0x5432',
      block_height: 68456,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    await db.updateBlock(client, dbBlock);

    const createMinerReward = (
      recipient: string,
      amount: bigint,
      txFeeAnchored: bigint,
      txFeeConfirmed: bigint,
      txFeeProduced: bigint,
      canonical: boolean = true
    ): DbMinerReward => {
      const minerReward: DbMinerReward = {
        block_hash: '0x9876',
        index_block_hash: '0x5432',
        from_index_block_hash: '0x6789',
        mature_block_height: 68456,
        canonical: canonical,
        recipient: recipient,
        coinbase_amount: amount,
        tx_fees_anchored: txFeeAnchored,
        tx_fees_streamed_confirmed: txFeeConfirmed,
        tx_fees_streamed_produced: txFeeProduced,
      };
      return minerReward;
    };

    const minerRewards = [
      createMinerReward('addrA', 100_000n, 2n, 3n, 5n),
      createMinerReward('addrB', 100n, 40n, 0n, 0n),
      createMinerReward('addrB', 0n, 30n, 40n, 7n),
      createMinerReward('addrB', 99999n, 92n, 93n, 0n, false),
    ];
    for (const reward of minerRewards) {
      await db.updateMinerReward(client, reward);
    }

    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'addrA',
      origin_hash_mode: 1,
    };
    const tx2 = {
      ...tx,
      tx_id: '0x2345',
      fee_rate: 100n,
    };
    const createStxEvent = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true
    ): DbStxEvent => {
      const stxEvent: DbStxEvent = {
        canonical,
        event_type: DbEventTypeId.StxAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: 0,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        block_height: tx.block_height,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return stxEvent;
    };
    const events = [
      createStxEvent('none', 'addrA', 100_000),
      createStxEvent('addrA', 'addrB', 100),
      createStxEvent('addrA', 'addrB', 250),
      createStxEvent('addrA', 'addrB', 40, false),
      createStxEvent('addrB', 'addrC', 15),
      createStxEvent('addrA', 'addrC', 35),
    ];
    for (const event of events) {
      await db.updateStxEvent(client, tx, event);
    }

    const createStxLockEvent = (
      sender: string,
      amount: bigint,
      unlockHeight?: number,
      canonical: boolean = true
    ): DbStxLockEvent => {
      const stxEvent: DbStxLockEvent = {
        canonical,
        event_index: 0,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        block_height: tx.block_height,
        event_type: DbEventTypeId.StxLock,
        locked_amount: amount,
        unlock_height: unlockHeight ?? tx.block_height + 200,
        locked_address: sender,
      };
      return stxEvent;
    };
    const stxLockEvents = [
      createStxLockEvent('addrA', 400n),
      createStxLockEvent('addrA', 222n, 1),
      createStxLockEvent('addrB', 333n, 1),
    ];
    for (const stxLockEvent of stxLockEvents) {
      await db.updateStxLockEvent(client, tx, stxLockEvent);
    }
    await db.updateTx(client, tx);
    await db.updateTx(client, tx2);

    const addrAResult = await db.getStxBalance('addrA');
    const addrBResult = await db.getStxBalance('addrB');
    const addrCResult = await db.getStxBalance('addrC');
    const addrDResult = await db.getStxBalance('addrD');

    expect(addrAResult).toEqual({
      balance: 198291n,
      totalReceived: 100000n,
      totalSent: 385n,
      totalFeesSent: 1334n,
      totalMinerRewardsReceived: 100010n,
      burnchainLockHeight: 123,
      burnchainUnlockHeight: 68656,
      lockHeight: 68456,
      lockTxId: '0x1234',
      locked: 400n,
    });
    expect(addrBResult).toEqual({
      balance: 552n,
      totalReceived: 350n,
      totalSent: 15n,
      totalFeesSent: 0n,
      totalMinerRewardsReceived: 217n,
      burnchainLockHeight: 0,
      burnchainUnlockHeight: 0,
      lockHeight: 0,
      lockTxId: '',
      locked: 0n,
    });
    expect(addrCResult).toEqual({
      balance: 50n,
      totalReceived: 50n,
      totalSent: 0n,
      totalFeesSent: 0n,
      totalMinerRewardsReceived: 0n,
      burnchainLockHeight: 0,
      burnchainUnlockHeight: 0,
      lockHeight: 0,
      lockTxId: '',
      locked: 0n,
    });
    expect(addrDResult).toEqual({
      balance: 0n,
      totalReceived: 0n,
      totalSent: 0n,
      totalFeesSent: 0n,
      totalMinerRewardsReceived: 0n,
      burnchainLockHeight: 0,
      burnchainUnlockHeight: 0,
      lockHeight: 0,
      lockTxId: '',
      locked: 0n,
    });
  });

  test('pg address FT balances', async () => {
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const createFtEvent = (
      sender: string,
      recipient: string,
      assetId: string,
      amount: number,
      canonical: boolean = true
    ): DbFtEvent => {
      const ftEvent: DbFtEvent = {
        canonical,
        event_type: DbEventTypeId.FungibleTokenAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: 0,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        block_height: tx.block_height,
        asset_identifier: assetId,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return ftEvent;
    };
    const events = [
      createFtEvent('none', 'addrA', 'bux', 100_000),
      createFtEvent('addrA', 'addrB', 'bux', 100),
      createFtEvent('addrA', 'addrB', 'bux', 250),
      createFtEvent('addrA', 'addrB', 'bux', 40, false),
      createFtEvent('addrB', 'addrC', 'bux', 15),
      createFtEvent('addrA', 'addrC', 'bux', 35),
      createFtEvent('none', 'addrA', 'gox', 200_000),
      createFtEvent('addrA', 'addrB', 'gox', 200),
      createFtEvent('addrA', 'addrB', 'gox', 350),
      createFtEvent('addrA', 'addrB', 'gox', 60, false),
      createFtEvent('addrB', 'addrC', 'gox', 25),
      createFtEvent('addrA', 'addrC', 'gox', 75),
      createFtEvent('none', 'addrA', 'cash', 500_000),
      createFtEvent('addrA', 'none', 'tendies', 1_000_000),
    ];
    for (const event of events) {
      await db.updateFtEvent(client, tx, event);
    }

    const addrAResult = await db.getFungibleTokenBalances('addrA');
    const addrBResult = await db.getFungibleTokenBalances('addrB');
    const addrCResult = await db.getFungibleTokenBalances('addrC');
    const addrDResult = await db.getFungibleTokenBalances('addrD');

    expect([...addrAResult]).toEqual([
      ['bux', { balance: 99615n, totalReceived: 100000n, totalSent: 385n }],
      ['cash', { balance: 500000n, totalReceived: 500000n, totalSent: 0n }],
      ['gox', { balance: 199375n, totalReceived: 200000n, totalSent: 625n }],
      ['tendies', { balance: -1000000n, totalReceived: 0n, totalSent: 1000000n }],
    ]);
    expect([...addrBResult]).toEqual([
      ['bux', { balance: 335n, totalReceived: 350n, totalSent: 15n }],
      ['gox', { balance: 525n, totalReceived: 550n, totalSent: 25n }],
    ]);
    expect([...addrCResult]).toEqual([
      ['bux', { balance: 50n, totalReceived: 50n, totalSent: 0n }],
      ['gox', { balance: 100n, totalReceived: 100n, totalSent: 0n }],
    ]);
    expect([...addrDResult]).toEqual([]);
  });

  test('pg address NFT counts', async () => {
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const createNFtEvents = (
      sender: string,
      recipient: string,
      assetId: string,
      count: number,
      canonical: boolean = true
    ): DbNftEvent[] => {
      const events: DbNftEvent[] = [];
      for (let i = 0; i < count; i++) {
        const nftEvent: DbNftEvent = {
          canonical,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: 0,
          tx_id: tx.tx_id,
          tx_index: tx.tx_index,
          block_height: tx.block_height,
          asset_identifier: assetId,
          value: Buffer.from([0]),
          recipient,
          sender,
        };
        events.push(nftEvent);
      }
      return events;
    };
    const events = [
      createNFtEvents('none', 'addrA', 'bux', 300),
      createNFtEvents('addrA', 'addrB', 'bux', 10),
      createNFtEvents('addrA', 'addrB', 'bux', 25),
      createNFtEvents('addrA', 'addrB', 'bux', 4, false),
      createNFtEvents('addrB', 'addrC', 'bux', 1),
      createNFtEvents('addrA', 'addrC', 'bux', 3),
      createNFtEvents('none', 'addrA', 'gox', 200),
      createNFtEvents('addrA', 'addrB', 'gox', 20),
      createNFtEvents('addrA', 'addrB', 'gox', 35),
      createNFtEvents('addrA', 'addrB', 'gox', 6, false),
      createNFtEvents('addrB', 'addrC', 'gox', 2),
      createNFtEvents('addrA', 'addrC', 'gox', 7),
      createNFtEvents('none', 'addrA', 'cash', 500),
      createNFtEvents('addrA', 'none', 'tendies', 100),
    ];
    for (const event of events.flat()) {
      await db.updateNftEvent(client, tx, event);
    }

    const addrAResult = await db.getNonFungibleTokenCounts('addrA');
    const addrBResult = await db.getNonFungibleTokenCounts('addrB');
    const addrCResult = await db.getNonFungibleTokenCounts('addrC');
    const addrDResult = await db.getNonFungibleTokenCounts('addrD');

    expect([...addrAResult]).toEqual([
      ['bux', { count: 262n, totalReceived: 300n, totalSent: 38n }],
      ['cash', { count: 500n, totalReceived: 500n, totalSent: 0n }],
      ['gox', { count: 138n, totalReceived: 200n, totalSent: 62n }],
      ['tendies', { count: -100n, totalReceived: 0n, totalSent: 100n }],
    ]);
    expect([...addrBResult]).toEqual([
      ['bux', { count: 34n, totalReceived: 35n, totalSent: 1n }],
      ['gox', { count: 53n, totalReceived: 55n, totalSent: 2n }],
    ]);
    expect([...addrCResult]).toEqual([
      ['bux', { count: 4n, totalReceived: 4n, totalSent: 0n }],
      ['gox', { count: 9n, totalReceived: 9n, totalSent: 0n }],
    ]);
    expect([...addrDResult]).toEqual([]);
  });

  test('pg block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1235,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    await db.updateBlock(client, block);
    const blockQuery = await db.getBlock(block.block_hash);
    assert(blockQuery.found);
    expect(blockQuery.result).toEqual(block);

    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, tx);
    const blockTxs = await db.getBlockTxs(block.index_block_hash);
    expect(blockTxs.results).toHaveLength(1);
    expect(blockTxs.results[0]).toBe('0x1234');
  });

  test('pg address transactions', async () => {
    let indexIdIndex = 0;
    const createStxTx = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true
    ): DbTx => {
      const tx: DbTx = {
        tx_id: '0x1234' + (++indexIdIndex).toString().padStart(4, '0'),
        tx_index: indexIdIndex,
        nonce: 0,
        raw_tx: Buffer.alloc(0),
        index_block_hash: '0x5432',
        block_hash: '0x9876',
        block_height: 68456,
        burn_block_time: 2837565,
        type_id: DbTxTypeId.TokenTransfer,
        token_transfer_amount: BigInt(amount),
        token_transfer_memo: Buffer.from('hi'),
        token_transfer_recipient_address: recipient,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical,
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: 1234n,
        sponsored: false,
        sender_address: sender,
        origin_hash_mode: 1,
      };
      return tx;
    };
    const txs = [
      createStxTx('none', 'addrA', 100_000),
      createStxTx('addrA', 'addrB', 100),
      createStxTx('addrA', 'addrB', 250),
      createStxTx('addrA', 'addrB', 40, false),
      createStxTx('addrB', 'addrC', 15),
      createStxTx('addrA', 'addrC', 35),
      createStxTx('addrE', 'addrF', 2),
      createStxTx('addrE', 'addrF', 2),
      createStxTx('addrE', 'addrF', 2),
      createStxTx('addrE', 'addrF', 2),
      createStxTx('addrE', 'addrF', 2),
    ];
    for (const tx of txs) {
      await db.updateTx(client, tx);
    }

    const addrAResult = await db.getAddressTxs({ stxAddress: 'addrA', limit: 3, offset: 0 });
    const addrBResult = await db.getAddressTxs({ stxAddress: 'addrB', limit: 3, offset: 0 });
    const addrCResult = await db.getAddressTxs({ stxAddress: 'addrC', limit: 3, offset: 0 });
    const addrDResult = await db.getAddressTxs({ stxAddress: 'addrD', limit: 3, offset: 0 });
    const addrEResult = await db.getAddressTxs({ stxAddress: 'addrE', limit: 3, offset: 0 });
    const addrEResultP2 = await db.getAddressTxs({ stxAddress: 'addrE', limit: 3, offset: 3 });

    expect(addrEResult.total).toBe(5);

    const mapAddrTxResults = (txs: DbTx[]) => {
      return txs.map(tx => ({
        sender_address: tx.sender_address,
        token_transfer_recipient_address: tx.token_transfer_recipient_address,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
      }));
    };

    expect(mapAddrTxResults(addrAResult.results)).toEqual([
      {
        sender_address: 'addrA',
        token_transfer_recipient_address: 'addrC',
        tx_id: '0x12340006',
        tx_index: 6,
      },
      {
        sender_address: 'addrA',
        token_transfer_recipient_address: 'addrB',
        tx_id: '0x12340003',
        tx_index: 3,
      },
      {
        sender_address: 'addrA',
        token_transfer_recipient_address: 'addrB',
        tx_id: '0x12340002',
        tx_index: 2,
      },
    ]);
    expect(mapAddrTxResults(addrBResult.results)).toEqual([
      {
        sender_address: 'addrB',
        token_transfer_recipient_address: 'addrC',
        tx_id: '0x12340005',
        tx_index: 5,
      },
      {
        sender_address: 'addrA',
        token_transfer_recipient_address: 'addrB',
        tx_id: '0x12340003',
        tx_index: 3,
      },
      {
        sender_address: 'addrA',
        token_transfer_recipient_address: 'addrB',
        tx_id: '0x12340002',
        tx_index: 2,
      },
    ]);
    expect(mapAddrTxResults(addrCResult.results)).toEqual([
      {
        sender_address: 'addrA',
        token_transfer_recipient_address: 'addrC',
        tx_id: '0x12340006',
        tx_index: 6,
      },
      {
        sender_address: 'addrB',
        token_transfer_recipient_address: 'addrC',
        tx_id: '0x12340005',
        tx_index: 5,
      },
    ]);
    expect(mapAddrTxResults(addrEResult.results)).toEqual([
      {
        sender_address: 'addrE',
        token_transfer_recipient_address: 'addrF',
        tx_id: '0x12340011',
        tx_index: 11,
      },
      {
        sender_address: 'addrE',
        token_transfer_recipient_address: 'addrF',
        tx_id: '0x12340010',
        tx_index: 10,
      },
      {
        sender_address: 'addrE',
        token_transfer_recipient_address: 'addrF',
        tx_id: '0x12340009',
        tx_index: 9,
      },
    ]);
    expect(mapAddrTxResults(addrEResultP2.results)).toEqual([
      {
        sender_address: 'addrE',
        token_transfer_recipient_address: 'addrF',
        tx_id: '0x12340008',
        tx_index: 8,
      },
      {
        sender_address: 'addrE',
        token_transfer_recipient_address: 'addrF',
        tx_id: '0x12340007',
        tx_index: 7,
      },
    ]);
    expect(mapAddrTxResults(addrDResult.results)).toEqual([]);
  });

  test('pg get address asset events', async () => {
    const tx1: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const createStxEvent = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true
    ): DbStxEvent => {
      const stxEvent: DbStxEvent = {
        canonical,
        event_type: DbEventTypeId.StxAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: 0,
        tx_id: tx1.tx_id,
        tx_index: tx1.tx_index,
        block_height: tx1.block_height,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return stxEvent;
    };
    const stxEvents = [
      createStxEvent('none', 'addrA', 100_000),
      createStxEvent('addrA', 'addrB', 100),
      createStxEvent('addrA', 'addrB', 250),
      createStxEvent('addrA', 'addrB', 40, false),
      createStxEvent('addrB', 'addrC', 15),
      createStxEvent('addrA', 'addrC', 35),
    ];
    for (const event of stxEvents) {
      await db.updateStxEvent(client, tx1, event);
    }

    const tx2: DbTx = {
      tx_id: '0x1234',
      tx_index: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const createFtEvent = (
      sender: string,
      recipient: string,
      assetId: string,
      amount: number,
      canonical: boolean = true,
      eventIndex = 0
    ): DbFtEvent => {
      const ftEvent: DbFtEvent = {
        canonical,
        event_type: DbEventTypeId.FungibleTokenAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: eventIndex,
        tx_id: tx2.tx_id,
        tx_index: tx2.tx_index,
        block_height: tx2.block_height,
        asset_identifier: assetId,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return ftEvent;
    };
    const ftEvents = [
      createFtEvent('none', 'addrA', 'bux', 100_000),
      createFtEvent('addrA', 'addrB', 'bux', 100),
      createFtEvent('addrA', 'addrB', 'bux', 250, true, 3),
      createFtEvent('addrA', 'addrB', 'bux', 40, false),
      createFtEvent('addrB', 'addrC', 'bux', 15),
      createFtEvent('addrA', 'addrC', 'bux', 35),
      createFtEvent('none', 'addrA', 'gox', 200_000),
      createFtEvent('addrA', 'addrB', 'gox', 200),
      createFtEvent('addrA', 'addrB', 'gox', 350),
      createFtEvent('addrA', 'addrB', 'gox', 60, false),
      createFtEvent('addrB', 'addrC', 'gox', 25, true, 4),
      createFtEvent('addrA', 'addrC', 'gox', 75, true, 5),
      createFtEvent('none', 'addrA', 'cash', 500_000),
      createFtEvent('addrA', 'none', 'tendies', 1_000_000),
    ];
    for (const event of ftEvents) {
      await db.updateFtEvent(client, tx2, event);
    }

    const tx3: DbTx = {
      tx_id: '0x1234',
      tx_index: 2,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const createNFtEvents = (
      sender: string,
      recipient: string,
      assetId: string,
      count: number,
      canonical: boolean = true
    ): DbNftEvent[] => {
      const events: DbNftEvent[] = [];
      for (let i = 0; i < count; i++) {
        const nftEvent: DbNftEvent = {
          canonical,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: 0,
          tx_id: tx3.tx_id,
          tx_index: tx3.tx_index,
          block_height: tx3.block_height,
          asset_identifier: assetId,
          value: Buffer.from([0]),
          recipient,
          sender,
        };
        events.push(nftEvent);
      }
      return events;
    };
    const nftEvents = [
      createNFtEvents('none', 'addrA', 'bux', 10),
      createNFtEvents('addrA', 'addrB', 'bux', 1),
      createNFtEvents('addrA', 'addrB', 'bux', 2),
      createNFtEvents('addrA', 'addrB', 'bux', 4, false),
      createNFtEvents('addrB', 'addrC', 'bux', 1),
      createNFtEvents('addrA', 'addrC', 'bux', 3),
      createNFtEvents('none', 'addrA', 'gox', 9),
      createNFtEvents('addrA', 'addrB', 'gox', 2),
      createNFtEvents('addrA', 'addrB', 'gox', 3),
      createNFtEvents('addrA', 'addrB', 'gox', 6, false),
      createNFtEvents('addrB', 'addrC', 'gox', 2),
      createNFtEvents('addrA', 'addrC', 'gox', 7),
      createNFtEvents('none', 'addrA', 'cash', 5),
      createNFtEvents('addrA', 'none', 'tendies', 1),
    ];
    for (const event of nftEvents.flat()) {
      await db.updateNftEvent(client, tx3, event);
    }

    const assetDbEvents = await db.getAddressAssetEvents({
      stxAddress: 'addrA',
      limit: 10000,
      offset: 0,
    });
    const assetEvents = assetDbEvents.results.map(event => parseDbEvent(event));
    expect(assetEvents).toEqual([
      {
        event_index: 0,
        event_type: 'stx_asset',
        asset: { asset_event_type: 'transfer', sender: 'addrA', recipient: 'addrB', amount: '100' },
      },
      {
        event_index: 0,
        event_type: 'stx_asset',
        asset: {
          asset_event_type: 'transfer',
          sender: 'none',
          recipient: 'addrA',
          amount: '100000',
        },
      },
      {
        event_index: 0,
        event_type: 'stx_asset',
        asset: { asset_event_type: 'transfer', sender: 'addrA', recipient: 'addrC', amount: '35' },
      },
      {
        event_index: 0,
        event_type: 'stx_asset',
        asset: { asset_event_type: 'transfer', sender: 'addrA', recipient: 'addrB', amount: '250' },
      },
      {
        event_index: 5,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          amount: '75',
        },
      },
      {
        event_index: 3,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          amount: '250',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          amount: '350',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          amount: '100000',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          amount: '500000',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'tendies',
          sender: 'addrA',
          recipient: 'none',
          amount: '1000000',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          amount: '200000',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrC',
          amount: '35',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          amount: '200',
        },
      },
      {
        event_index: 0,
        event_type: 'fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          amount: '100',
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'tendies',
          sender: 'addrA',
          recipient: 'none',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x00', repr: '0' },
        },
      },
    ]);
  });

  test('pg tx store and retrieve with post-conditions', async () => {
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x3434',
      block_hash: '0x5678',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, tx);
    const txQuery = await db.getTx(tx.tx_id);
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `token-transfer` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x3434',
      block_hash: '0x5678',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.TokenTransfer,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_token_transfer"')
    );
    tx.token_transfer_amount = 34n;
    tx.token_transfer_memo = Buffer.from('thx');
    tx.token_transfer_recipient_address = 'recipient-addr';
    await db.updateTx(client, tx);
    const txQuery = await db.getTx(tx.tx_id);
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `smart-contract` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x3434',
      block_hash: '0x5678',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.SmartContract,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_smart_contract"')
    );
    tx.smart_contract_contract_id = 'my-contract';
    tx.smart_contract_source_code = '(src)';
    await db.updateTx(client, tx);
    const txQuery = await db.getTx(tx.tx_id);
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `contract-call` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x3434',
      block_hash: '0x5678',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.ContractCall,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_contract_call"')
    );
    tx.contract_call_contract_id = 'my-contract';
    tx.contract_call_function_name = 'my-fn';
    tx.contract_call_function_args = Buffer.from('test');
    await db.updateTx(client, tx);
    const txQuery = await db.getTx(tx.tx_id);
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `poison-microblock` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x3434',
      block_hash: '0x5678',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.PoisonMicroblock,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_poison_microblock"')
    );
    tx.poison_microblock_header_1 = Buffer.from('poison A');
    tx.poison_microblock_header_2 = Buffer.from('poison B');
    await db.updateTx(client, tx);
    const txQuery = await db.getTx(tx.tx_id);
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `coinbase` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x3434',
      block_hash: '0x5678',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_coinbase"')
    );
    tx.coinbase_payload = Buffer.from('coinbase hi');
    await db.updateTx(client, tx);
    const txQuery = await db.getTx(tx.tx_id);
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg tx store duplicate block index hash data', async () => {
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5555',
      block_hash: '0x5678',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const updatedRows = await db.updateTx(client, tx);
    expect(updatedRows).toBe(1);
    const txQuery = await db.getTx(tx.tx_id);
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
    const dupeUpdateRows = await db.updateTx(client, tx);
    expect(dupeUpdateRows).toBe(0);
  });

  test('pg event store and retrieve', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const tx1: DbTx = {
      tx_id: '0x421234',
      tx_index: 0,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };
    const tx2: DbTx = {
      ...tx1,
      tx_id: '0x012345',
      tx_index: 1,
    };
    const stxEvent1: DbStxEvent = {
      event_index: 1,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block1.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'sender-addr',
      recipient: 'recipient-addr',
      event_type: DbEventTypeId.StxAsset,
      amount: 789n,
    };
    const ftEvent1: DbFtEvent = {
      event_index: 2,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block1.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'sender-addr',
      recipient: 'recipient-addr',
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: 789n,
      asset_identifier: 'ft-asset-id',
    };
    const nftEvent1: DbNftEvent = {
      event_index: 3,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block1.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'sender-addr',
      recipient: 'recipient-addr',
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      value: Buffer.from('some val'),
      asset_identifier: 'nft-asset-id',
    };
    const contractLogEvent1: DbSmartContractEvent = {
      event_index: 4,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block1.block_height,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: 'some-contract-id',
      topic: 'some-topic',
      value: Buffer.from('some val'),
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block1.block_height,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    await db.update({
      block: block1,
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [stxEvent1],
          ftEvents: [ftEvent1],
          nftEvents: [nftEvent1],
          contractLogEvents: [contractLogEvent1],
          smartContracts: [smartContract1],
        },
        {
          tx: tx2,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
        },
      ],
    });

    const fetchTx1 = await db.getTx(tx1.tx_id);
    assert(fetchTx1.found);
    expect(fetchTx1.result).toEqual(tx1);

    const fetchTx2 = await db.getTx(tx2.tx_id);
    assert(fetchTx2.found);
    expect(fetchTx2.result).toEqual(tx2);

    const fetchBlock1 = await db.getBlock(block1.block_hash);
    assert(fetchBlock1.found);
    expect(fetchBlock1.result).toEqual(block1);

    const fetchContract1 = await db.getSmartContract(smartContract1.contract_id);
    assert(fetchContract1.found);
    expect(fetchContract1.result).toEqual(smartContract1);

    const fetchTx1Events = await db.getTxEvents({
      txId: tx1.tx_id,
      indexBlockHash: tx1.index_block_hash,
      limit: 100,
      offset: 0,
    });
    expect(fetchTx1Events.results).toHaveLength(4);
    expect(fetchTx1Events.results.find(e => e.event_index === 1)).toEqual(stxEvent1);
    expect(fetchTx1Events.results.find(e => e.event_index === 2)).toEqual(ftEvent1);
    expect(fetchTx1Events.results.find(e => e.event_index === 3)).toEqual(nftEvent1);
    expect(fetchTx1Events.results.find(e => e.event_index === 4)).toEqual(contractLogEvent1);
  });

  test('pg burnchain reward insert and read', async () => {
    const addr1 = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: addr1,
      reward_amount: 900n,
      reward_index: 0,
    };
    const reward2: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2001n,
      reward_recipient: addr1,
      reward_amount: 901n,
      reward_index: 1,
    };
    const reward3: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x2345',
      burn_block_height: 201,
      burn_amount: 3001n,
      reward_recipient: addr1,
      reward_amount: 902n,
      reward_index: 0,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1, reward2],
    });
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward3.burn_block_hash,
      burnchainBlockHeight: reward3.burn_block_height,
      rewards: [reward3],
    });
    const rewardQuery = await db.getBurnchainRewards({
      burnchainRecipient: addr1,
      limit: 100,
      offset: 0,
    });
    expect(rewardQuery).toEqual([
      {
        canonical: true,
        burn_block_hash: '0x2345',
        burn_block_height: 201,
        burn_amount: 3001n,
        reward_recipient: addr1,
        reward_amount: 902n,
        reward_index: 0,
      },
      {
        canonical: true,
        burn_block_hash: '0x1234',
        burn_block_height: 200,
        burn_amount: 2001n,
        reward_recipient: addr1,
        reward_amount: 901n,
        reward_index: 1,
      },
      {
        canonical: true,
        burn_block_hash: '0x1234',
        burn_block_height: 200,
        burn_amount: 2000n,
        reward_recipient: addr1,
        reward_amount: 900n,
        reward_index: 0,
      },
    ]);
  });

  test('pg burnchain reward reorg handling', async () => {
    const addr1 = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
    const addr2 = '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z';
    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: addr1,
      reward_amount: 900n,
      reward_index: 0,
    };
    const reward2: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2001n,
      reward_recipient: addr1,
      reward_amount: 901n,
      reward_index: 1,
    };
    const reward3: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x2345',
      burn_block_height: 201,
      burn_amount: 3001n,
      reward_recipient: addr1,
      reward_amount: 902n,
      reward_index: 0,
    };
    // block that triggers a reorg of all previous
    const reward4: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: reward1.burn_block_hash,
      burn_block_height: reward1.burn_block_height,
      burn_amount: 4001n,
      reward_recipient: addr2,
      reward_amount: 903n,
      reward_index: 0,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1, reward2],
    });
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward3.burn_block_hash,
      burnchainBlockHeight: reward3.burn_block_height,
      rewards: [reward3],
    });
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward4.burn_block_hash,
      burnchainBlockHeight: reward4.burn_block_height,
      rewards: [reward4],
    });
    // Should return zero rewards since given address was only in blocks that have been reorged into non-canonical.
    const rewardQuery1 = await db.getBurnchainRewards({
      burnchainRecipient: addr1,
      limit: 100,
      offset: 0,
    });
    expect(rewardQuery1).toEqual([]);
    const rewardQuery2 = await db.getBurnchainRewards({
      burnchainRecipient: addr2,
      limit: 100,
      offset: 0,
    });
    expect(rewardQuery2).toEqual([
      {
        canonical: true,
        burn_block_hash: '0x1234',
        burn_block_height: 200,
        burn_amount: 4001n,
        reward_recipient: addr2,
        reward_amount: 903n,
        reward_index: 0,
      },
    ]);
  });

  test('pg mempool tx lifecycle', async () => {
    const block1: DbBlock = {
      block_hash: '0x11',
      index_block_hash: '0xaa',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      parent_microblock: '0xbeef',
      block_height: 1,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock: '0xbeef',
      block_height: 2,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock: '0xbeef',
      block_height: 3,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block3B: DbBlock = {
      ...block3,
      block_hash: '0x33bb',
      index_block_hash: '0xccbb',
      canonical: true,
    };
    const block4B: DbBlock = {
      block_hash: '0x44bb',
      index_block_hash: '0xddbb',
      parent_index_block_hash: block3B.index_block_hash,
      parent_block_hash: block3B.block_hash,
      parent_microblock: '0xbeef',
      block_height: 4,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block4: DbBlock = {
      block_hash: '0x44',
      index_block_hash: '0xdd',
      parent_index_block_hash: block3.index_block_hash,
      parent_block_hash: block3.block_hash,
      parent_microblock: '0xbeef',
      block_height: 4,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block5: DbBlock = {
      block_hash: '0x55',
      index_block_hash: '0xee',
      parent_index_block_hash: block4.index_block_hash,
      parent_block_hash: block4.block_hash,
      parent_microblock: '0xbeef',
      block_height: 5,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block6: DbBlock = {
      block_hash: '0x66',
      index_block_hash: '0xff',
      parent_index_block_hash: block5.index_block_hash,
      parent_block_hash: block5.block_hash,
      parent_microblock: '0xbeef',
      block_height: 6,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };

    const tx1Mempool: DbMempoolTx = {
      pruned: false,
      tx_id: '0x01',
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.TokenTransfer,
      receipt_time: 123456,
      token_transfer_amount: 1n,
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: 'stx-recipient-addr',
      status: DbTxStatus.Pending,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const tx1: DbTx = {
      ...tx1Mempool,
      tx_index: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      index_block_hash: block3B.index_block_hash,
      block_hash: block3B.block_hash,
      block_height: block3B.block_height,
      burn_block_time: block3B.burn_block_time,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
    };
    const tx1b: DbTx = {
      ...tx1,
      index_block_hash: block6.index_block_hash,
      block_hash: block6.block_hash,
      block_height: block6.block_height,
      burn_block_time: block6.burn_block_time,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
    };

    await db.updateMempoolTxs({ mempoolTxs: [tx1Mempool] });
    const txQuery1 = await db.getMempoolTx({ txId: tx1Mempool.tx_id });
    expect(txQuery1.found).toBe(true);
    expect(txQuery1?.result?.status).toBe(DbTxStatus.Pending);
    expect(txQuery1?.result?.raw_tx.toString('hex')).toBe(
      Buffer.from('test-raw-tx').toString('hex')
    );

    for (const block of [block1, block2, block3]) {
      await db.update({
        block: block,
        minerRewards: [],
        txs: [],
      });
    }

    await db.update({
      block: block3B,
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
        },
      ],
    });

    // tx should still be in mempool since it was included in a non-canonical chain-tip
    const txQuery2 = await db.getMempoolTx({ txId: tx1Mempool.tx_id });
    expect(txQuery2.found).toBe(true);
    expect(txQuery2?.result?.status).toBe(DbTxStatus.Pending);

    await db.update({
      block: block4B,
      minerRewards: [],
      txs: [],
    });

    // the fork containing this tx was made canonical, it should no longer be in the mempool
    const txQuery3 = await db.getMempoolTx({ txId: tx1Mempool.tx_id });
    expect(txQuery3.found).toBe(false);

    // the tx should be in the mined tx table, marked as canonical and success status
    const txQuery4 = await db.getTx(tx1.tx_id);
    expect(txQuery4.found).toBe(true);
    expect(txQuery4?.result?.status).toBe(DbTxStatus.Success);
    expect(txQuery4?.result?.canonical).toBe(true);
    expect(txQuery4?.result?.raw_tx.toString('hex')).toBe(
      Buffer.from('test-raw-tx').toString('hex')
    );

    // reorg the chain to make the tx no longer canonical
    for (const block of [block4, block5]) {
      await db.update({
        block: block,
        minerRewards: [],
        txs: [],
      });
    }

    // the tx should be in the mined tx table, marked as non-canonical
    const txQuery5 = await db.getTx(tx1.tx_id);
    expect(txQuery5.found).toBe(true);
    expect(txQuery5?.result?.status).toBe(DbTxStatus.Success);
    expect(txQuery5?.result?.canonical).toBe(false);

    // the fork containing this tx was made canonical again, it should now in the mempool
    const txQuery6 = await db.getMempoolTx({ txId: tx1Mempool.tx_id });
    expect(txQuery6.found).toBe(true);
    expect(txQuery6?.result?.status).toBe(DbTxStatus.Pending);

    // mine the same tx in the latest canonical block
    await db.update({
      block: block6,
      minerRewards: [],
      txs: [
        {
          tx: tx1b,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
        },
      ],
    });

    // tx should no longer be in the mempool after being mined
    const txQuery7 = await db.getMempoolTx({ txId: tx1b.tx_id });
    expect(txQuery7.found).toBe(false);

    // tx should be back in the mined tx table and associated with the new block
    const txQuery8 = await db.getTx(tx1b.tx_id);
    expect(txQuery8.found).toBe(true);
    expect(txQuery8.result?.index_block_hash).toBe(block6.index_block_hash);
    expect(txQuery8.result?.canonical).toBe(true);
    expect(txQuery8.result?.status).toBe(DbTxStatus.Success);
  });

  test('pg reorg orphan restoration', async () => {
    const block1: DbBlock = {
      block_hash: '0x11',
      index_block_hash: '0xaa',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      parent_microblock: '0xbeef',
      block_height: 1,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
    };
    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock: '0xbeef',
      block_height: 2,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
    };
    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock: '0xbeef',
      block_height: 3,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
    };
    const block3B: DbBlock = {
      ...block3,
      block_hash: '0x33bb',
      index_block_hash: '0xccbb',
      canonical: true,
    };
    const block4: DbBlock = {
      block_hash: '0x44',
      index_block_hash: '0xdd',
      parent_index_block_hash: block3.index_block_hash,
      parent_block_hash: block3.block_hash,
      parent_microblock: '0xbeef',
      block_height: 4,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
    };

    const minerReward1: DbMinerReward = {
      ...block1,
      from_index_block_hash: '0x33',
      mature_block_height: 3,
      recipient: 'miner-addr1',
      coinbase_amount: 1000n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 5n,
    };

    const tx1: DbTx = {
      tx_id: '0x01',
      tx_index: 0,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block1.index_block_hash,
      block_hash: block1.block_hash,
      block_height: block1.block_height,
      burn_block_time: block1.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: false,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };

    const tx2: DbTx = {
      tx_id: '0x02',
      tx_index: 0,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block2.index_block_hash,
      block_hash: block2.block_hash,
      block_height: block2.block_height,
      burn_block_time: block2.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: false,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };

    const stxLockEvent1: DbStxLockEvent = {
      ...tx1,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 1234n,
      unlock_height: 20,
      locked_address: 'locked-addr1',
    };

    // inserts blocks directly -- just runs sql insert without any reorg handling
    for (const block of [block1, block2, block3, block3B, block4]) {
      await db.updateBlock(client, block);
    }

    // insert miner rewards directly
    for (const minerReward of [minerReward1]) {
      await db.updateMinerReward(client, minerReward);
    }

    // insert txs directly
    for (const tx of [tx1, tx2]) {
      await db.updateTx(client, tx);
    }

    // insert stx lock events directly
    for (const event of [stxLockEvent1]) {
      await db.updateStxLockEvent(client, tx1, event);
    }

    const block5: DbBlock = {
      block_hash: '0x55',
      index_block_hash: '0xee',
      parent_index_block_hash: block4.index_block_hash,
      parent_block_hash: block4.block_hash,
      parent_microblock: '0xbeef',
      block_height: 5,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };

    const reorgResult = await db.handleReorg(client, block5, 0);
    expect(reorgResult).toEqual({
      markedCanonical: {
        blocks: 4,
        minerRewards: 1,
        txs: 2,
        stxLockEvents: 1,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
      },
      markedNonCanonical: {
        blocks: 1,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
      },
    });

    const blockQuery1 = await db.getBlock(block1.block_hash);
    expect(blockQuery1.result?.canonical).toBe(true);

    const blockQuery2 = await db.getBlock(block2.block_hash);
    expect(blockQuery2.result?.canonical).toBe(true);

    const blockQuery3B = await db.getBlock(block3B.block_hash);
    expect(blockQuery3B.result?.canonical).toBe(false);
  });

  test('pg reorg handling', async () => {
    const block1: DbBlock = {
      block_hash: '0x11',
      index_block_hash: '0xaa',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      parent_microblock: '0xbeef',
      block_height: 1,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock: '0xbeef',
      block_height: 2,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock: '0xbeef',
      block_height: 3,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };

    const minerReward1: DbMinerReward = {
      ...block1,
      mature_block_height: 3,
      from_index_block_hash: '0x11',
      recipient: 'miner-addr1',
      coinbase_amount: 1000n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 9n,
    };

    const minerReward2: DbMinerReward = {
      ...block2,
      mature_block_height: 4,
      from_index_block_hash: '0x22',
      recipient: 'miner-addr2',
      coinbase_amount: 1000n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 0n,
    };

    const tx1: DbTx = {
      tx_id: '0x01',
      tx_index: 0,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block1.index_block_hash,
      block_hash: block1.block_hash,
      block_height: block1.block_height,
      burn_block_time: block1.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };

    const tx2: DbTx = {
      tx_id: '0x02',
      tx_index: 0,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block2.index_block_hash,
      block_hash: block2.block_hash,
      block_height: block2.block_height,
      burn_block_time: block2.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };

    const stxLockEvent1: DbStxLockEvent = {
      ...tx1,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 1234n,
      unlock_height: block1.block_height + 100000,
      locked_address: 'locked-addr1',
    };

    const stxLockEvent2: DbStxLockEvent = {
      ...tx2,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 45n,
      unlock_height: block2.block_height + 100000,
      locked_address: 'locked-addr2',
    };

    await db.update({
      block: block1,
      minerRewards: [minerReward1],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [stxLockEvent1],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
        },
      ],
    });
    await db.update({
      block: block2,
      minerRewards: [minerReward2],
      txs: [
        {
          tx: tx2,
          stxLockEvents: [stxLockEvent2],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
        },
      ],
    });
    await db.update({ block: block3, minerRewards: [], txs: [] });

    const block2b: DbBlock = {
      block_hash: '0x22bb',
      index_block_hash: '0xbbbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock: '0xbeef',
      block_height: 2,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    const tx3: DbTx = {
      tx_id: '0x03',
      tx_index: 0,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block2b.index_block_hash,
      block_hash: block2b.block_hash,
      block_height: block2b.block_height,
      burn_block_time: block2b.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };
    const contract1: DbSmartContract = {
      tx_id: tx3.tx_id,
      canonical: true,
      contract_id: 'my-contract',
      block_height: tx3.block_height,
      source_code: '(my-src)',
      abi: '{thing:1}',
    };
    await db.update({
      block: block2b,
      minerRewards: [],
      txs: [
        {
          tx: tx3,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [contract1],
        },
      ],
    });
    const blockQuery1 = await db.getBlock(block2b.block_hash);
    expect(blockQuery1.result?.canonical).toBe(false);
    const chainTip1 = await db.getChainTipHeight(client);
    expect(chainTip1).toEqual({ blockHash: '0x33', blockHeight: 3, indexBlockHash: '0xcc' });

    const block3b: DbBlock = {
      block_hash: '0x33bb',
      index_block_hash: '0xccbb',
      parent_index_block_hash: block2b.index_block_hash,
      parent_block_hash: block2b.block_hash,
      parent_microblock: '0xbeef',
      block_height: 3,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    await db.update({ block: block3b, minerRewards: [], txs: [] });
    const blockQuery2 = await db.getBlock(block3b.block_hash);
    expect(blockQuery2.result?.canonical).toBe(false);
    const chainTip2 = await db.getChainTipHeight(client);
    expect(chainTip2).toEqual({ blockHash: '0x33', blockHeight: 3, indexBlockHash: '0xcc' });

    const block4b: DbBlock = {
      block_hash: '0x44bb',
      index_block_hash: '0xddbb',
      parent_index_block_hash: block3b.index_block_hash,
      parent_block_hash: block3b.block_hash,
      parent_microblock: '0xbeef',
      block_height: 4,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
    };
    await db.update({ block: block4b, minerRewards: [], txs: [] });
    const blockQuery3 = await db.getBlock(block3b.block_hash);
    expect(blockQuery3.result?.canonical).toBe(true);
    const chainTip3 = await db.getChainTipHeight(client);
    expect(chainTip3).toEqual({ blockHash: '0x44bb', blockHeight: 4, indexBlockHash: '0xddbb' });

    const b1 = await db.getBlock(block1.block_hash);
    const b2 = await db.getBlock(block2.block_hash);
    const b2b = await db.getBlock(block2b.block_hash);
    const b3 = await db.getBlock(block3.block_hash);
    const b3b = await db.getBlock(block3b.block_hash);
    const b4 = await db.getBlock(block4b.block_hash);
    expect(b1.result?.canonical).toBe(true);
    expect(b2.result?.canonical).toBe(false);
    expect(b2b.result?.canonical).toBe(true);
    expect(b3.result?.canonical).toBe(false);
    expect(b3b.result?.canonical).toBe(true);
    expect(b4.result?.canonical).toBe(true);

    const r1 = await db.getStxBalance(minerReward1.recipient);
    const r2 = await db.getStxBalance(minerReward2.recipient);
    expect(r1.totalMinerRewardsReceived).toBe(1014n);
    expect(r2.totalMinerRewardsReceived).toBe(0n);

    const lock1 = await db.getStxBalance(stxLockEvent1.locked_address);
    const lock2 = await db.getStxBalance(stxLockEvent2.locked_address);
    expect(lock1.locked).toBe(1234n);
    expect(lock2.locked).toBe(0n);

    const t1 = await db.getTx(tx1.tx_id);
    const t2 = await db.getTx(tx2.tx_id);
    const t3 = await db.getTx(tx3.tx_id);
    expect(t1.result?.canonical).toBe(true);
    expect(t2.result?.canonical).toBe(false);
    expect(t3.result?.canonical).toBe(true);

    const sc1 = await db.getSmartContract(contract1.contract_id);
    expect(sc1.result?.canonical).toBe(true);
  });

  afterEach(async () => {
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
