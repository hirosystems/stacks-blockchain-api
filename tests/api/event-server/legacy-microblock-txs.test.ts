import * as fs from 'fs';
import supertest from 'supertest';
import { PgSqlClient, logger } from '@stacks/api-toolkit';
import { STACKS_MAINNET } from '@stacks/network';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { startApiServer } from '../../../src/api/init.ts';
import { Block } from '../../../src/api/schemas/v1/entities/block.ts';
import { Transaction } from '../../../src/api/schemas/v1/entities/transactions.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ENV } from '../../../src/env.ts';
import { getRawEventRequests } from '../../../src/event-replay/event-requests.ts';
import { startEventServer } from '../../../src/event-stream/event-server.ts';
import { httpPostRequest } from '../../../src/helpers.ts';
import { migrate } from '../../test-helpers.ts';
import { useWithCleanup } from '../test-helpers.ts';

/**
 * Microblocks were removed in the Nakamoto upgrade and the API no longer ingests them. These tests
 * cover the two things that must keep working for pre-Nakamoto (epoch 2.x) history:
 *
 * 1. `/new_microblocks` events (present in every archival event replay of mainnet) are accepted and
 *    stored as raw events (like other unprocessed events, e.g. `/stackerdb_chunks`) but not
 *    processed, instead of stalling the replay.
 * 2. Microblock-confirmed transactions arriving inside a 2.x `/new_block` payload are ingested as
 *    regular transactions of the confirming anchor block, with the payload's `microblock_hash` /
 *    `microblock_sequence` values passed through so historical ordering is preserved.
 *
 * The fixture is a mainnet-shaped event log with several same-height forks (heights 30, 45, 47)
 * whose microblock-confirmed transactions appear on both sides of the fork.
 */
