import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer } from '../../src/api/init';
import { useWithCleanup, withEnvVars } from './test-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as nock from 'nock';
import { DbBlock } from '../../src/datastore/common';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { migrate } from '../utils/test-helpers';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

describe('v2-proxy tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db?.close();
    await migrate('down');
  });

  test('tx fee estimation', async () => {
    const primaryProxyEndpoint = 'proxy-stacks-node:12345';
    const feeEstimationModifier = 0.5;
    await useWithCleanup(
      () => {
        const restoreEnvVars = withEnvVars(
          ['STACKS_CORE_FEE_ESTIMATION_MODIFIER', feeEstimationModifier.toString()],
          ['STACKS_CORE_PROXY_HOST', primaryProxyEndpoint.split(':')[0]],
          ['STACKS_CORE_PROXY_PORT', primaryProxyEndpoint.split(':')[1]]
        );
        return [, () => restoreEnvVars()] as const;
      },
      () => {
        const agent = new MockAgent();
        const originalAgent = getGlobalDispatcher();
        setGlobalDispatcher(agent);
        return [agent, () => setGlobalDispatcher(originalAgent)] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: ChainID.Mainnet,
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, mockAgent, api) => {
        const primaryStubbedResponse = {
          cost_scalar_change_by_byte: 0.00476837158203125,
          estimated_cost: {
            read_count: 19,
            read_length: 4814,
            runtime: 7175000,
            write_count: 2,
            write_length: 1020,
          },
          estimated_cost_scalar: 14,
          estimations: [
            {
              fee: 400,
              fee_rate: 1.2410714285714286,
            },
            {
              fee: 800,
              fee_rate: 8.958333333333332,
            },
            {
              fee: 1000,
              fee_rate: 10,
            },
          ],
        };
        const testRequest = {
          estimated_len: 350,
          transaction_payload:
            '021af942874ce525e87f21bbe8c121b12fac831d02f4086765742d696e666f0b7570646174652d696e666f00000000',
        };

        mockAgent
          .get(`http://${primaryProxyEndpoint}`)
          .intercept({
            path: '/v2/fees/transaction',
            method: 'POST',
          })
          .reply(200, JSON.stringify(primaryStubbedResponse), {
            headers: { 'Content-Type': 'application/json' },
          });

        const postTxReq = await supertest(api.server)
          .post(`/v2/fees/transaction`)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(testRequest));
        expect(postTxReq.status).toBe(200);
        // Expected min fee is the byte size because MINIMUM_TX_FEE_RATE_PER_BYTE=1
        const expectedMinFee = Math.max(
          testRequest.estimated_len ?? 0,
          testRequest.transaction_payload.length / 2
        );
        const expectedResponse = {
          ...primaryStubbedResponse,
        };
        expectedResponse.estimations = expectedResponse.estimations.map(est => ({
          ...est,
          fee: Math.max(expectedMinFee, Math.round(est.fee * feeEstimationModifier)),
        }));
        expect(postTxReq.body).toEqual(expectedResponse);
      }
    );
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
          tenure_height: 1,
          block_time: 1234,
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
          tx_count: 1,
          signer_bitvec: null,
          signer_signatures: null,
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
        const postTxReq = await supertest(api.server)
          .post(`/v2/transactions`)
          .set('Content-Type', 'application/octet-stream')
          .send(testRequest);
        // test that main endpoint response was returned
        expect(postTxReq.status).toBe(200);
        expect(postTxReq.text).toBe(primaryStubbedResponse);
        // test that the extra endpoint was queried
        expect(mockedRequestBody).toBe(testRequest);
      }
    );
  });
});
