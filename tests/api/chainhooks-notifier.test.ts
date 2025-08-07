const messages: string[] = [];

// Mock needs to handle both default and named exports
jest.mock('ioredis', () => {
  const redisMock = jest.fn().mockImplementation(() => ({
    rpush: jest.fn((_, message) => {
      messages.push(message);
    }),
    quit: jest.fn().mockResolvedValue(undefined),
  }));
  // Handle both default and named exports
  const mock = redisMock as unknown as { default: typeof redisMock };
  mock.default = redisMock;
  return mock;
});

import { migrate } from '../utils/test-helpers';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { TestBlockBuilder } from '../utils/test-builders';

describe('chainhooks notifier', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    process.env.CHAINHOOKS_NOTIFIER_ENABLED = '1';
    process.env.CHAINHOOKS_REDIS_URL = 'redis://localhost:6379';
    process.env.CHAINHOOKS_REDIS_QUEUE = 'test-queue';
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      withChainhooksNotifier: true,
      skipMigrations: true,
    });
    await migrate('up');
    messages.length = 0; // Clear messages array before each test
  });

  afterEach(async () => {
    await db.close();
    await migrate('down');
  });

  test('updates chainhooks', async () => {
    const block1 = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x1234',
      index_block_hash: '0x1234',
    }).build();
    await db.update(block1);

    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0]).payload).toEqual({
      chain: 'stacks',
      network: 'mainnet',
      apply_blocks: [{ hash: '0x1234', index: 1 }],
      rollback_blocks: [],
    });
  });

  test('updates chainhooks with re-orgs', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: '0x1234',
        index_block_hash: '0x1234',
      }).build()
    );
    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0]).payload).toEqual({
      chain: 'stacks',
      network: 'mainnet',
      apply_blocks: [{ hash: '0x1234', index: 1 }],
      rollback_blocks: [],
    });
    messages.length = 0;

    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x1235',
        index_block_hash: '0x1235',
        parent_index_block_hash: '0x1234',
      }).build()
    );
    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0]).payload).toEqual({
      chain: 'stacks',
      network: 'mainnet',
      apply_blocks: [{ hash: '0x1235', index: 2 }],
      rollback_blocks: [],
    });
    messages.length = 0;

    // Re-org block 2, should not send a message because this block is not canonical
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x1235aa',
        index_block_hash: '0x1235aa',
        parent_index_block_hash: '0x1234',
      }).build()
    );
    expect(messages.length).toBe(0);
    messages.length = 0;

    // Advance the non-canoincal chain, original block 2 should be sent as a rollback block
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0x1236',
        index_block_hash: '0x1236',
        parent_index_block_hash: '0x1235aa',
      }).build()
    );
    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0]).payload).toEqual({
      chain: 'stacks',
      network: 'mainnet',
      apply_blocks: [
        { hash: '0x1235aa', index: 2 },
        { hash: '0x1236', index: 3 },
      ],
      rollback_blocks: [{ hash: '0x1235', index: 2 }],
    });
  });
});
