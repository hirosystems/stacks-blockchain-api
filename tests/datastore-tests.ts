import { MemoryDataStore } from '../src/datastore/memory-store';
import { DbBlock } from '../src/datastore/common';
import { PgDataStore } from '../src/datastore/postgres-store';

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
    };
    await db.updateBlock(block);
    const retrievedBlock = await db.getBlock(block.block_hash);
    expect(retrievedBlock).toEqual(block);
  });
});

describe('postgres datastore', () => {
  let db: PgDataStore;
  beforeAll(async () => {
    db = await PgDataStore.connect();
  });
  test('pg block store and retrieve', async () => {
    const block: DbBlock = {
      block_hash: '123',
      index_block_hash: 'abc',
      parent_block_hash: 'asdf',
      parent_microblock: '987',
    };
    await db.updateBlock(block);
    const retrievedBlock = await db.getBlock(block.block_hash);
    expect(retrievedBlock).toEqual(block);
  });
  afterAll(async () => {
    await db?.close();
  });
});