describe('legacy (pre-Nakamoto) microblock transactions', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let origStoreRawEvents: boolean;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    origStoreRawEvents = ENV.STACKS_API_STORE_RAW_EVENTS;
    ENV.STACKS_API_STORE_RAW_EVENTS = true;
  });

  afterEach(async () => {
    ENV.STACKS_API_STORE_RAW_EVENTS = origStoreRawEvents;
    await db?.close();
    await migrate('down');
  });

  test('/new_microblocks is stored as a raw event but not processed', async () => {
    await useWithCleanup(
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async eventServer => {
        const countRows = async () => {
          const [row] = await client<{ processed: number; raw: number }[]>`
            SELECT
              ((SELECT COUNT(*) FROM txs) + (SELECT COUNT(*) FROM microblocks))::int AS processed,
              (SELECT COUNT(*) FROM event_observer_requests WHERE event_path = '/new_microblocks')::int AS raw
          `;
          return row;
        };
        const before = await countRows();
        const response = await httpPostRequest({
          host: '127.0.0.1',
          port: eventServer.serverAddress.port,
          path: '/new_microblocks',
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(
            JSON.stringify({
              parent_index_block_hash: '0x' + 'ab'.repeat(32),
              burn_block_hash: '0x' + 'cd'.repeat(32),
              burn_block_height: 1,
              burn_block_timestamp: 1,
              transactions: [],
              events: [],
            }),
            'utf8'
          ),
          throwOnNotOK: false,
        });
        assert.equal(response.statusCode, 200);
        const after = await countRows();
        assert.equal(after.processed, before.processed);
        assert.equal(after.raw, before.raw + 1);
      }
    );
  });

  test('2.x anchor blocks with microblock-confirmed txs are ingested as regular block txs', async () => {
    // A tx that was streamed in a microblock, then confirmed by the first block at height 45. A
    // second (non-canonical) block at height 45 re-mines it as an anchor tx.
    const lostTx = '0x03484817283a83a0b0c23e84c2659f39c9a06d81a63329464d979ec2af476596';
    const canonicalBlockHash = '0x4d27059a847f3c3f6dbbd43343d11981b67409a2710597c6cb1814945cfc4d48';
    const canonicalBlockHeight = 45;
    const canonicalMicroblockHash =
      '0xa58e1ede6f244c92c51e8c5cb32be6c7dcf40e13c4ce4bfe87484f33422876e0';
    // Two competing blocks at height 30 (the second one wins once block 31 builds on it) both
    // confirm the same 3-microblock stream, so these txs appear on both sides of the fork.
    const block30MicroblockTxs = [
      {
        txId: '0x57cc390f7dbe',
        microblockHash: '0xd4af10b19114',
        microblockSequence: 0,
        txIndex: 1,
      },
      {
        txId: '0xa8d723f2b6b6',
        microblockHash: '0x91d75b7525ac',
        microblockSequence: 1,
        txIndex: 2,
      },
      {
        txId: '0x8a4d0b9556da',
        microblockHash: '0x5c6bc7082b6c',
        microblockSequence: 2,
        txIndex: 3,
      },
    ];
    await useWithCleanup(
      () => {
        const origLevel = logger.level;
        logger.level = 'error';
        return [, () => (logger.level = origLevel)] as const;
      },
      () => {
        const readStream = fs.createReadStream(
          'tests/api/event-server/tsv/legacy-microblock-txs.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, rawEventsIterator, eventServer, api) => {
        let microblockEvents = 0;
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            if (rawEvent.event_path === '/new_microblocks') microblockEvents++;
            await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
          }
        }
        assert.ok(microblockEvents > 0, 'fixture must contain /new_microblocks events');

        // Microblock events are stored as raw events for replay but never processed.
        const [{ microblocks }] = await client<{ microblocks: number }[]>`
          SELECT COUNT(*)::int AS microblocks FROM microblocks
        `;
        assert.equal(microblocks, 0);
        const storedPaths = await client<{ event_path: string }[]>`
          SELECT DISTINCT event_path FROM event_observer_requests
        `;
        assert.deepEqual(storedPaths.map(r => r.event_path).sort(), [
          '/new_block',
          '/new_burn_block',
          '/new_microblocks',
        ]);

        // Chain tip is the last block in the fixture and anchored tx counts match the txs table.
        const chainTip = await db.getChainTip(client);
        assert.equal(chainTip.block_height, 47);
        const [{ tx_count }] = await client<{ tx_count: number }[]>`
          SELECT COUNT(*)::int AS tx_count FROM txs
          WHERE canonical = true AND microblock_canonical = true
        `;
        assert.equal(chainTip.tx_count, tx_count);

        // The fork loser at height 45 re-mined the microblock tx as an anchor tx, but the canonical
        // row is still the first block's, with the payload's microblock fields passed through.
        const txResult = await supertest(api.server).get(`/extended/v1/tx/${lostTx}`);
        assert.equal(txResult.status, 200);
        const txBody: Transaction = txResult.body;
        assert.equal(txBody.tx_id, lostTx);
        assert.equal(txBody.canonical, true);
        assert.equal(txBody.microblock_canonical, true);
        assert.equal(txBody.is_unanchored, false);
        assert.equal(txBody.tx_status, 'success');
        assert.equal(txBody.events.length, 1);
        assert.equal(txBody.block_hash, canonicalBlockHash);
        assert.equal(txBody.block_height, canonicalBlockHeight);
        assert.equal(txBody.microblock_hash, canonicalMicroblockHash);
        assert.equal(txBody.microblock_sequence, 0);
        assert.equal(txBody.tx_index, 2);

        // Block 30: the whole microblock stream is attributed to the confirming anchor block, and
        // the block-level microblock metadata (backed by the unused `microblocks` table) is empty.
        const blockResult = await supertest(api.server).get(`/extended/v1/block/by_height/30`);
        assert.equal(blockResult.status, 200);
        const block: Block = blockResult.body;
        assert.equal(block.canonical, true);
        // The anchor block's own coinbase tx plus the confirmed microblock stream.
        assert.equal(block.txs.length, block30MicroblockTxs.length + 1);
        assert.deepEqual(block.microblocks_accepted, []);
        assert.deepEqual(block.microblocks_streamed, []);
        assert.deepEqual(block.microblock_tx_count, {});
        for (const expected of block30MicroblockTxs) {
          const fullTxId = block.txs.find(id => id.startsWith(expected.txId));
          assert.ok(fullTxId, `tx ${expected.txId} missing from block 30`);
          const rows = await client<
            {
              canonical: boolean;
              microblock_canonical: boolean;
              block_height: number;
              tx_index: number;
              microblock_sequence: number;
              microblock_hash: string;
              block_hash: string;
              index_block_hash: string;
            }[]
          >`
            SELECT canonical, microblock_canonical, block_height, tx_index, microblock_sequence,
              microblock_hash, block_hash, index_block_hash
            FROM txs WHERE tx_id = ${fullTxId}
            ORDER BY canonical DESC
          `;
          // One canonical row for the winning block 30 plus one non-canonical row for the fork.
          assert.equal(rows.length, 2);
          assert.deepEqual(
            rows.map(r => r.canonical),
            [true, false]
          );
          for (const row of rows) {
            assert.equal(row.microblock_canonical, true);
            assert.equal(row.block_height, 30);
            assert.equal(row.tx_index, expected.txIndex);
            assert.equal(row.microblock_sequence, expected.microblockSequence);
            assert.ok(
              row.microblock_hash.startsWith(expected.microblockHash),
              `unexpected microblock_hash ${row.microblock_hash}`
            );
          }
          assert.equal(rows[0].block_hash, block.hash);
        }
      }
    );
  });
});
