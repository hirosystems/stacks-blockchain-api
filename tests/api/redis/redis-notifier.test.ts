const messages: string[] = [];

import { migrate } from '../../test-helpers.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { ENV } from '../../../src/env.ts';
import { RedisNotifier } from '../../../src/datastore/redis-notifier.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('redis notifier', () => {
  let db: PgWriteStore;
  let originalNewRedisConnection: unknown;

  beforeEach(async () => {
    // Patch RedisNotifier internals so no real Redis connection is required in node:test.
    originalNewRedisConnection = (RedisNotifier.prototype as any).newRedisConnection;
    (RedisNotifier.prototype as any).newRedisConnection = function () {
      return {
        xadd: async (_queue: string, _id: string, _field: string, message: string) => {
          messages.push(message);
        },
        xtrim: async () => undefined,
        quit: async () => undefined,
      };
    };

    ENV.REDIS_NOTIFIER_ENABLED = true;
    ENV.REDIS_URL = 'localhost:6379';
    ENV.REDIS_QUEUE = 'test-queue';
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      withRedisNotifier: true,
      skipMigrations: true,
    });
    messages.length = 0;
  });

  afterEach(async () => {
    await db.close();
    (RedisNotifier.prototype as any).newRedisConnection = originalNewRedisConnection;
    await migrate('down');
  });

  test('updates redis', async () => {
    const block1 = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x1234',
      index_block_hash: '0x1234',
      block_time: 1234,
    }).build();
    await db.update(block1);

    assert.equal(messages.length, 1);
    const payload = JSON.parse(messages[0]).payload;
    assert.equal(payload.chain, 'stacks');
    assert.equal(payload.network, 'testnet');
    assert.deepEqual(payload.apply_blocks, [{ hash: '0x1234', index: 1, time: 1234 }]);
    assert.deepEqual(payload.rollback_blocks, []);
  });

  test('updates redis with re-orgs', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: '0x1234',
        index_block_hash: '0x1234',
        block_time: 1234,
      }).build()
    );
    assert.equal(messages.length, 1);
    const payload1 = JSON.parse(messages[0]).payload;
    assert.equal(payload1.chain, 'stacks');
    assert.equal(payload1.network, 'testnet');
    assert.deepEqual(payload1.apply_blocks, [{ hash: '0x1234', index: 1, time: 1234 }]);
    assert.deepEqual(payload1.rollback_blocks, []);

    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x1235',
        index_block_hash: '0x1235',
        parent_index_block_hash: '0x1234',
        block_time: 1234,
      }).build()
    );
    assert.equal(messages.length, 2);
    const payload2 = JSON.parse(messages[1]).payload;
    assert.equal(payload2.chain, 'stacks');
    assert.equal(payload2.network, 'testnet');
    assert.deepEqual(payload2.apply_blocks, [{ hash: '0x1235', index: 2, time: 1234 }]);
    assert.deepEqual(payload2.rollback_blocks, []);

    // Re-org block 2, should not send a message because this block is not canonical
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x1235aa',
        index_block_hash: '0x1235aa',
        parent_index_block_hash: '0x1234',
        block_time: 1234,
      }).build()
    );
    assert.equal(messages.length, 2);

    // Advance the non-canoincal chain, original block 2 should be sent as a rollback block
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0x1236',
        index_block_hash: '0x1236',
        parent_index_block_hash: '0x1235aa',
        block_time: 1234,
      }).build()
    );
    assert.equal(messages.length, 3);
    const payload3 = JSON.parse(messages[2]).payload;
    assert.equal(payload3.chain, 'stacks');
    assert.equal(payload3.network, 'testnet');
    assert.deepEqual(payload3.apply_blocks, [
      { hash: '0x1235aa', index: 2, time: 1234 },
      { hash: '0x1236', index: 3, time: 1234 },
    ]);
    assert.deepEqual(payload3.rollback_blocks, [{ hash: '0x1235', index: 2, time: 1234 }]);
  });
});
