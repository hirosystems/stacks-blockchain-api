import * as readline from 'node:readline/promises';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as assert from 'node:assert/strict';

import { ChainID } from '@stacks/transactions';
import { ApiServer, startApiServer } from '../../src/api/init';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { onceWhen, PgSqlClient } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';
import { SnpEventStreamHandler } from '../../src/event-stream/snp-event-stream';
import { fetch } from 'undici';
import * as supertest from 'supertest';

describe('SNP integration tests', () => {
  let snpObserverUrl: string;
  let db: PgWriteStore;
  let client: PgSqlClient;
  let eventServer: EventStreamServer;
  let apiServer: ApiServer;

  const sampleEventsLastMsgId = '238-0';
  const sampleEventsLastBlockHeight = 50;
  const sampleEventsLastBlockHash =
    '0x5705546ec6741f77957bb3e73bf795dcf120c0a869c1d408396e7e30a3b2f94f';

  beforeAll(async () => {
    snpObserverUrl = process.env['SNP_OBSERVER_URL'] as string;

    await migrate('up');

    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;

    eventServer = await startEventServer({
      datastore: db,
      chainId: ChainID.Mainnet,
      serverHost: '127.0.0.1',
      serverPort: 0,
    });
    apiServer = await startApiServer({
      datastore: db,
      chainId: ChainID.Mainnet,
    });
  });

  afterAll(async () => {
    await apiServer.terminate();
    await eventServer.closeAsync();
    await db?.close();
    await migrate('down');
  });

  test('populate SNP server data', async () => {
    const payloadDumpFile = './tests/snp/dumps/epoch-3-transition.tsv.gz';
    // const payloadDumpFile = './tests/snp/dumps/stackerdb-sample-events.tsv.gz';
    const rl = readline.createInterface({
      input: fs.createReadStream(payloadDumpFile).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const [_id, timestamp, path, payload] = line.split('\t');
      // use fetch to POST the payload to the SNP event observer server
      try {
        const res = await fetch(snpObserverUrl + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Original-Timestamp': timestamp },
          body: payload,
        });
        if (res.status !== 200) {
          throw new Error(`Failed to POST event: ${path} - ${payload.slice(0, 100)}`);
        }
      } catch (error) {
        console.error(`Error posting event: ${error}`, error);
        throw error;
      }
    }
    rl.close();
  });

  test('ingest SNP events', async () => {
    const lastMsgId = await db.getLastIngestedSnpRedisMsgId();
    expect(lastMsgId).toBe('0');
    const snpClient = new SnpEventStreamHandler({
      db,
      eventServer,
      lastMessageId: lastMsgId,
    });

    await snpClient.start();

    // wait for last msgID to be processed
    const [{ msgId: lastMsgProcessed }] = await onceWhen(
      snpClient.events,
      'processedMessage',
      ({ msgId }) => {
        return msgId === sampleEventsLastMsgId;
      }
    );

    expect(lastMsgProcessed).toBe(sampleEventsLastMsgId);

    await snpClient.stop();
  });

  test('validate all events ingested', async () => {
    const finalPostgresMsgId = await db.getLastIngestedSnpRedisMsgId();
    expect(finalPostgresMsgId).toBe(sampleEventsLastMsgId);
  });

  test('validate blocks ingested', async () => {
    const chainTip = await db.getCurrentBlockHeight();
    assert(chainTip.found);
    expect(chainTip.result).toBe(sampleEventsLastBlockHeight);
  });

  test('test block API fetch', async () => {
    const response = await supertest(apiServer.server)
      .get(`/extended/v1/block/by_height/${sampleEventsLastBlockHeight}`)
      .expect(200);
    expect(response.body).toMatchObject({
      hash: sampleEventsLastBlockHash,
    });
  });
});
