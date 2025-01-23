import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer } from '../../src/api/init';
import { useWithCleanup, withEnvVars } from './test-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as nock from 'nock';
import { DbBlock, DbTxTypeId } from '../../src/datastore/common';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { migrate } from '../utils/test-helpers';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { TestBlockBuilder } from '../utils/test-builders';

describe('v2-proxy tests', () => {
  let db: PgWriteStore;
  const epochLimits = {
    write_length: 15000000,
    write_count: 15000,
    read_length: 100000000,
    read_count: 15000,
    runtime: 5000000000,
  };

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    // Set Stacks node tenure limits.
    nock('http://127.0.0.1:20443')
      .get('/v2/pox')
      .reply(200, {
        epochs: [
          {
            epoch_id: 'Epoch31',
            start_height: 0,
            end_height: 200000,
            block_limit: epochLimits,
            network_epoch: 12,
          },
        ],
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
          ['STACKS_CORE_FEE_ESTIMATOR_ENABLED', '1'],
          ['STACKS_CORE_FEE_ESTIMATION_MODIFIER', feeEstimationModifier.toString()],
          ['STACKS_CORE_PROXY_HOST', primaryProxyEndpoint.split(':')[0]],
          ['STACKS_CORE_PROXY_PORT', primaryProxyEndpoint.split(':')[1]],
          ['STACKS_CORE_FEE_PAST_TENURE_FULLNESS_WINDOW', '5'],
          ['STACKS_CORE_FEE_PAST_DIMENSION_FULLNESS_THRESHOLD', '0.9'],
          ['STACKS_CORE_FEE_CURRENT_DIMENSION_FULLNESS_THRESHOLD', '0.5'],
          ['STACKS_CORE_FEE_CURRENT_BLOCK_COUNT_MINIMUM', '5']
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
        // Stub responses.
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
        const expectedMinFee = Math.max(
          testRequest.estimated_len ?? 0,
          testRequest.transaction_payload.length / 2
        );
        const expectedMinResponse = {
          ...primaryStubbedResponse,
        };
        expectedMinResponse.estimations = expectedMinResponse.estimations.map(est => ({
          ...est,
          fee: expectedMinFee,
        }));
        const expectedModifiedResponse = {
          ...primaryStubbedResponse,
        };
        expectedModifiedResponse.estimations = expectedModifiedResponse.estimations.map(est => ({
          ...est,
          fee: Math.max(expectedMinFee, Math.round(est.fee * feeEstimationModifier)),
        }));
        mockAgent
          .get(`http://${primaryProxyEndpoint}`)
          .intercept({
            path: '/v2/fees/transaction',
            method: 'POST',
          })
          .reply(200, JSON.stringify(primaryStubbedResponse), {
            headers: { 'Content-Type': 'application/json' },
          })
          .persist();

        // Creates tenures with total cost per tenure divided into its blocks.
        const writeTenures = async (
          count: number,
          blocksPerTenure: number,
          currentHeight: number,
          cost: {
            execution_cost_read_count?: number;
            execution_cost_read_length?: number;
            execution_cost_runtime?: number;
            execution_cost_write_count?: number;
            execution_cost_write_length?: number;
            tx_total_size?: number;
          }
        ) => {
          let block_height = currentHeight;
          for (let t = 0; t < count; t++) {
            for (let b = 0; b < blocksPerTenure; b++) {
              block_height++;
              const block = new TestBlockBuilder({
                block_height,
                index_block_hash: `0x${block_height.toString(16).padStart(6, '0')}`,
                parent_index_block_hash: `0x${(block_height - 1).toString(16).padStart(6, '0')}`,
                execution_cost_read_count: Math.round(
                  (cost.execution_cost_read_count ?? 0) / blocksPerTenure
                ),
                execution_cost_read_length: Math.round(
                  (cost.execution_cost_read_length ?? 0) / blocksPerTenure
                ),
                execution_cost_runtime: Math.round(
                  (cost.execution_cost_runtime ?? 0) / blocksPerTenure
                ),
                execution_cost_write_count: Math.round(
                  (cost.execution_cost_write_count ?? 0) / blocksPerTenure
                ),
                execution_cost_write_length: Math.round(
                  (cost.execution_cost_write_length ?? 0) / blocksPerTenure
                ),
                tx_total_size: Math.round((cost.tx_total_size ?? 0) / blocksPerTenure),
              });
              if (b == 0) {
                block.addTx({
                  type_id: DbTxTypeId.TenureChange,
                  tenure_change_burn_view_consensus_hash: '0x01',
                  tenure_change_cause: 0,
                  tenure_change_prev_tenure_consensus_hash: '0x00',
                  tenure_change_previous_tenure_blocks: 0,
                  tenure_change_previous_tenure_end: '0x00',
                  tenure_change_pubkey_hash: '0x01',
                  tenure_change_tenure_consensus_hash: '0x01',
                });
              }
              await db.update(block.build());
            }
          }
          return block_height;
        };
        await db.update(new TestBlockBuilder({ block_height: 0, block_hash: '0x00' }).build());
        let block_height = 0;

        // TEST 1 ==> Past tenures are empty, including the current tenure. Fee returned is the
        // minimum.
        block_height = await writeTenures(7, 10, block_height, {});
        let postTxReq = await supertest(api.server)
          .post(`/v2/fees/transaction`)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(testRequest));
        expect(postTxReq.status).toBe(200);
        expect(postTxReq.body).toEqual(expectedMinResponse);

        // TEST 2 ==> New tenure gets a cost spike above 50%, so we start looking at the moving cost
        // average of latest tenures. Since they're empty, though, we also get minimum fees.
        block_height = await writeTenures(1, 10, block_height, {
          execution_cost_read_count: epochLimits.read_count * 0.6,
        });
        postTxReq = await supertest(api.server)
          .post(`/v2/fees/transaction`)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(testRequest));
        expect(postTxReq.status).toBe(200);
        expect(postTxReq.body).toEqual(expectedMinResponse);

        // TEST 3 ==> New tenures consistently get usage around 70%, which is not enough to be
        // considered full. We still get minimum fees.
        block_height = await writeTenures(7, 10, block_height, {
          execution_cost_runtime: epochLimits.runtime * 0.7,
        });
        postTxReq = await supertest(api.server)
          .post(`/v2/fees/transaction`)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(testRequest));
        expect(postTxReq.status).toBe(200);
        expect(postTxReq.body).toEqual(expectedMinResponse);

        // TEST 4 ==> Tenures are now completely full. We go back to Stacks core's fee estimation
        // with our multiplier.
        block_height = await writeTenures(7, 10, block_height, {
          execution_cost_runtime: epochLimits.runtime * 0.95,
          tx_total_size: 2 * 1024 * 1024,
        });
        postTxReq = await supertest(api.server)
          .post(`/v2/fees/transaction`)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(testRequest));
        expect(postTxReq.status).toBe(200);
        expect(postTxReq.body).toEqual(expectedModifiedResponse);

        // TEST 5 ==> New tenure comes by which confirms the rest of pending transactions and goes
        // back to empty. We immediately return to minimum fees.
        block_height = await writeTenures(1, 10, block_height, {
          execution_cost_read_count: epochLimits.read_count * 0.1,
        });
        postTxReq = await supertest(api.server)
          .post(`/v2/fees/transaction`)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(testRequest));
        expect(postTxReq.status).toBe(200);
        expect(postTxReq.body).toEqual(expectedMinResponse);
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
          tx_total_size: 1,
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
