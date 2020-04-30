import { MemoryDataStore } from '../datastore/memory-store';
import { DbBlock, DbTx, DbTxTypeId } from '../datastore/common';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';

describe('in-memory datastore', () => {
  let db: MemoryDataStore;

  beforeEach(() => {
    db = new MemoryDataStore();
  });

  test('in-memory block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '123',
      index_block_hash: 'abc',
      parent_block_hash: 'asdf',
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

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
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
    await db.updateBlock(block);
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
      sender_address: 'asdf34',
      origin_hash_mode: 1,
    };
    await db.updateTx(tx);
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
      sender_address: 'adsf4546',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_token_transfer"')
    );
    tx.token_transfer_amount = BigInt(34);
    tx.token_transfer_memo = Buffer.from('thx');
    tx.token_transfer_recipient_address = 'recipient-addr';
    await db.updateTx(tx);
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
      sender_address: 'adsf4546',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_smart_contract"')
    );
    tx.smart_contract_contract_id = 'my-contract';
    tx.smart_contract_source_code = '(src)';
    await db.updateTx(tx);
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
      sender_address: 'adsf4546',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_contract_call"')
    );
    tx.contract_call_contract_id = 'my-contract';
    tx.contract_call_function_name = 'my-fn';
    tx.contract_call_function_args = Buffer.from('test');
    await db.updateTx(tx);
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
      sender_address: 'adsf4546',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_poison_microblock"')
    );
    tx.poison_microblock_header_1 = Buffer.from('poison A');
    tx.poison_microblock_header_2 = Buffer.from('poison B');
    await db.updateTx(tx);
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
      sender_address: 'adsf4546',
      origin_hash_mode: 1,
    };
    await expect(db.updateTx(tx)).rejects.toEqual(
      new Error('new row for relation "txs" violates check constraint "valid_coinbase"')
    );
    tx.coinbase_payload = Buffer.from('coinbase hi');
    await db.updateTx(tx);
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down', () => {});
  });
});
