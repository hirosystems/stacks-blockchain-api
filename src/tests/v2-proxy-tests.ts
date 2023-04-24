import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer } from '../api/init';
import { PoolClient } from 'pg';
import { useWithCleanup, withEnvVars } from './test-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as nock from 'nock';
import { DbBlock } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';

describe('v2-proxy tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  test('tx post multicast', async () => {
    const primaryProxyEndpoint = 'proxy-stacks-node:12345';
    const extraTxEndpoint = 'http://extra-tx-endpoint-a/test';
    await useWithCleanup(
      () => {
        const restoreEnvVars = withEnvVars(
          ['STACKS_CORE_PROXY_HOST', primaryProxyEndpoint.split(':')[0]],
          ['STACKS_CORE_PROXY_PORT', primaryProxyEndpoint.split(':')[1]]
        );
        return [, () => restoreEnvVars()] as const;
      },
      () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacks-api-unit-test-'));
        const extraEndpointsFilePath = path.join(tempDir, 'extra-tx-endpoints.txt');
        fs.writeFileSync(extraEndpointsFilePath, extraTxEndpoint, { flag: 'w' });
        const restoreEnvVars = withEnvVars([
          'STACKS_API_EXTRA_TX_ENDPOINTS_FILE',
          extraEndpointsFilePath,
        ]);
        return [, () => restoreEnvVars()] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: ChainID.Mainnet,
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, __, api) => {
        const block1: DbBlock = {
          block_hash: '0x11',
          index_block_hash: '0xaa',
          parent_index_block_hash: '0x00',
          parent_block_hash: '0x00',
          parent_microblock_hash: '',
          block_height: 1,
          burn_block_time: 1234,
          burn_block_hash: '0x1234',
          burn_block_height: 123,
          miner_txid: '0x4321',
          canonical: true,
          parent_microblock_sequence: 0,
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        };

        // Ensure db has a block so that current block height queries return a found result
        await db.update({
          block: block1,
          microblocks: [],
          minerRewards: [],
          txs: [],
        });

        const primaryStubbedResponse =
          '"1659fcdc9167576eb1f2a05d0aaba5ca1aa1943892e7e6e5d3ccb3e537f1c870"';
        const extraStubbedResponse = 'extra success stubbed response';
        const testRequest = 'fake-tx-data';
        let mockedRequestBody = 'none';
        nock(`http://${primaryProxyEndpoint}`)
          .post('/v2/transactions', testRequest)
          .once()
          .reply(200, primaryStubbedResponse);
        nock(extraTxEndpoint)
          .post(() => true, testRequest)
          .once()
          .reply(200, (_url, body, cb) => {
            // the "extra" endpoint responses are logged internally and not sent back to the client, so use this mock callback to
            // test that this endpoint was called correctly
            mockedRequestBody = body as string;
            cb(null, extraStubbedResponse);
          });
        const postTxReq = await supertest(api.server).post(`/v2/transactions`).send(testRequest);
        // test that main endpoint response was returned
        expect(postTxReq.status).toBe(200);
        expect(postTxReq.text).toBe(primaryStubbedResponse);
        // test that the extra endpoint was queried
        expect(mockedRequestBody).toBe(testRequest);
      }
    );
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
