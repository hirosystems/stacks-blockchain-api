import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { useWithCleanup, withEnvVars } from './test-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as nock from 'nock';

describe('v2-proxy tests', () => {
  let db: PgDataStore;
  let client: PoolClient;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
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
          httpLogLevel: 'debug',
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, __, api) => {
        const primaryStubbedResponse = 'success stubbed response';
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
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
