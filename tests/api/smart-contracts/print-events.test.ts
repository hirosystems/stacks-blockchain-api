import supertest from 'supertest';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { PgSqlClient } from '@stacks/api-toolkit';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';

const CONTRACT_ID = 'SP000000000000000000002Q6VF78.pox-3';

describe('smart contract print events v2', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: true,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('returns empty results for contract with no events', async () => {
    // Create a block with no contract log events
    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x' + '01'.padStart(64, '0'),
    })
      .addTx()
      .build();
    await db.update(block);

    const { body } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events`
    );
    assert.equal(body.total, 0);
    assert.equal(body.results.length, 0);
    assert.equal(body.cursor, null);
    assert.equal(body.next_cursor, null);
    assert.equal(body.prev_cursor, null);
  });

  test('returns contract log events with correct shape', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x' + '01'.padStart(64, '0'),
    })
      .addTx({ tx_id: '0x' + 'aa'.padStart(64, '0') })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID, topic: 'print' })
      .build();
    await db.update(block);

    const { body } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events`
    );
    assert.equal(body.total, 1);
    assert.equal(body.results.length, 1);
    const event = body.results[0];
    assert.equal(event.event_type, 'smart_contract_log');
    assert.equal(event.tx_id, '0x' + 'aa'.padStart(64, '0'));
    assert.equal(event.contract_log.contract_id, CONTRACT_ID);
    assert.equal(event.contract_log.topic, 'print');
    assert.ok(event.contract_log.value.hex);
    assert.ok(event.contract_log.value.repr);
    assert.equal(typeof event.event_index, 'number');
  });

  test('cursor pagination forward and backward', async () => {
    // Create 7 events across 3 blocks to test pagination
    for (let i = 1; i <= 3; i++) {
      const builder = new TestBlockBuilder({
        block_height: i,
        index_block_hash: `0x${i.toString().padStart(64, '0')}`,
        parent_index_block_hash: `0x${(i - 1).toString().padStart(64, '0')}`,
      }).addTx({ tx_id: `0x${(i * 10).toString().padStart(64, '0')}` });

      // Add 2 events per block (except block 3 gets 3)
      const eventCount = i === 3 ? 3 : 2;
      for (let j = 0; j < eventCount; j++) {
        builder.addTxContractLogEvent({
          contract_identifier: CONTRACT_ID,
          topic: 'print',
        });
      }
      await db.update(builder.build());
    }

    // Total should be 7 events
    const { body: firstPage } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=3`
    );
    assert.equal(firstPage.total, 7);
    assert.equal(firstPage.results.length, 3);
    assert.equal(firstPage.limit, 3);
    assert.equal(firstPage.offset, 0);
    assert.notEqual(firstPage.cursor, null);
    // Latest events should be from block 3 (highest block_height)
    assert.equal(firstPage.results[0].contract_log.contract_id, CONTRACT_ID);
    // At the latest page, there's no next_cursor
    assert.equal(firstPage.next_cursor, null);
    // But there should be a prev_cursor to go to older events
    assert.notEqual(firstPage.prev_cursor, null);

    // Navigate to previous page (older events)
    const { body: secondPage } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=3&cursor=${firstPage.prev_cursor}`
    );
    assert.equal(secondPage.results.length, 3);
    assert.notEqual(secondPage.next_cursor, null);
    assert.notEqual(secondPage.prev_cursor, null);

    // Navigate to the oldest page
    const { body: thirdPage } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=3&cursor=${secondPage.prev_cursor}`
    );
    assert.equal(thirdPage.results.length, 1);
    // Oldest page has no prev_cursor
    assert.equal(thirdPage.prev_cursor, null);
    // But should have next_cursor to go back to newer events
    assert.notEqual(thirdPage.next_cursor, null);

    // Navigate back to the second page using next_cursor
    const { body: backToSecond } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=3&cursor=${thirdPage.next_cursor}`
    );
    assert.equal(backToSecond.results.length, 3);
    assert.equal(backToSecond.cursor, secondPage.cursor);
  });

  test('cursor with same cursor returns same page', async () => {
    for (let i = 1; i <= 5; i++) {
      const block = new TestBlockBuilder({
        block_height: i,
        index_block_hash: `0x${i.toString().padStart(64, '0')}`,
        parent_index_block_hash: `0x${(i - 1).toString().padStart(64, '0')}`,
      })
        .addTx({ tx_id: `0x${(i * 10).toString().padStart(64, '0')}` })
        .addTxContractLogEvent({ contract_identifier: CONTRACT_ID, topic: 'print' })
        .build();
      await db.update(block);
    }

    const { body: page1 } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=2`
    );
    assert.equal(page1.results.length, 2);
    assert.notEqual(page1.cursor, null);

    // Fetching with the same cursor should return the same page
    const { body: page1Again } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=2&cursor=${page1.cursor}`
    );
    assert.equal(page1Again.cursor, page1.cursor);
    assert.equal(page1Again.results.length, page1.results.length);
    assert.deepEqual(page1Again.results, page1.results);
  });

  test('high cursor returns latest events', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x' + '01'.padStart(64, '0'),
    })
      .addTx()
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .build();
    await db.update(block);

    // A cursor far in the future just returns the latest events
    const { body } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?cursor=999999:0:0:0`
    );
    assert.equal(body.total, 1);
    assert.equal(body.results.length, 1);
  });

  test('events are ordered newest first', async () => {
    for (let i = 1; i <= 3; i++) {
      const block = new TestBlockBuilder({
        block_height: i,
        index_block_hash: `0x${i.toString().padStart(64, '0')}`,
        parent_index_block_hash: `0x${(i - 1).toString().padStart(64, '0')}`,
      })
        .addTx({ tx_id: `0x${(i * 10).toString().padStart(64, '0')}` })
        .addTxContractLogEvent({ contract_identifier: CONTRACT_ID, topic: 'print' })
        .build();
      await db.update(block);
    }

    const { body } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=10`
    );
    assert.equal(body.results.length, 3);
    // Results should be in descending order (newest first)
    // Block 3 tx should come first
    assert.equal(body.results[0].tx_id, `0x${(30).toString().padStart(64, '0')}`);
    assert.equal(body.results[1].tx_id, `0x${(20).toString().padStart(64, '0')}`);
    assert.equal(body.results[2].tx_id, `0x${(10).toString().padStart(64, '0')}`);
  });

  test('only returns events for the specified contract', async () => {
    const otherContract = 'SP000000000000000000002Q6VF78.other-contract';

    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x' + '01'.padStart(64, '0'),
    })
      .addTx({ tx_id: '0x' + 'aa'.padStart(64, '0') })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID, topic: 'print' })
      .addTxContractLogEvent({ contract_identifier: otherContract, topic: 'print' })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID, topic: 'print' })
      .build();
    await db.update(block);

    const { body } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events`
    );
    assert.equal(body.total, 2);
    assert.equal(body.results.length, 2);
    for (const event of body.results) {
      assert.equal(event.contract_log.contract_id, CONTRACT_ID);
    }

    const { body: otherBody } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${otherContract}/print-events`
    );
    assert.equal(otherBody.total, 1);
    assert.equal(otherBody.results.length, 1);
    assert.equal(otherBody.results[0].contract_log.contract_id, otherContract);
  });

  test('respects limit parameter', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x' + '01'.padStart(64, '0'),
    })
      .addTx({ tx_id: '0x' + 'aa'.padStart(64, '0') })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .build();
    await db.update(block);

    const { body } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events?limit=2`
    );
    assert.equal(body.limit, 2);
    assert.equal(body.total, 5);
    assert.equal(body.results.length, 2);
  });

  test('contract_log_counts table is maintained correctly', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x' + '01'.padStart(64, '0'),
    })
      .addTx({ tx_id: '0x' + 'aa'.padStart(64, '0') })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .addTxContractLogEvent({ contract_identifier: CONTRACT_ID })
      .build();
    await db.update(block);

    // Verify count table directly
    const countResult = await client`
      SELECT count FROM contract_log_counts WHERE contract_identifier = ${CONTRACT_ID}
    `;
    assert.equal(countResult[0].count, 3);

    // Verify total in API matches
    const { body } = await supertest(api.server).get(
      `/extended/v2/smart-contracts/${CONTRACT_ID}/print-events`
    );
    assert.equal(body.total, 3);
  });
});
