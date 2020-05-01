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
} from '../datastore/common';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';

describe('in-memory datastore', () => {
  let db: MemoryDataStore;

  beforeEach(() => {
    db = new MemoryDataStore();
  });

  test('in-memory block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '123',
      index_block_hash: '0x1234',
      parent_block_hash: '0x5678',
      parent_microblock: '987',
      block_height: 123,
      burn_block_time: 39486,
      canonical: false,
    };
    await db.updateBlock(block);
    const retrievedBlock = await db.getBlock(block.block_hash);
    expect(retrievedBlock).toEqual(block);
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

  test('pg block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1235,
      burn_block_time: 94869286,
      canonical: true,
    };
    await db.updateBlock(client, block);
    const retrievedBlock = await db.getBlock(block.block_hash);
    expect(retrievedBlock).toEqual(block);
  });

  test('pg tx store and retrieve with post-conditions', async () => {
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      block_hash: '0x3434',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, tx);
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  test('pg `token-transfer` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      block_hash: '0x3434',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.TokenTransfer,
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_token_transfer"')
    );
    tx.token_transfer_amount = BigInt(34);
    tx.token_transfer_memo = Buffer.from('thx');
    tx.token_transfer_recipient_address = 'recipient-addr';
    await db.updateTx(client, tx);
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  test('pg `smart-contract` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      block_hash: '0x3434',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.SmartContract,
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
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
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  test('pg `contract-call` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      block_hash: '0x3434',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.ContractCall,
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
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
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  test('pg `poison-microblock` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      block_hash: '0x3434',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.PoisonMicroblock,
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
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
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  test('pg `coinbase` tx type constraint', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      block_hash: '0x3434',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(client, tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_coinbase"')
    );
    tx.coinbase_payload = Buffer.from('coinbase hi');
    await db.updateTx(client, tx);
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  test('pg event store and retrieve', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 333,
      burn_block_time: 94869286,
      canonical: true,
    };
    const tx1: DbTx = {
      tx_id: '0x421234',
      tx_index: 0,
      block_hash: '0x1234',
      block_height: 333,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
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
      block_height: 333,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'sender-addr',
      recipient: 'recipient-addr',
      event_type: DbEventTypeId.StxAsset,
      amount: BigInt(789),
    };
    const ftEvent1: DbFtEvent = {
      event_index: 2,
      tx_id: '0x421234',
      block_height: 333,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'sender-addr',
      recipient: 'recipient-addr',
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: BigInt(789),
      asset_identifier: 'ft-asset-id',
    };
    const nftEvent1: DbNftEvent = {
      event_index: 3,
      tx_id: '0x421234',
      block_height: 333,
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
      block_height: 333,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: 'some-contract-id',
      topic: 'some-topic',
      value: Buffer.from('some val'),
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: 333,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    await db.update({
      block: block1,
      txs: [tx1, tx2],
      stxEvents: [stxEvent1],
      ftEvents: [ftEvent1],
      nftEvents: [nftEvent1],
      contractLogEvents: [contractLogEvent1],
      smartContracts: [smartContract1],
    });

    const fetchTx1 = await db.getTx(tx1.tx_id);
    expect(fetchTx1).toEqual(tx1);

    const fetchTx2 = await db.getTx(tx2.tx_id);
    expect(fetchTx2).toEqual(tx2);

    const fetchBlock1 = await db.getBlock(block1.block_hash);
    expect(fetchBlock1).toEqual(block1);

    const fetchContract1 = await db.getSmartContract(smartContract1.contract_id);
    expect(fetchContract1).toEqual(smartContract1);

    const fetchTx1Events = await db.getTxEvents(tx1.tx_id);
    expect(fetchTx1Events).toHaveLength(4);
    expect(fetchTx1Events.find(e => e.event_index === 1)).toEqual(stxEvent1);
    expect(fetchTx1Events.find(e => e.event_index === 2)).toEqual(ftEvent1);
    expect(fetchTx1Events.find(e => e.event_index === 3)).toEqual(nftEvent1);
    expect(fetchTx1Events.find(e => e.event_index === 4)).toEqual(contractLogEvent1);
  });

  test('pg reorg handling', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 333,
      burn_block_time: 94869286,
      canonical: true,
    };
    const block2: DbBlock = {
      ...block1,
      block_height: 334,
      block_hash: '0x1235',
    };
    const tx1: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      block_hash: '0x1234',
      block_height: 333,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };
    const tx2: DbTx = {
      ...tx1,
      tx_id: '0x012345',
      block_hash: '0x1235',
      block_height: 334,
    };
    const stxEvent1: DbStxEvent = {
      event_index: 1,
      tx_id: '0x421234',
      block_height: 333,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'sender-addr',
      recipient: 'recipient-addr',
      event_type: DbEventTypeId.StxAsset,
      amount: BigInt(789),
    };
    const ftEvent1: DbFtEvent = {
      event_index: 2,
      tx_id: '0x421234',
      block_height: 333,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      sender: 'sender-addr',
      recipient: 'recipient-addr',
      event_type: DbEventTypeId.FungibleTokenAsset,
      amount: BigInt(789),
      asset_identifier: 'ft-asset-id',
    };
    const nftEvent1: DbNftEvent = {
      event_index: 3,
      tx_id: '0x421234',
      block_height: 333,
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
      block_height: 333,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: 'some-contract-id',
      topic: 'some-topic',
      value: Buffer.from('some val'),
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: 333,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    await db.update({
      block: block1,
      txs: [tx1],
      stxEvents: [stxEvent1],
      ftEvents: [ftEvent1],
      nftEvents: [nftEvent1],
      contractLogEvents: [contractLogEvent1],
      smartContracts: [smartContract1],
    });
    await db.update({
      block: block2,
      txs: [tx2],
      stxEvents: [],
      ftEvents: [],
      nftEvents: [],
      contractLogEvents: [],
      smartContracts: [],
    });

    const fetchTx1 = await db.getTx(tx1.tx_id);
    expect(fetchTx1.canonical).toBe(true);

    const fetchBlock1 = await db.getBlock(block1.block_hash);
    expect(fetchBlock1.canonical).toBe(true);

    const newChainBlock: DbBlock = {
      ...block1,
      block_height: 333,
      block_hash: '0x1111',
    };
    const reorgResults = await db.handleReorg(client, newChainBlock);
    expect(reorgResults).toEqual({
      blocks: 2,
      txs: 2,
      ftEvents: 2,
      nftEvents: 1,
      contractLogs: 1,
      smartContracts: 1,
    });

    const fetchOrphanTx1 = await db.getTx(tx1.tx_id);
    expect(fetchOrphanTx1.canonical).toBe(false);

    const fetchOrphanBlock1 = await db.getBlock(block1.block_hash);
    expect(fetchOrphanBlock1.canonical).toBe(false);

    const fetchOrphanEvents = await db.getTxEvents(tx1.tx_id);
    expect(fetchOrphanEvents).toHaveLength(0);
  });

  afterEach(async () => {
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down', () => {});
  });
});
