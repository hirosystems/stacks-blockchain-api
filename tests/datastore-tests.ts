import { MemoryDataStore } from '../src/datastore/memory-store';
import { DbBlock } from '../src/datastore/common';
import { PgDataStore, cycleMigrations } from '../src/datastore/postgres-store';

describe('in-memory datastore', () => {
  let db: MemoryDataStore;
  beforeAll(() => {
    db = new MemoryDataStore();
  });
  test('in-memory block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '123',
      index_block_hash: 'abc',
      parent_block_hash: 'asdf',
      parent_microblock: '987',
      block_height: 123,
    };
    await db.updateBlock(block);
    const retrievedBlock = await db.getBlock(block.block_hash);
    expect(retrievedBlock).toEqual(block);
  });
});

describe('postgres datastore', () => {
  let db: PgDataStore;
  beforeAll(async () => {
    process.env.PG_DATABASE = 'stacks_core_sidecar_test';
    db = await PgDataStore.connect();
  });

  test('migrations', async () => {
    await cycleMigrations();
  });

  test('pg block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1235,
    };
    await db.updateBlock(block);
    const retrievedBlock = await db.getBlock(block.block_hash);
    expect(retrievedBlock).toEqual(block);
  });
  afterAll(async () => {
    await db?.close();
  });
});
