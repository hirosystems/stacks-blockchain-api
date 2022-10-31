import { ChainID } from '@stacks/transactions';
import * as fs from 'fs';
import { PgSqlClient } from 'src/datastore/connection';
import { getRawEventRequests } from 'src/datastore/event-requests';
import { cycleMigrations, runMigrations } from 'src/datastore/migrations';
import { PgWriteStore } from 'src/datastore/pg-write-store';
import { startEventServer } from 'src/event-stream/event-server';
import { httpPostRequest } from 'src/helpers';
import { useWithCleanup } from 'src/tests/test-helpers';
import { findBnsGenesisBlockData, findTsvBlockHeight } from '../event-replay/helpers';
import { PgSqlClient } from 'src/datastore/connection';
import { cycleMigrations, runMigrations } from 'src/datastore/migrations';
import { PgWriteStore } from 'src/datastore/pg-write-store';
import { EventStreamServer, startEventServer } from 'src/event-stream/event-server';
import { httpPostRequest } from 'src/helpers';
import { ReverseFileStream } from '../event-replay/reverse-file-stream';
import { ChainID } from '@stacks/transactions';

describe('helper tests', () => {
  function writeTmpFile(fileName: string, contents: string): string {
    try {
      fs.mkdirSync('./.tmp');
    } catch (error: any) {
      if (error.code != 'EEXIST') throw error;
    }
    const path = `./.tmp/${fileName}`;
    fs.writeFileSync(path, contents, { encoding: 'utf-8' });
    return path;
  }

  test('ReverseFileStream handles backpressure', async () => {
    let contents = '';
    for (let i = 1; i <= 1000; i++) {
      contents += `line${i}\n`;
    }
    const testFilePath = writeTmpFile('test1.txt', contents);
    try {
      // Default stream buffer is 64KB, set to 300 bytes so file is larger than memory buffer
      const reverseStream = new ReverseFileStream(testFilePath, { highWaterMark: 300 });
      const output: string[] = [];
      let linesStreamed = 0;
      for await (const data of reverseStream) {
        linesStreamed++;
        output.push(data);
        if (linesStreamed === 4) {
          break;
        }
      }
      expect(linesStreamed).toEqual(4);
      expect(output).toEqual(['line1000', 'line999', 'line998', 'line997']);
      expect(reverseStream.bytesRead).toBeLessThan(reverseStream.fileLength);

      // Read whole file
      const reverseStream2 = new ReverseFileStream(testFilePath, { highWaterMark: 300 });
      const output2: string[] = [];
      let linesStreamed2 = 0;
      for await (const data of reverseStream2) {
        linesStreamed2++;
        output2.push(data);
      }
      expect(linesStreamed2).toEqual(1000);
      expect(output2[0]).toBe('line1000');
      expect(output2[output2.length - 1]).toBe('line1');
      expect(reverseStream2.bytesRead).toBe(reverseStream2.fileLength);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('ReverseFileStream streams file in reverse', async () => {
    const contents = `line1
line2
line3
line4`;
    const testFilePath = writeTmpFile('test1.txt', contents);
    try {
      const reverseStream = new ReverseFileStream(testFilePath);
      const output: string[] = [];
      let linesStreamed = 0;
      for await (const data of reverseStream) {
        linesStreamed++;
        output.push(data);
      }
      expect(linesStreamed).toEqual(4);
      expect(output).toEqual(['line4', 'line3', 'line2', 'line1']);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('ReverseFileStream streams file in reverse', async () => {
    const contents = ['line1', 'line2', 'line3', 'line4'].join('\r\n');
    const testFilePath = writeTmpFile('test1.txt', contents);
    try {
      const reverseStream = new ReverseFileStream(testFilePath);
      const output: string[] = [];
      let linesStreamed = 0;
      for await (const data of reverseStream) {
        linesStreamed++;
        output.push(data);
      }
      expect(linesStreamed).toEqual(4);
      expect(output).toEqual(['line4', 'line3', 'line2', 'line1']);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('TSV block height is found', async () => {
    const contents = `744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_block\t{"block_height": 1200}
744275\t2022-02-21 16:07:01.123587+00\t/new_block\t{"block_height": 1201}
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]`;
    const testFilePath = writeTmpFile('test1.tsv', contents);
    try {
      const blockHeight = await findTsvBlockHeight(testFilePath);
      expect(blockHeight).toEqual(1201);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('TSV block height is 0 if not found', async () => {
    const contents = `744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]`;
    const testFilePath = writeTmpFile('test1.tsv', contents);
    try {
      const blockHeight = await findTsvBlockHeight(testFilePath);
      expect(blockHeight).toEqual(0);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('BNS genesis block data is found', async () => {
    const genesisBlock = await findBnsGenesisBlockData('src/tests-event-replay/tsv/mainnet.tsv');
    expect(genesisBlock).toEqual({
      index_block_hash: '0x918697ef63f9d8bdf844c3312b299e72a231cde542f3173f7755bb8c1cdaf3a7',
      parent_index_block_hash: '0x55c9861be5cff984a20ce6d99d4aa65941412889bdc665094136429b84f8c2ee',
      microblock_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      microblock_sequence: 0,
      microblock_canonical: true,
      tx_id: '0x2f079994c9bd92b2272258b9de73e278824d76efe1b5a83a3b00941f9559de8a',
      tx_index: 7,
    });
  });
});

describe('IBD', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  const ibdRoutes = ['/new_burn_block', '/new_mempool_tx', '/drop_mempool_tx'];

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
  });

  afterEach(async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = undefined;
    await db?.close();
    await runMigrations(undefined, 'down');
  });

  test('IBD mode blocks certain API routes', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1000';
    const routesVisited = new Set();
    const ibdRoutes = ['/new_burn_block', '/new_mempool_tx', '/drop_mempool_tx'];

    await useWithCleanup(
      () => {
        const readStream = fs.createReadStream('src/tests-event-replay/tsv/mainnet.tsv');
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
          httpLogLevel: 'debug',
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async (rawEventsIterator, eventServer) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            routesVisited.add(rawEvent.event_path);
            const response = await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
            if (ibdRoutes.includes(rawEvent.event_path)) {
              expect(response.statusCode).toBe(200);
              expect(response.response).toBe('IBD mode active.');
            }
          }
        }
      }
    );
  });

  test('IBD mode does NOT block certain API routes once the threshold number of blocks are ingested', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1';

    const routesVisited = new Set();

    await useWithCleanup(
      () => {
        const readStream = fs.createReadStream('src/tests-event-replay/tsv/mainnet.tsv');
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
          httpLogLevel: 'debug',
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async (rawEventsIterator, eventServer) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            routesVisited.add(rawEvent.event_path);
            const response = await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
            if (ibdRoutes.includes(rawEvent.event_path)) {
              const chainTip = await db.getChainTip(client, false);
              const ibdThreshold = Number.parseInt(process.env.IBD_MODE_UNTIL_BLOCK as string);
              if (chainTip.blockHeight < ibdThreshold) {
                expect(response.statusCode).toBe(200);
                expect(response.response).toBe('IBD mode active.');
              } else {
                expect(response.statusCode).toBe(200);
                expect(response.response).not.toBe('IBD mode active.');
              }
            }
          }
        }
      }
    );
  });

  test('IBD mode prevents refreshing materialized views', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1000';
    const result = await db.refreshMaterializedView('fizzbuzz', client);
    expect(result).toBe(undefined);
  });
});
