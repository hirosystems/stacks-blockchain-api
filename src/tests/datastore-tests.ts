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
      type_id: DbTxTypeId.Coinbase,
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

  test('pg tx store and retrieve', async () => {
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 4,
      block_hash: '0x3434',
      block_height: 68456,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      canonical: true,
      post_conditions: undefined,
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'adsf4546',
      origin_hash_mode: 1,
    };
    await db.updateTx(tx);
    const retrievedTx = await db.getTx(tx.tx_id);
    expect(retrievedTx).toEqual(tx);
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down', () => {});
  });
});
