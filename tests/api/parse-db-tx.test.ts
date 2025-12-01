import { migrate } from '../utils/test-helpers';
import { importEventsFromTsv } from '../../src/event-replay/event-replay';
import { decodeClarityValueList } from '@hirosystems/stacks-encoding-native-js';
import * as fs from 'fs';
import * as readline from 'readline';
import { PgSqlClient, timeout } from '@hirosystems/api-toolkit';
import { ChainID } from '@stacks/common';
import { ApiServer, startApiServer } from '../../src/api/init';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server';
import { httpPostRequest } from '../../src/helpers';

describe('transaction parsing', () => {
  test('buggy parsing of contract-call args', () => {
    // Contract-call args from tx 0xb066874942e97d6e7ecfedb999a788edf7fbdbe51ab4b172ea05e8ede9b0ae9c
    const contractCallArgsWithEmptyList =
      '000000030c00000007066865696768740100000000000000000000000000005cc20b6d65726b6c652d726f6f7402000000201302a1b1fa53c11ac01ce480937dcd1ef550b4799070878e20b3b97bb99b58ec056e62697473020000000424961417056e6f6e6365020000000434a32a2106706172656e740200000020d0c9ebf9784f0670eb9bfac963114a02cff58bdc2669000000000000000000000974696d657374616d70020000000452b003610776657273696f6e0200000004040000200c0000000403696e730b000000010c00000003086f7574706f696e740c0000000204686173680200000020e85fb1e809db705121d92f3ec7f9ea4bafd065a8651408f507223efa8ede146605696e64657802000000040300000009736372697074536967020000006b48304502210096638a2336c383a99b009025534ae00f0bb689888c3898e6723497324c92806802205a3eee656775961780676f48f2fc1514142cadcd49efe1893d75517ab47a7f620121022a0160b2ed13b803ddca6f6f04606f56dfadee571d683725c7a58d0ed199de790873657175656e63650200000004fdffffff086c6f636b74696d65020000000400000000046f7574730b000000000776657273696f6e0200000004010000000c00000003066861736865730b000000000a747265652d646570746801000000000000000000000000000000080874782d696e64657801ffffffffffffffffffffffffffffffff';
    const fnArgs = Buffer.from(contractCallArgsWithEmptyList, 'hex');
    const clarityVals = decodeClarityValueList(fnArgs);
    clarityVals.map(c => {
      expect(c.hex).not.toBe('');
    });
  });

  describe('fuzzed tsvs', () => {
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
      api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

      // set chainId env, because TSV import reads it manually
      process.env['STACKS_CHAIN_ID'] = ChainID.Testnet.toString();
    });

    afterEach(async () => {
      await api.terminate();
      await db?.close();
      await migrate('down');
    });

    test('parse fuzzed transactions', async () => {
      const eventServer = await startEventServer({
        datastore: db,
        chainId: ChainID.Testnet,
        serverHost: '127.0.0.1',
        serverPort: 0,
      });

      const readStream = readline.createInterface({
        input: fs.createReadStream('tests/api/tsv/fuzzed-transactions-1.tsv', { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      for await (const line of readStream) {
        const [id, timestamp, eventPath, payload] = line.split('\t');
        await httpPostRequest({
          host: '127.0.0.1',
          port: eventServer.serverAddress.port,
          path: eventPath,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(payload, 'utf8'),
          throwOnNotOK: true,
        });
      }

      await eventServer.closeAsync();
    });
  });
});
