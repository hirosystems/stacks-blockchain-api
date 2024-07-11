import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbStxEvent,
  DbAssetEventTypeId,
  DbEventTypeId,
  DbFtEvent,
  DbNftEvent,
  DbSmartContractEvent,
  DbSmartContract,
  DbMempoolTxRaw,
  DbTxStatus,
  DbMinerReward,
  DbStxLockEvent,
  DbBurnchainReward,
  DbBnsNamespace,
  DbBnsName,
  DbBnsSubdomain,
  DbTokenOfferingLocked,
  DbTx,
  DataStoreBnsBlockTxData,
  ReOrgUpdatedEntities,
} from '../datastore/common';
import { getBlocksWithMetadata, parseDbEvent } from '../api/controllers/db-controller';
import * as assert from 'assert';
import { PgWriteStore } from '../datastore/pg-write-store';
import { bnsNameCV, I32_MAX, NETWORK_CHAIN_ID } from '../helpers';
import { ChainID } from '@stacks/transactions';
import { TestBlockBuilder } from '../test-utils/test-builders';
import { PgSqlClient, bufferToHex } from '@hirosystems/api-toolkit';
import { migrate } from '../test-utils/test-helpers';
import { CoreNodeBlockMessage } from '../event-stream/core-node-message';

describe('postgres datastore', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
  });

  afterEach(async () => {
    await db?.close();
    await migrate('down');
  });

  test('pg address STX balances', async () => {
    const block = new TestBlockBuilder({
      block_hash: '0x9876',
      index_block_hash: '0x5432',
      block_height: 1,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
    }).build();
    await db.update(block);

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
        mature_block_height: 1,
        canonical: canonical,
        recipient: recipient,
        miner_address: recipient,
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
    await db.updateMinerRewards(client, minerRewards);

    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 1,
      block_time: 2837565,
      burn_block_height: 1,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'addrA',
      origin_hash_mode: 1,
      event_count: 9,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx2 = {
      ...tx,
      tx_id: '0x2345',
      fee_rate: 100n,
      event_count: 0,
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
      await db.updateStxEvents(client, [{ tx, stxEvents: [event] }]);
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
        contract_name: 'pox',
      };
      return stxEvent;
    };
    const stxLockEvents = [
      createStxLockEvent('addrA', 400n),
      createStxLockEvent('addrA', 222n, 1),
      createStxLockEvent('addrB', 333n, 1),
    ];
    await db.updateStxLockEvents(client, [{ tx, stxLockEvents }]);
    await db.updateTx(client, tx);
    await db.updateTx(client, tx2);

    const addrAResult = await db.getStxBalance({ stxAddress: 'addrA', includeUnanchored: false });
    const addrBResult = await db.getStxBalance({ stxAddress: 'addrB', includeUnanchored: false });
    const addrCResult = await db.getStxBalance({ stxAddress: 'addrC', includeUnanchored: false });
    const addrDResult = await db.getStxBalance({ stxAddress: 'addrD', includeUnanchored: false });

    expect(addrAResult).toEqual({
      balance: 198291n,
      totalReceived: 100000n,
      totalSent: 385n,
      totalFeesSent: 1334n,
      totalMinerRewardsReceived: 100010n,
      burnchainLockHeight: 123,
      burnchainUnlockHeight: 201,
      lockHeight: 1,
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
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 14,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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
    const ftBurnEvent: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Burn,
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      asset_identifier: 'bux',
      amount: BigInt(10),
      recipient: undefined,
      sender: 'addrA',
    };
    events.push(ftBurnEvent);
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: events,
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const blockHeight = await db.getMaxBlockHeight(client, { includeUnanchored: false });
    const addrAResult = await db.getFungibleTokenBalances({
      stxAddress: 'addrA',
      untilBlock: blockHeight,
    });
    const addrBResult = await db.getFungibleTokenBalances({
      stxAddress: 'addrB',
      untilBlock: blockHeight,
    });
    const addrCResult = await db.getFungibleTokenBalances({
      stxAddress: 'addrC',
      untilBlock: blockHeight,
    });
    const addrDResult = await db.getFungibleTokenBalances({
      stxAddress: 'addrD',
      untilBlock: blockHeight,
    });

    expect([...addrAResult]).toEqual([
      ['bux', { balance: 99605n, totalReceived: 100000n, totalSent: 395n }],
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
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 1230,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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
          value: '',
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
    const nftBurnEvent: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Burn,
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      asset_identifier: 'cash',
      value: '',
      recipient: undefined,
      sender: 'addrA',
    };
    events.push([nftBurnEvent]);

    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: events.flat(),
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const blockHeight = await db.getMaxBlockHeight(client, { includeUnanchored: false });

    const addrAResult = await db.getNonFungibleTokenCounts({
      stxAddress: 'addrA',
      untilBlock: blockHeight,
    });
    const addrBResult = await db.getNonFungibleTokenCounts({
      stxAddress: 'addrB',
      untilBlock: blockHeight,
    });
    const addrCResult = await db.getNonFungibleTokenCounts({
      stxAddress: 'addrC',
      untilBlock: blockHeight,
    });
    const addrDResult = await db.getNonFungibleTokenCounts({
      stxAddress: 'addrD',
      untilBlock: blockHeight,
    });

    expect([...addrAResult]).toEqual([
      ['bux', { count: 262n, totalReceived: 300n, totalSent: 38n }],
      ['cash', { count: 499n, totalReceived: 500n, totalSent: 1n }],
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
      parent_microblock_hash: '0x00',
      block_height: 1235,
      block_time: 94869287,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.updateBlock(client, block);
    const blockQuery = await db.getBlock({ hash: block.block_hash });
    assert(blockQuery.found);
    expect(blockQuery.result).toEqual(block);

    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      block_time: 2837566,
      burn_block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);
    const blockTxs = await db.getBlockTxs(block.index_block_hash);
    expect(blockTxs.results).toHaveLength(1);
    expect(blockTxs.results[0]).toBe('0x1234');
  });

  test('pg address transactions', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };

    let indexIdIndex = 0;
    const createStxTx = (
      sender: string,
      recipient: string,
      amount: number,
      dbBlock: DbBlock,
      canonical: boolean = true
    ) => {
      const tx: DbTxRaw = {
        tx_id: '0x1234' + (++indexIdIndex).toString().padStart(4, '0'),
        tx_index: indexIdIndex,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: '0x',
        index_block_hash: dbBlock.index_block_hash,
        block_hash: dbBlock.block_hash,
        block_height: dbBlock.block_height,
        block_time: dbBlock.burn_block_time,
        burn_block_height: dbBlock.burn_block_height,
        burn_block_time: dbBlock.burn_block_time,
        parent_burn_block_time: 1626122935,
        type_id: DbTxTypeId.TokenTransfer,
        token_transfer_amount: BigInt(amount),
        token_transfer_memo: bufferToHex(Buffer.from('hi')),
        token_transfer_recipient_address: recipient,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical,
        post_conditions: '0x',
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: sender,
        origin_hash_mode: 1,
        event_count: 0,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        parent_block_hash: dbBlock.parent_block_hash,
        microblock_canonical: true,
        microblock_sequence: I32_MAX,
        microblock_hash: '0x00',
        execution_cost_read_count: 0,
        execution_cost_read_length: 0,
        execution_cost_runtime: 0,
        execution_cost_write_count: 0,
        execution_cost_write_length: 0,
      };
      const stxEvent: DbStxEvent = {
        event_type: DbEventTypeId.StxAsset,
        amount: BigInt(amount),
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: sender,
        recipient: recipient,
        block_height: dbBlock.block_height,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        event_index: 0,
        canonical: tx.canonical,
      };
      return { tx, stxEvent };
    };
    const txs = [
      createStxTx('none', 'addrA', 100_000, dbBlock),
      createStxTx('addrA', 'addrB', 100, dbBlock),
      createStxTx('addrA', 'addrB', 250, dbBlock),
      createStxTx('addrA', 'addrB', 40, dbBlock, false),
      createStxTx('addrB', 'addrC', 15, dbBlock),
      createStxTx('addrA', 'addrC', 35, dbBlock),
      createStxTx('addrE', 'addrF', 2, dbBlock),
      createStxTx('addrE', 'addrF', 2, dbBlock),
      createStxTx('addrE', 'addrF', 2, dbBlock),
      createStxTx('addrE', 'addrF', 2, dbBlock),
      createStxTx('addrE', 'addrF', 2, dbBlock),
    ];

    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: txs.map(t => ({
        tx: t.tx,
        stxEvents: [t.stxEvent],
        stxLockEvents: [],
        ftEvents: [],
        nftEvents: [],
        contractLogEvents: [],
        names: [],
        namespaces: [],
        smartContracts: [],
        pox2Events: [],
        pox3Events: [],
        pox4Events: [],
      })),
    });

    const blockHeight = await db.getMaxBlockHeight(client, { includeUnanchored: false });

    const addrAResult = await db.getAddressTxs({
      stxAddress: 'addrA',
      limit: 3,
      offset: 0,
      blockHeight: blockHeight,
      atSingleBlock: false,
    });
    const addrBResult = await db.getAddressTxs({
      stxAddress: 'addrB',
      limit: 3,
      offset: 0,
      blockHeight: blockHeight,
      atSingleBlock: false,
    });
    const addrCResult = await db.getAddressTxs({
      stxAddress: 'addrC',
      limit: 3,
      offset: 0,
      blockHeight: blockHeight,
      atSingleBlock: false,
    });
    const addrDResult = await db.getAddressTxs({
      stxAddress: 'addrD',
      limit: 3,
      offset: 0,
      blockHeight: blockHeight,
      atSingleBlock: false,
    });
    const addrEResult = await db.getAddressTxs({
      stxAddress: 'addrE',
      limit: 3,
      offset: 0,
      blockHeight: blockHeight,
      atSingleBlock: false,
    });
    const addrEResultP2 = await db.getAddressTxs({
      stxAddress: 'addrE',
      limit: 3,
      offset: 3,
      blockHeight: blockHeight,
      atSingleBlock: false,
    });

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

    //test for atBlock query
    const dbBlock1: DbBlock = {
      block_hash: '0xffff',
      index_block_hash: '0x1235',
      parent_index_block_hash: dbBlock.index_block_hash,
      parent_block_hash: dbBlock.block_hash,
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 2,
      block_time: 1594647996,
      burn_block_time: 1594647996,
      burn_block_hash: '0x1235',
      burn_block_height: 124,
      miner_txid: '0x4322',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const txs1 = [
      createStxTx('addrA', 'addrB', 100, dbBlock1),
      createStxTx('addrA', 'addrB', 250, dbBlock1),
      createStxTx('addrA', 'addrB', 40, dbBlock1, false),
      createStxTx('addrB', 'addrC', 15, dbBlock1),
      createStxTx('addrA', 'addrC', 35, dbBlock1),
      createStxTx('addrE', 'addrF', 2, dbBlock1),
      createStxTx('addrE', 'addrF', 2, dbBlock1),
      createStxTx('addrE', 'addrF', 2, dbBlock1),
      createStxTx('addrE', 'addrF', 2, dbBlock1),
      createStxTx('addrE', 'addrF', 2, dbBlock1),
    ];
    await db.update({
      block: dbBlock1,
      microblocks: [],
      minerRewards: [],
      txs: txs1.map(t => ({
        tx: t.tx,
        stxEvents: [t.stxEvent],
        stxLockEvents: [],
        ftEvents: [],
        nftEvents: [],
        contractLogEvents: [],
        names: [],
        namespaces: [],
        smartContracts: [],
        pox2Events: [],
        pox3Events: [],
        pox4Events: [],
      })),
    });

    const addrAAtBlockResult = await db.getAddressTxs({
      stxAddress: 'addrA',
      limit: 1000,
      offset: 0,
      blockHeight: 2,
      atSingleBlock: true,
    });

    const addrAAllBlockResult = await db.getAddressTxs({
      stxAddress: 'addrA',
      limit: 1000,
      offset: 0,
      blockHeight: 2,
      atSingleBlock: false,
    });

    expect(addrAAtBlockResult.total).toBe(3);
    expect(addrAAllBlockResult.total).toBe(7);
  });

  test('pg get address asset events', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx1: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 6,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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

    const tx2: DbTxRaw = {
      tx_id: '0x2234',
      tx_index: 3,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 14,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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

    const tx3: DbTxRaw = {
      tx_id: '0x3234',
      tx_index: 2,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 46,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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
          value: '0x0000000000000000000000000000000000',
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
      // await db.updateNftEvent(client, tx3, event);
    }

    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxEvents: stxEvents,
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: tx2,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: ftEvents,
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: tx3,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: nftEvents.flat(),
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const blockHeight = await db.getMaxBlockHeight(client, { includeUnanchored: false });

    const assetDbEvents = await db.getAddressAssetEvents({
      stxAddress: 'addrA',
      limit: 10000,
      offset: 0,
      blockHeight: blockHeight,
    });
    const assetEvents = assetDbEvents.results.map(event => parseDbEvent(event));
    expect(assetEvents).toEqual([
      {
        event_index: 0,
        event_type: 'stx_asset',
        tx_id: '0x1234',
        asset: { asset_event_type: 'transfer', sender: 'addrA', recipient: 'addrB', amount: '100' },
      },
      {
        event_index: 0,
        event_type: 'stx_asset',
        tx_id: '0x1234',
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
        tx_id: '0x1234',
        asset: { asset_event_type: 'transfer', sender: 'addrA', recipient: 'addrC', amount: '35' },
      },
      {
        event_index: 0,
        event_type: 'stx_asset',
        tx_id: '0x1234',
        asset: { asset_event_type: 'transfer', sender: 'addrA', recipient: 'addrB', amount: '250' },
      },
      {
        event_index: 5,
        event_type: 'fungible_token_asset',
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x2234',
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
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'gox',
          sender: 'addrA',
          recipient: 'addrC',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'cash',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'tendies',
          sender: 'addrA',
          recipient: 'none',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'none',
          recipient: 'addrA',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
      {
        event_index: 0,
        event_type: 'non_fungible_token_asset',
        tx_id: '0x3234',
        asset: {
          asset_event_type: 'transfer',
          asset_id: 'bux',
          sender: 'addrA',
          recipient: 'addrB',
          value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
        },
      },
    ]);
  });

  test('pg tx store and retrieve with post-conditions', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: { ...tx, raw_tx: '0x' },
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `token-transfer` tx type constraint', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await expect(db.updateTx(client, { ...tx, raw_tx: '0x' })).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_token_transfer"')
    );
    tx.token_transfer_amount = 34n;
    tx.token_transfer_memo = '0x746878';
    tx.token_transfer_recipient_address = 'recipient-addr';
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: { ...tx, raw_tx: '0x' },
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `smart-contract` tx type constraint', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.SmartContract,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await expect(db.updateTx(client, { ...tx, raw_tx: '0x' })).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_smart_contract"')
    );
    tx.smart_contract_contract_id = 'my-contract';
    tx.smart_contract_source_code = '(src)';
    const contract: DbSmartContract = {
      tx_id: tx.tx_id,
      canonical: true,
      block_height: dbBlock.block_height,
      clarity_version: null,
      contract_id: 'my-contract',
      source_code: '(src)',
      abi: '{"some":"abi"}',
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: { ...tx, raw_tx: '0x' },
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [contract],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `versioned-smart-contract` tx type constraint', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.VersionedSmartContract,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error(
        'new row for relation "txs" violates check constraint "valid_versioned_smart_contract"'
      )
    );
    tx.smart_contract_clarity_version = 2;
    tx.smart_contract_contract_id = 'my-contract';
    tx.smart_contract_source_code = '(src)';
    const contract: DbSmartContract = {
      tx_id: tx.tx_id,
      canonical: true,
      block_height: dbBlock.block_height,
      clarity_version: 2,
      contract_id: 'my-contract',
      source_code: '(src)',
      abi: '{"some":"abi"}',
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [contract],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    // Expect tx without raw data.
    const txRes: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.VersionedSmartContract,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      abi: undefined,
      smart_contract_clarity_version: 2,
      smart_contract_contract_id: 'my-contract',
      smart_contract_source_code: '(src)',
      sponsor_nonce: undefined,
    };
    expect(txQuery.result).toEqual(txRes);
  });

  test('pg `contract-call` tx type constraint', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.ContractCall,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await expect(db.updateTx(client, { ...tx, raw_tx: '0x' })).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_contract_call"')
    );
    tx.contract_call_contract_id = 'my-contract';
    tx.contract_call_function_name = 'my-fn';
    tx.contract_call_function_args = '0x74657374';
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: { ...tx, raw_tx: '0x' },
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `poison-microblock` tx type constraint', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.PoisonMicroblock,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await expect(db.updateTx(client, { ...tx, raw_tx: '0x' })).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_poison_microblock"')
    );
    tx.poison_microblock_header_1 = '0x706f69736f6e2041';
    tx.poison_microblock_header_2 = '0x706f69736f6e2042';
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: { ...tx, raw_tx: '0x' },
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test('pg `coinbase` tx type constraint', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await expect(db.updateTx(client, { ...tx, raw_tx: '0x' })).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_coinbase"')
    );
    tx.coinbase_payload = '0x636f696e62617365206869';
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: { ...tx, raw_tx: '0x' },
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
  });

  test.skip('pg tx store duplicate block index hash data', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.updateBlock(client, dbBlock);

    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      block_time: dbBlock.burn_block_time,
      burn_block_time: dbBlock.burn_block_time,
      burn_block_height: dbBlock.burn_block_height,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const updatedRows = await db.updateTx(client, tx);
    expect(updatedRows).toBe(1);
    const txQuery = await db.getTx({ txId: tx.tx_id, includeUnanchored: false });
    assert(txQuery.found);
    expect(txQuery.result).toEqual(tx);
    try {
      const dupeUpdateRows = await db.updateTx(client, tx);
      expect(dupeUpdateRows).toBe(0);
    } catch (error: any) {
      expect(error.toString()).toContain('duplicate key value violates unique constraint');
    }
  });

  test('pg event store and retrieve', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 94869286,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx1: DbTx = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      abi: undefined,
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      block_time: 2837565,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      sponsor_nonce: undefined,
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: '0x6869',
      event_count: 5,
      parent_index_block_hash: '0x',
      parent_block_hash: '0x',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx2: DbTx = {
      ...tx1,
      tx_id: '0x012345',
      tx_index: 1,
      event_count: 0,
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
      value: '0x736f6d652076616c',
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
      value: '0x736f6d652076616c',
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block1.block_height,
      clarity_version: null,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    const name1: DbBnsName = {
      tx_id: '0x421234',
      tx_index: 0,
      canonical: true,
      name: 'xyz',
      address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      namespace_id: 'abc',
      registered_at: block1.block_height,
      expire_block: 14,
      zonefile:
        '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
      zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
    };
    const namespace1: DbBnsNamespace = {
      tx_id: '0x421234',
      tx_index: 0,
      namespace_id: 'abc',
      address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
      base: 1n,
      coeff: 1n,
      launched_at: 14,
      lifetime: 1,
      no_vowel_discount: 1n,
      nonalpha_discount: 1n,
      ready_block: block1.block_height,
      reveal_block: 6,
      status: 'ready',
      buckets: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
      canonical: true,
    };
    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: { ...tx1, raw_tx: '0x' },
          stxLockEvents: [],
          stxEvents: [stxEvent1],
          ftEvents: [ftEvent1],
          nftEvents: [nftEvent1],
          contractLogEvents: [contractLogEvent1],
          smartContracts: [smartContract1],
          names: [name1],
          namespaces: [namespace1],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: { ...tx2, raw_tx: '0x' },
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const fetchTx1 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
    assert(fetchTx1.found);
    expect(fetchTx1.result).toEqual(tx1);

    const fetchTx2 = await db.getTx({ txId: tx2.tx_id, includeUnanchored: false });
    assert(fetchTx2.found);
    expect(fetchTx2.result).toEqual(tx2);

    const fetchBlock1 = await db.getBlock({ hash: block1.block_hash });
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
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 2,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 3,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
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
      parent_microblock_hash: '0x00',
      block_height: 4,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const block4: DbBlock = {
      block_hash: '0x44',
      index_block_hash: '0xdd',
      parent_index_block_hash: block3.index_block_hash,
      parent_block_hash: block3.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 4,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const block5: DbBlock = {
      block_hash: '0x55',
      index_block_hash: '0xee',
      parent_index_block_hash: block4.index_block_hash,
      parent_block_hash: block4.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 5,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const block6: DbBlock = {
      block_hash: '0x66',
      index_block_hash: '0xff',
      parent_index_block_hash: block5.index_block_hash,
      parent_block_hash: block5.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 6,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const tx1Mempool: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x01',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x746573742d7261772d7478',
      type_id: DbTxTypeId.TokenTransfer,
      receipt_time: 123456,
      token_transfer_amount: 1n,
      token_transfer_memo: bufferToHex(Buffer.from('hi')),
      token_transfer_recipient_address: 'stx-recipient-addr',
      status: DbTxStatus.Pending,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    const tx1: DbTxRaw = {
      ...tx1Mempool,
      tx_index: 0,
      raw_tx: '0x746573742d7261772d7478',
      index_block_hash: block3B.index_block_hash,
      block_hash: block3B.block_hash,
      block_height: block3B.block_height,
      block_time: block3B.burn_block_time,
      burn_block_height: block3B.burn_block_height,
      burn_block_time: block3B.burn_block_time,
      parent_burn_block_time: 1626122935,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx1b: DbTxRaw = {
      ...tx1,
      index_block_hash: block6.index_block_hash,
      block_hash: block6.block_hash,
      block_height: block6.block_height,
      burn_block_time: block6.burn_block_time,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      event_count: 0,
    };

    await db.updateMempoolTxs({ mempoolTxs: [tx1Mempool] });
    const txQuery1 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
    expect(txQuery1.found).toBe(true);
    expect(txQuery1?.result?.status).toBe(DbTxStatus.Pending);

    for (const block of [block1, block2, block3]) {
      await db.update({
        block: block,
        microblocks: [],
        minerRewards: [],
        txs: [],
      });
    }
    await db.update({
      block: block3B,
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
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    // tx should still be in mempool since it was included in a non-canonical chain-tip
    const txQuery2 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
    expect(txQuery2.found).toBe(true);
    expect(txQuery2?.result?.status).toBe(DbTxStatus.Pending);

    await db.update({
      block: block4B,
      microblocks: [],
      minerRewards: [],
      txs: [],
    });
    // the fork containing this tx was made canonical, it should no longer be in the mempool
    const txQuery3 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
    expect(txQuery3.found).toBe(false);

    // the tx should be in the mined tx table, marked as canonical and success status
    const txQuery4 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
    expect(txQuery4.found).toBe(true);
    expect(txQuery4?.result?.status).toBe(DbTxStatus.Success);
    expect(txQuery4?.result?.canonical).toBe(true);

    // reorg the chain to make the tx no longer canonical
    for (const block of [block4, block5]) {
      await db.update({
        block: block,
        microblocks: [],
        minerRewards: [],
        txs: [],
      });
    }

    // the tx should be in the mined tx table, marked as non-canonical
    const txQuery5 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
    expect(txQuery5.found).toBe(true);
    expect(txQuery5?.result?.status).toBe(DbTxStatus.Success);
    expect(txQuery5?.result?.canonical).toBe(false);

    // the fork containing this tx was made canonical again, it should now in the mempool
    const txQuery6 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
    expect(txQuery6.found).toBe(true);
    expect(txQuery6?.result?.status).toBe(DbTxStatus.Pending);

    // mine the same tx in the latest canonical block
    await db.update({
      block: block6,
      microblocks: [],
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
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    // tx should no longer be in the mempool after being mined
    const txQuery7 = await db.getMempoolTx({ txId: tx1b.tx_id, includeUnanchored: false });
    expect(txQuery7.found).toBe(false);

    // tx should be back in the mined tx table and associated with the new block
    const txQuery8 = await db.getTx({ txId: tx1b.tx_id, includeUnanchored: false });
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
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 1234,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
      parent_microblock_sequence: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 2,
      block_time: 1234,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
      parent_microblock_sequence: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 3,
      block_time: 1234,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
      parent_microblock_sequence: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
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
      parent_microblock_hash: '0x00',
      block_height: 4,
      block_time: 1234,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
      parent_microblock_sequence: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };

    const minerReward1: DbMinerReward = {
      ...block1,
      from_index_block_hash: '0x33',
      mature_block_height: 3,
      recipient: 'miner-addr1',
      miner_address: 'miner-addr1',
      coinbase_amount: 1000n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 5n,
    };

    const tx1: DbTxRaw = {
      tx_id: '0x01',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block1.index_block_hash,
      block_hash: block1.block_hash,
      block_height: block1.block_height,
      block_time: block1.burn_block_time,
      burn_block_height: block1.burn_block_height,
      burn_block_time: block1.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: false,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 1,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const tx2: DbTxRaw = {
      tx_id: '0x02',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block2.index_block_hash,
      block_hash: block2.block_hash,
      block_height: block2.block_height,
      block_time: block2.burn_block_time,
      burn_block_height: block2.burn_block_height,
      burn_block_time: block2.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: false,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const stxLockEvent1: DbStxLockEvent = {
      ...tx1,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 1234n,
      unlock_height: 20,
      locked_address: 'locked-addr1',
      contract_name: 'pox',
    };

    // inserts blocks directly -- just runs sql insert without any reorg handling
    for (const block of [block1, block2, block3, block3B, block4]) {
      await db.updateBlock(client, block);
    }

    // insert miner rewards directly
    await db.updateMinerRewards(client, [minerReward1]);

    // insert txs directly
    for (const tx of [tx1, tx2]) {
      await db.updateTx(client, tx);
    }

    // insert stx lock events directly
    await db.updateStxLockEvents(client, [{ tx: tx1, stxLockEvents: [stxLockEvent1] }]);

    const block5: DbBlock = {
      block_hash: '0x55',
      index_block_hash: '0xee',
      parent_index_block_hash: block4.index_block_hash,
      parent_block_hash: block4.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 5,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const reorgResult = await db.handleReorg(client, block5, 0);
    const expectedReorgResult: ReOrgUpdatedEntities = {
      markedCanonical: {
        blocks: 4,
        microblocks: 0,
        minerRewards: 1,
        txs: 2,
        stxLockEvents: 1,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        pox2Events: 0,
        pox3Events: 0,
        pox4Events: 0,
        contractLogs: 0,
        smartContracts: 0,
        names: 0,
        namespaces: 0,
        subdomains: 0,
        poxCycles: 0,
        poxSigners: 0,
      },
      markedNonCanonical: {
        blocks: 1,
        microblocks: 0,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        pox2Events: 0,
        pox3Events: 0,
        pox4Events: 0,
        contractLogs: 0,
        smartContracts: 0,
        names: 0,
        namespaces: 0,
        subdomains: 0,
        poxCycles: 0,
        poxSigners: 0,
      },
      prunedMempoolTxs: 0,
      restoredMempoolTxs: 0,
    };
    expect(reorgResult).toEqual(expectedReorgResult);

    const blockQuery1 = await db.getBlock({ hash: block1.block_hash });
    expect(blockQuery1.result?.canonical).toBe(true);

    const blockQuery2 = await db.getBlock({ hash: block2.block_hash });
    expect(blockQuery2.result?.canonical).toBe(true);

    const blockQuery3B = await db.getBlock({ hash: block3B.block_hash });
    expect(blockQuery3B.result?.canonical).toBe(false);
  });

  test('pg reorg handling', async () => {
    const block1: DbBlock = {
      block_hash: '0x11',
      index_block_hash: '0xaa',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 2,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const minerReward1: DbMinerReward = {
      ...block1,
      mature_block_height: 3,
      from_index_block_hash: '0x11',
      recipient: 'miner-addr1',
      miner_address: 'miner-addr1',
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
      miner_address: 'miner-addr2',
      coinbase_amount: 1000n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 0n,
    };

    const tx1: DbTxRaw = {
      tx_id: '0x01',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block1.index_block_hash,
      block_hash: block1.block_hash,
      block_height: block1.block_height,
      block_time: block1.block_height,
      burn_block_height: block1.burn_block_height,
      burn_block_time: block1.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 1,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const tx2: DbTxRaw = {
      tx_id: '0x02',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block2.index_block_hash,
      block_hash: block2.block_hash,
      block_height: block2.block_height,
      block_time: block2.burn_block_time,
      burn_block_height: block2.burn_block_height,
      burn_block_time: block2.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      sponsor_address: undefined,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 1,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const stxLockEvent1: DbStxLockEvent = {
      ...tx1,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 1234n,
      unlock_height: block1.block_height + 100000,
      locked_address: 'locked-addr1',
      contract_name: 'pox',
    };

    const stxLockEvent2: DbStxLockEvent = {
      ...tx2,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 45n,
      unlock_height: block2.block_height + 100000,
      locked_address: 'locked-addr2',
      contract_name: 'pox',
    };

    // Start canonical chain
    await db.update({
      block: block1,
      microblocks: [],
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
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    await db.update({
      block: block2,
      microblocks: [],
      minerRewards: [minerReward2],
      txs: [
        {
          tx: tx2,
          stxLockEvents: [stxLockEvent2],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [
            {
              event_type: DbEventTypeId.NonFungibleTokenAsset,
              asset_event_type_id: DbAssetEventTypeId.Mint,
              value: bnsNameCV('xyz.abc'),
              asset_identifier: 'SP000000000000000000002Q6VF78.bns::names',
              recipient: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
              tx_id: tx2.tx_id,
              tx_index: tx2.tx_index,
              block_height: 2,
              event_index: 1,
              canonical: true,
            },
          ],
          contractLogEvents: [],
          smartContracts: [],
          names: [
            {
              name: 'xyz.abc',
              address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
              namespace_id: 'abc',
              registered_at: 2,
              expire_block: 14,
              status: 'name-register',
              zonefile:
                '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
              zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
              canonical: true,
              tx_id: tx2.tx_id,
              tx_index: tx2.tx_index,
            },
          ],
          namespaces: [
            {
              namespace_id: 'abc',
              address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
              base: 1n,
              coeff: 1n,
              launched_at: 14,
              lifetime: 1,
              no_vowel_discount: 1n,
              nonalpha_discount: 1n,
              ready_block: 2,
              reveal_block: 6,
              status: 'ready',
              buckets: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
              canonical: true,
              tx_id: tx2.tx_id,
              tx_index: tx2.tx_index,
            },
          ],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    await db.resolveBnsSubdomains(
      {
        index_block_hash: block2.index_block_hash,
        parent_index_block_hash: block2.parent_block_hash,
        microblock_canonical: true,
        microblock_hash: '0x00',
        microblock_sequence: 0,
      },
      [
        {
          namespace_id: 'abc',
          name: 'xyz',
          fully_qualified_subdomain: 'def.xyz.abc',
          owner: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
          canonical: true,
          zonefile: 'zone file ',
          zonefile_hash: 'zone file hash',
          parent_zonefile_hash: 'parent zone file hash',
          parent_zonefile_index: 1,
          block_height: 2,
          zonefile_offset: 0,
          resolver: 'resolver',
          tx_id: tx2.tx_id,
          tx_index: tx2.tx_index,
        },
      ]
    );

    let name = await db.getName({
      name: 'xyz.abc',
      includeUnanchored: false,
    });
    assert(name.found);
    expect(name.result.canonical).toBe(true);

    let namespace = await db.getNamespace({ namespace: 'abc', includeUnanchored: false });
    assert(namespace.found);
    expect(namespace.result.canonical).toBe(true);
    expect(namespace.result.index_block_hash).toBe(block2.index_block_hash);

    let subdomain = await db.getSubdomain({
      subdomain: 'def.xyz.abc',
      includeUnanchored: false,
      chainId: ChainID.Mainnet,
    });
    assert(subdomain.found);
    expect(subdomain.result.canonical).toBe(true);
    expect(subdomain.result.index_block_hash).toBe(block2.index_block_hash);

    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 3,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.update({ block: block3, microblocks: [], minerRewards: [], txs: [] });

    const block2b: DbBlock = {
      block_hash: '0x22bb',
      index_block_hash: '0xbbbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 2,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx3: DbTxRaw = {
      tx_id: '0x03',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block2b.index_block_hash,
      block_hash: block2b.block_hash,
      block_height: block2b.block_height,
      block_time: block2b.burn_block_time,
      burn_block_height: block2b.burn_block_height,
      burn_block_time: block2b.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const contract1: DbSmartContract = {
      tx_id: tx3.tx_id,
      canonical: true,
      clarity_version: null,
      contract_id: 'my-contract',
      block_height: tx3.block_height,
      source_code: '(my-src)',
      abi: '{"thing":1}',
    };

    // Insert non-canonical block
    await db.update({
      block: block2b,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx3,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [
            {
              event_type: DbEventTypeId.NonFungibleTokenAsset,
              asset_event_type_id: DbAssetEventTypeId.Mint,
              value: bnsNameCV('xyz.abc'),
              asset_identifier: 'SP000000000000000000002Q6VF78.bns::names',
              recipient: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
              tx_id: tx3.tx_id,
              tx_index: tx3.tx_index,
              block_height: block2b.block_height,
              event_index: 0,
              canonical: true,
            },
          ],
          contractLogEvents: [],
          smartContracts: [contract1],
          names: [
            {
              name: 'xyz.abc',
              address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
              namespace_id: 'abc',
              status: 'name-register',
              registered_at: block2b.block_height,
              expire_block: 14,
              zonefile:
                '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
              zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
              canonical: true,
              tx_id: tx3.tx_id,
              tx_index: tx3.tx_index,
            },
          ],
          namespaces: [
            {
              namespace_id: 'abc',
              address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
              base: 1n,
              coeff: 1n,
              launched_at: 14,
              lifetime: 1,
              no_vowel_discount: 1n,
              nonalpha_discount: 1n,
              ready_block: 2,
              reveal_block: 6,
              status: 'ready',
              buckets: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
              canonical: true,
              tx_id: tx3.tx_id,
              tx_index: tx3.tx_index,
            },
          ],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const isBlock2bCanonical = await db.getBlock({ hash: block2b.block_hash });
    await db.resolveBnsSubdomains(
      {
        index_block_hash: block2b.index_block_hash,
        parent_index_block_hash: block2b.parent_index_block_hash,
        microblock_hash: '0x00',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [
        {
          namespace_id: 'abc',
          name: 'xyz',
          fully_qualified_subdomain: 'def.xyz.abc',
          owner: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
          canonical: isBlock2bCanonical.result?.canonical ?? false,
          zonefile: 'zone file ',
          zonefile_hash: 'zone file hash',
          parent_zonefile_hash: 'parent zone file hash',
          parent_zonefile_index: 1,
          block_height: 2,
          tx_index: 0,
          tx_id: '',
          zonefile_offset: 0,
          resolver: 'resolver',
        },
      ]
    );

    const blockQuery1 = await db.getBlock({ hash: block2b.block_hash });
    expect(blockQuery1.result?.canonical).toBe(false);
    const chainTip1 = await db.getChainTip(db.sql);
    expect(chainTip1).toEqual({
      block_hash: '0x33',
      block_height: 3,
      index_block_hash: '0xcc',
      burn_block_height: 123,
      block_count: 3,
      mempool_tx_count: 0,
      microblock_count: 0,
      microblock_hash: undefined,
      microblock_sequence: undefined,
      tx_count: 2, // Tx from block 2b does not count
      tx_count_unanchored: 2,
    });
    const namespaces = await db.getNamespaceList({ includeUnanchored: false });
    expect(namespaces.results.length).toBe(1);
    const names = await db.getNamespaceNamesList({
      namespace: 'abc',
      page: 0,
      includeUnanchored: false,
    });
    expect(names.results.length).toBe(1);

    name = await db.getName({
      name: 'xyz.abc',
      includeUnanchored: false,
    });
    assert(name.found);
    expect(name.result.canonical).toBe(true);

    namespace = await db.getNamespace({ namespace: 'abc', includeUnanchored: false });
    assert(namespace.found);
    expect(namespace.result.canonical).toBe(true);
    expect(namespace.result.index_block_hash).toBe(block2.index_block_hash);

    subdomain = await db.getSubdomain({
      subdomain: 'def.xyz.abc',
      includeUnanchored: false,
      chainId: ChainID.Mainnet,
    });
    assert(subdomain.found);
    expect(subdomain.result.canonical).toBe(true);
    expect(subdomain.result.index_block_hash).toBe(block2.index_block_hash);

    const block3b: DbBlock = {
      block_hash: '0x33bb',
      index_block_hash: '0xccbb',
      parent_index_block_hash: block2b.index_block_hash,
      parent_block_hash: block2b.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 3,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.update({ block: block3b, microblocks: [], minerRewards: [], txs: [] });
    const blockQuery2 = await db.getBlock({ hash: block3b.block_hash });
    expect(blockQuery2.result?.canonical).toBe(false);
    // Chain tip doesn't change yet.
    const chainTip2 = await db.getChainTip(db.sql);
    expect(chainTip2).toEqual({
      block_hash: '0x33',
      block_height: 3,
      index_block_hash: '0xcc',
      burn_block_height: 123,
      block_count: 3,
      microblock_count: 0,
      microblock_hash: undefined,
      microblock_sequence: undefined,
      tx_count: 2,
      tx_count_unanchored: 2,
      mempool_tx_count: 0,
    });

    const block4b: DbBlock = {
      block_hash: '0x44bb',
      index_block_hash: '0xddbb',
      parent_index_block_hash: block3b.index_block_hash,
      parent_block_hash: block3b.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 4,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.update({ block: block4b, microblocks: [], minerRewards: [], txs: [] });

    name = await db.getName({
      name: 'xyz.abc',
      includeUnanchored: false,
    });
    assert(name.found);
    expect(name.result.canonical).toBe(true);

    namespace = await db.getNamespace({ namespace: 'abc', includeUnanchored: false });
    assert(namespace.found);
    expect(namespace.result.canonical).toBe(true);
    expect(namespace.result.index_block_hash).toBe(block2b.index_block_hash);

    const blockQuery3 = await db.getBlock({ hash: block3b.block_hash });
    expect(blockQuery3.result?.canonical).toBe(true);
    const chainTip3 = await db.getChainTip(db.sql);
    expect(chainTip3).toEqual({
      block_count: 4,
      block_hash: '0x44bb',
      block_height: 4,
      burn_block_height: 123,
      index_block_hash: '0xddbb',
      microblock_count: 0,
      microblock_hash: undefined,
      microblock_sequence: undefined,
      tx_count: 2, // Tx from block 2b now counts, but compensates with tx from block 2
      tx_count_unanchored: 2,
      mempool_tx_count: 1,
    });

    const b1 = await db.getBlock({ hash: block1.block_hash });
    const b2 = await db.getBlock({ hash: block2.block_hash });
    const b2b = await db.getBlock({ hash: block2b.block_hash });
    const b3 = await db.getBlock({ hash: block3.block_hash });
    const b3b = await db.getBlock({ hash: block3b.block_hash });
    const b4 = await db.getBlock({ hash: block4b.block_hash });
    expect(b1.result?.canonical).toBe(true);
    expect(b2.result?.canonical).toBe(false);
    expect(b2b.result?.canonical).toBe(true);
    expect(b3.result?.canonical).toBe(false);
    expect(b3b.result?.canonical).toBe(true);
    expect(b4.result?.canonical).toBe(true);

    const r1 = await db.getStxBalance({
      stxAddress: minerReward1.recipient,
      includeUnanchored: false,
    });
    const r2 = await db.getStxBalance({
      stxAddress: minerReward2.recipient,
      includeUnanchored: false,
    });
    expect(r1.totalMinerRewardsReceived).toBe(1014n);
    expect(r2.totalMinerRewardsReceived).toBe(0n);

    const lock1 = await db.getStxBalance({
      stxAddress: stxLockEvent1.locked_address,
      includeUnanchored: false,
    });
    const lock2 = await db.getStxBalance({
      stxAddress: stxLockEvent2.locked_address,
      includeUnanchored: false,
    });
    expect(lock1.locked).toBe(1234n);
    expect(lock2.locked).toBe(0n);

    const t1 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
    const t2 = await db.getTx({ txId: tx2.tx_id, includeUnanchored: false });
    const t3 = await db.getTx({ txId: tx3.tx_id, includeUnanchored: false });
    expect(t1.result?.canonical).toBe(true);
    expect(t2.result?.canonical).toBe(false);
    expect(t3.result?.canonical).toBe(true);

    const sc1 = await db.getSmartContract(contract1.contract_id);
    expect(sc1.found && sc1.result?.canonical).toBe(true);

    // Ensure STX holder balances have tracked correctly through the reorgs
    const holders1 = await db.getTokenHolders({ token: 'stx', limit: 100, offset: 0 });
    for (const holder of holders1.results) {
      const holderBalance = await db.getStxBalance({
        stxAddress: holder.address,
        includeUnanchored: false,
      });
      expect(holder.balance).toBe(holderBalance.balance.toString());
    }
  });

  test('pg balance reorg handling', async () => {
    const block1: DbBlock = {
      block_hash: '0x11',
      index_block_hash: '0xaa',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 2,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const block2b: DbBlock = {
      block_hash: '0x22bb',
      index_block_hash: '0xbbbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 2,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 3,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const block3b: DbBlock = {
      block_hash: '0x33bb',
      index_block_hash: '0xccbb',
      parent_index_block_hash: block2b.index_block_hash,
      parent_block_hash: block2b.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 3,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const block4b: DbBlock = {
      block_hash: '0x44bb',
      index_block_hash: '0xddbb',
      parent_index_block_hash: block3b.index_block_hash,
      parent_block_hash: block3b.block_hash,
      parent_microblock_hash: '0x00',
      block_height: 4,
      block_time: 1234,
      burn_block_time: 1234,
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
      tx_count: 1,
      signer_bitvec: null,
    };

    const minerReward1: DbMinerReward = {
      ...block1,
      mature_block_height: 3,
      from_index_block_hash: '0x11',
      recipient: 'addr1',
      miner_address: 'addr1',
      coinbase_amount: 2n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 2n,
      tx_fees_streamed_produced: 2n,
    };

    // test miner reward that gets orphaned
    const minerReward2: DbMinerReward = {
      ...block2,
      mature_block_height: 4,
      from_index_block_hash: '0x22',
      recipient: 'addr1',
      miner_address: 'addr1',
      coinbase_amount: 3n,
      tx_fees_anchored: 3n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 3n,
    };

    const tx1: DbTxRaw = {
      tx_id: '0x01',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block1.index_block_hash,
      block_hash: block1.block_hash,
      block_height: block1.block_height,
      block_time: block1.block_height,
      burn_block_height: block1.burn_block_height,
      burn_block_time: block1.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 10n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'addr1',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const tx2: DbTxRaw = {
      tx_id: '0x02',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block2.index_block_hash,
      block_hash: block2.block_hash,
      block_height: block2.block_height,
      block_time: block2.burn_block_time,
      burn_block_height: block2.burn_block_height,
      burn_block_time: block2.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 10n,
      sponsored: false,
      sender_address: 'addr1',
      sponsor_address: undefined,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 1,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    // test sponsored tx
    const tx3: DbTxRaw = {
      tx_id: '0x0201',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block2.index_block_hash,
      block_hash: block2.block_hash,
      block_height: block2.block_height,
      block_time: block2.burn_block_time,
      burn_block_height: block2.burn_block_height,
      burn_block_time: block2.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 25n,
      sponsored: true,
      sender_address: 'other-addr',
      sponsor_address: 'addr1',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 1,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const tx4: DbTxRaw = {
      tx_id: '0x03',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block2b.index_block_hash,
      block_hash: block2b.block_hash,
      block_height: block2b.block_height,
      block_time: block2b.burn_block_time,
      burn_block_height: block2b.burn_block_height,
      burn_block_time: block2b.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 10n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'addr1',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    // test stx mint
    const stxEvent1: DbStxEvent = {
      event_index: 1,
      tx_id: tx1.tx_id,
      tx_index: tx1.tx_index,
      block_height: block1.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Mint,
      sender: undefined,
      recipient: 'addr1',
      event_type: DbEventTypeId.StxAsset,
      amount: 1000n,
    };

    // test stx mint gets orphaned
    const stxEvent2: DbStxEvent = {
      event_index: 1,
      tx_id: tx2.tx_id,
      tx_index: tx2.tx_index,
      block_height: block2.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Mint,
      sender: undefined,
      recipient: 'addr1',
      event_type: DbEventTypeId.StxAsset,
      amount: 5555n,
    };

    // test stx transfer to addr
    const stxEvent3: DbStxEvent = {
      event_index: 1,
      tx_id: tx2.tx_id,
      tx_index: tx2.tx_index,
      block_height: block2.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'other-addr',
      recipient: 'addr1',
      event_type: DbEventTypeId.StxAsset,
      amount: 4444n,
    };

    // test stx transfer from addr
    const stxEvent4: DbStxEvent = {
      event_index: 1,
      tx_id: tx2.tx_id,
      tx_index: tx2.tx_index,
      block_height: block2.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'addr1',
      recipient: 'other-addr',
      event_type: DbEventTypeId.StxAsset,
      amount: 1111n,
    };

    const ftBEvent1: DbFtEvent = {
      event_index: 1,
      tx_id: tx1.tx_id,
      tx_index: tx1.tx_index,
      block_height: block1.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Mint,
      sender: undefined,
      recipient: 'addr1',
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: 8000n,
      asset_identifier: 'my-ft-b',
    };

    const ftAEvent1: DbFtEvent = {
      event_index: 1,
      tx_id: tx1.tx_id,
      tx_index: tx1.tx_index,
      block_height: block1.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Mint,
      sender: undefined,
      recipient: 'addr1',
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: 8000n,
      asset_identifier: 'my-ft-a',
    };

    const ftAEvent2: DbFtEvent = {
      event_index: 1,
      tx_id: tx2.tx_id,
      tx_index: tx2.tx_index,
      block_height: block2.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Mint,
      sender: undefined,
      recipient: 'addr1',
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: 1000n,
      asset_identifier: 'my-ft-a',
    };

    const ftAEvent3: DbFtEvent = {
      event_index: 1,
      tx_id: tx2.tx_id,
      tx_index: tx2.tx_index,
      block_height: block2.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Burn,
      sender: 'addr1',
      recipient: undefined,
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: 600n,
      asset_identifier: 'my-ft-a',
    };

    const ftAEvent4: DbFtEvent = {
      event_index: 1,
      tx_id: tx2.tx_id,
      tx_index: tx2.tx_index,
      block_height: block2.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'other-addr',
      recipient: 'addr1',
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: 500n,
      asset_identifier: 'my-ft-a',
    };

    // Start canonical chain
    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [minerReward1],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [stxEvent1],
          ftEvents: [ftAEvent1, ftBEvent1],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    await db.update({
      block: block2,
      microblocks: [],
      minerRewards: [minerReward2],
      txs: [
        {
          tx: tx2,
          stxLockEvents: [],
          stxEvents: [stxEvent2, stxEvent3, stxEvent4],
          ftEvents: [ftAEvent2, ftAEvent3, ftAEvent4],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: tx3,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const holdersBlock2 = await db.getTokenHolders({ token: 'stx', limit: 100, offset: 0 });
    expect(holdersBlock2.results.find(b => b.address === 'addr1')?.balance).toBe(
      (
        minerReward1.coinbase_amount +
        minerReward1.tx_fees_anchored +
        minerReward1.tx_fees_streamed_confirmed +
        minerReward1.tx_fees_streamed_produced +
        minerReward2.coinbase_amount +
        minerReward2.tx_fees_anchored +
        minerReward2.tx_fees_streamed_confirmed +
        minerReward2.tx_fees_streamed_produced +
        stxEvent1.amount +
        stxEvent2.amount +
        stxEvent3.amount -
        stxEvent4.amount -
        tx1.fee_rate -
        tx2.fee_rate -
        tx3.fee_rate
      ).toString()
    );

    const holdersFtABlock2 = await db.getTokenHolders({ token: 'my-ft-a', limit: 100, offset: 0 });
    expect(holdersFtABlock2.results.find(b => b.address === 'addr1')?.balance).toBe(
      (ftAEvent1.amount + ftAEvent2.amount - ftAEvent3.amount + ftAEvent4.amount).toString()
    );

    const holdersFtBBlock2 = await db.getTokenHolders({ token: 'my-ft-b', limit: 100, offset: 0 });
    expect(holdersFtBBlock2.results.find(b => b.address === 'addr1')?.balance).toBe(
      ftBEvent1.amount.toString()
    );

    await db.update({ block: block3, microblocks: [], minerRewards: [], txs: [] });

    // Insert non-canonical block
    await db.update({
      block: block2b,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx4,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    await db.update({ block: block3b, microblocks: [], minerRewards: [], txs: [] });
    await db.update({ block: block4b, microblocks: [], minerRewards: [], txs: [] });

    const b1 = await db.getBlock({ hash: block1.block_hash });
    const b2 = await db.getBlock({ hash: block2.block_hash });
    const b2b = await db.getBlock({ hash: block2b.block_hash });
    const b3 = await db.getBlock({ hash: block3.block_hash });
    const b3b = await db.getBlock({ hash: block3b.block_hash });
    const b4 = await db.getBlock({ hash: block4b.block_hash });
    expect(b1.result?.canonical).toBe(true);
    expect(b2.result?.canonical).toBe(false);
    expect(b2b.result?.canonical).toBe(true);
    expect(b3.result?.canonical).toBe(false);
    expect(b3b.result?.canonical).toBe(true);
    expect(b4.result?.canonical).toBe(true);

    const t1 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
    const t2 = await db.getTx({ txId: tx2.tx_id, includeUnanchored: false });
    const t3 = await db.getTx({ txId: tx3.tx_id, includeUnanchored: false });
    const t4 = await db.getTx({ txId: tx4.tx_id, includeUnanchored: false });
    expect(t1.result?.canonical).toBe(true);
    expect(t2.result?.canonical).toBe(false);
    expect(t3.result?.canonical).toBe(false);
    expect(t4.result?.canonical).toBe(true);

    const holders1 = await db.getTokenHolders({ token: 'stx', limit: 100, offset: 0 });
    expect(holders1.results.find(b => b.address === 'addr1')?.balance).toBe(
      (
        minerReward1.coinbase_amount +
        minerReward1.tx_fees_anchored +
        minerReward1.tx_fees_streamed_confirmed +
        minerReward1.tx_fees_streamed_produced +
        stxEvent1.amount -
        tx1.fee_rate -
        tx4.fee_rate
      ).toString()
    );

    // Ensure STX holder balances have tracked correctly through the reorgs
    for (const holder of holders1.results) {
      const holderBalance = await db.getStxBalance({
        stxAddress: holder.address,
        includeUnanchored: false,
      });
      expect(holder.balance).toBe(holderBalance.balance.toString());
    }

    // Ensure FT (token-a) holder balance have tracked correctly through the reorgs
    const holdersFtTokenA = await db.getTokenHolders({ token: 'my-ft-a', limit: 100, offset: 0 });
    expect(holdersFtTokenA.results.find(b => b.address === 'addr1')?.balance).toBe(
      ftAEvent1.amount.toString()
    );

    // Ensure FT (token-a) holder balance have tracked correctly through the reorgs
    const holdersFtTokenB = await db.getTokenHolders({ token: 'my-ft-b', limit: 100, offset: 0 });
    expect(holdersFtTokenB.results.find(b => b.address === 'addr1')?.balance).toBe(
      ftBEvent1.amount.toString()
    );
  });

  test('pg get raw tx', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 94869286,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx1: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x616263',
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      block_time: 2837565,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    await db.update({
      block: block1,
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
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const fetchTx1 = await db.getRawTx(tx1.tx_id);
    assert(fetchTx1.found);
    expect(fetchTx1.result.raw_tx).toEqual('0x616263');
  });

  test('pg get raw tx: tx not found', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 94869286,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx1: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('abc')),
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      block_time: 2837565,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    await db.update({
      block: block1,
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
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const fetchTx1 = await db.getRawTx('0x12');
    expect(fetchTx1.found).toEqual(false);
  });

  test('pg transaction event count', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      block_height: 1,
      block_time: 94869286,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const tx1: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      block_time: 2837565,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 4,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx2: DbTxRaw = {
      ...tx1,
      event_count: 0,
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
      value: '0x736f6d652076616c',
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
      value: '0x736f6d652076616c',
    };

    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [stxEvent1],
          ftEvents: [ftEvent1],
          nftEvents: [nftEvent1],
          contractLogEvents: [contractLogEvent1],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: tx2,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const fetchTx1 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
    expect(fetchTx1.result?.event_count).toBe(4);
    const fetchTx2 = await db.getTx({ txId: tx2.tx_id, includeUnanchored: false });
    expect(fetchTx2.result?.event_count).toBe(0);
  });

  test('pg data insert in namespace', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [],
    });
    const namespace: DbBnsNamespace = {
      namespace_id: 'abc',
      address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
      base: 1n,
      coeff: 1n,
      launched_at: dbBlock.block_height,
      lifetime: 1,
      no_vowel_discount: 1n,
      nonalpha_discount: 1n,
      ready_block: dbBlock.block_height,
      reveal_block: 6,
      status: 'ready',
      buckets: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNamespaces(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '0x00',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      } as DataStoreBnsBlockTxData,
      [namespace]
    );
    const { results } = await db.getNamespaceList({ includeUnanchored: false });
    expect(results.length).toBe(1);
    expect(results[0]).toBe('abc');
  });

  test('pg insert data in names', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [],
    });
    const name: DbBnsName = {
      name: 'xyz',
      address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      namespace_id: 'abc',
      registered_at: dbBlock.block_height,
      expire_block: 14,
      status: 'name-register',
      zonefile:
        '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
      zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '0x00',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      } as DataStoreBnsBlockTxData,
      [name]
    );
    const { results } = await db.getNamespaceNamesList({
      namespace: 'abc',
      page: 0,
      includeUnanchored: false,
    });
    expect(results.length).toBe(1);
    expect(results[0]).toBe('xyz');
  });

  test('pg subdomain insert and retrieve', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [],
    });
    const subdomain: DbBnsSubdomain = {
      namespace_id: 'test',
      name: 'nametest',
      fully_qualified_subdomain: 'test.nametest.namespacetest',
      owner: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      canonical: true,
      zonefile: 'zone file ',
      zonefile_hash: 'zone file hash',
      parent_zonefile_hash: 'parent zone file hash',
      parent_zonefile_index: 1,
      block_height: dbBlock.block_height,
      tx_index: 0,
      tx_id: '',
      zonefile_offset: 0,
      resolver: 'resolver',
    };

    const subdomains: DbBnsSubdomain[] = [];
    subdomains.push(subdomain);
    await db.resolveBnsSubdomains(
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '0x00',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      subdomains
    );
    const { results } = await db.getSubdomainsList({ page: 0, includeUnanchored: false });
    expect(results.length).toBe(1);
    expect(results[0]).toBe('test.nametest.namespacetest');
  });

  test('pg get transactions in a block', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      block_height: 1235,
      block_time: 94869286,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.updateBlock(client, block);
    const blockQuery = await db.getBlock({ hash: block.block_hash });
    assert(blockQuery.found);
    expect(blockQuery.result).toEqual(block);

    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      abi: undefined,
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      block_time: 2837565,
      burn_block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);

    const tx2: DbTxRaw = {
      tx_id: '0x123456',
      tx_index: 5,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      block_time: 2837565,
      burn_block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      sponsor_address: undefined,
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx2);
    const blockTxs = await db.getTxsFromBlock({ hash: block.block_hash }, 20, 0);
    assert(blockTxs.found);
    expect(blockTxs.result.results.length).toBe(2);
    expect(blockTxs.result.total).toBe(2);
  });

  test('pg get transactions in a block: with limit and offset', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      block_height: 1235,
      block_time: 94869286,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    await db.updateBlock(client, block);
    const blockQuery = await db.getBlock({ hash: block.block_hash });
    assert(blockQuery.found);
    expect(blockQuery.result).toEqual(block);

    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x',
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      block_time: 2837565,
      burn_block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: '0x636f696e62617365206869',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '0x',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x00',
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);
    const blockTxs = await db.getTxsFromBlock({ hash: block.block_hash }, 20, 6);
    assert(blockTxs.found);
    expect(blockTxs.result.results.length).toBe(0);
    expect(blockTxs.result.total).toBe(1);
  });

  test('pg token offering locked inserted: success', async () => {
    const lockedInfo: DbTokenOfferingLocked = {
      address: 'SP04MFJ3RWTADV6ZWTWD68DBZ14EJSDXT50Q7TE6',
      value: BigInt(4139394444),
      block: 33477,
    };
    const lockedInfo2: DbTokenOfferingLocked = {
      address: 'SP04MFJ3RWTADV6ZWTWD68DBZ14EJSDXT50Q7TE6',
      value: BigInt(4139394444),
      block: 29157,
    };
    const lockedInfo3: DbTokenOfferingLocked = {
      address: 'SP04MFJ3RWTADV6ZWTWD68DBZ14EJSDXT50Q7TE6',
      value: BigInt(4139394444),
      block: 19157,
    };
    await db.updateBatchTokenOfferingLocked(client, [lockedInfo, lockedInfo2, lockedInfo3]);
    const results = await db.getTokenOfferingLocked(lockedInfo.address, 29157);
    expect(results.found).toBe(true);
    const total = lockedInfo.value + lockedInfo2.value + lockedInfo3.value;
    expect(
      BigInt(results.result?.total_locked ?? 0) + BigInt(results.result?.total_unlocked ?? 0)
    ).toBe(total);
    expect(results.result).toEqual({
      total_locked: '4139394444',
      total_unlocked: '8278788888',
      unlock_schedule: [
        {
          amount: '4139394444',
          block_height: 19157,
        },
        {
          amount: '4139394444',
          block_height: 29157,
        },
        {
          amount: '4139394444',
          block_height: 33477,
        },
      ],
    });
  });

  test('pg token offering locked: not found', async () => {
    const results = await db.getTokenOfferingLocked(
      'SM1ZH700J7CEDSEHM5AJ4C4MKKWNESTS35DD3SZM5',
      100
    );
    expect(results.found).toBe(false);
  });

  test('empty parameter lists are handled correctly', async () => {
    const block = new TestBlockBuilder({ block_height: 1 }).addTx().build();
    await db.update(block);

    // Blocks with limit=0
    await expect(getBlocksWithMetadata({ limit: 0, offset: 0, db: db })).resolves.not.toThrow();
    // Mempool search with empty txIds
    await expect(db.getMempoolTxs({ txIds: [], includeUnanchored: true })).resolves.not.toThrow();
    // NFT holdings with empty asset identifier list
    await expect(
      db.getNftHoldings({
        principal: 'S',
        assetIdentifiers: [],
        limit: 10,
        offset: 0,
        includeTxMetadata: false,
        includeUnanchored: true,
      })
    ).resolves.not.toThrow();
    // Tx list details with empty txIds
    await expect(
      db.getTxListDetails({ txIds: [], includeUnanchored: true })
    ).resolves.not.toThrow();
  });
});
