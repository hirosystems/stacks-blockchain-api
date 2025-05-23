import * as supertest from 'supertest';
import { bufferCVFromString, ChainID, serializeCV } from '@stacks/transactions';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbEventTypeId,
  DbSmartContract,
  DbSmartContractEvent,
} from '../../src/datastore/common';
import { startApiServer, ApiServer } from '../../src/api/init';
import { I32_MAX } from '../../src/helpers';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { bufferToHex, PgSqlClient, waiter } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';
import { TestBlockBuilder, testMempoolTx } from '../utils/test-builders';

describe('smart contract tests', () => {
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
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('list contract log events', async () => {
    const logEventWaiter = waiter<{ txId: string; eventIndex: number }>();
    const handler = (txId: string, eventIndex: number) =>
      logEventWaiter.finish({ txId, eventIndex });
    db.eventEmitter.addListener('smartContractLogUpdate', handler);

    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 1594647996,
      burn_block_time: 1594647996,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
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
    const tx1: DbTxRaw = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      block_time: 1594647995,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      vm_error: null,
    };
    const tx2: DbTxRaw = {
      ...tx1,
      tx_id: '0x012345',
      tx_index: 1,
    };
    const contractLogEvent1: DbSmartContractEvent = {
      event_index: 4,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block1.block_height,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: 'some-contract-id',
      topic: 'some-topic',
      value: bufferToHex(Buffer.from(serializeCV(bufferCVFromString('some val')))),
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block1.block_height,
      clarity_version: null,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [contractLogEvent1],
          smartContracts: [smartContract1],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: tx2,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const logEvent = await logEventWaiter;
    expect(logEvent.txId).toBe('0x421234');
    expect(logEvent.eventIndex).toBe(4);

    const fetchTx = await supertest(api.server).get(
      '/extended/v1/contract/some-contract-id/events'
    );
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual({
      limit: 20,
      offset: 0,
      results: [
        {
          event_index: 4,
          event_type: 'smart_contract_log',
          tx_id: '0x421234',
          contract_log: {
            contract_id: 'some-contract-id',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '0x736f6d652076616c' },
          },
        },
      ],
    });

    db.eventEmitter.removeListener('smartContractLogUpdate', handler);
  });

  test('get contract by ID', async () => {
    const contractWaiter = waiter<string>();
    const handler = (contractId: string) => contractWaiter.finish(contractId);
    db.eventEmitter.addListener('smartContractUpdate', handler);

    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 1594647996,
      burn_block_time: 1594647996,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
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
    const txId1 = '0x421234';
    const smartContract1: DbSmartContract = {
      tx_id: txId1,
      canonical: true,
      block_height: block1.block_height,
      clarity_version: null,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    const tx1: DbTxRaw = {
      tx_id: txId1,
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      block_time: 1594647995,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.SmartContract,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      smart_contract_contract_id: smartContract1.contract_id,
      smart_contract_source_code: smartContract1.source_code,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      vm_error: null,
    };

    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [smartContract1],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const reportedId = await contractWaiter;
    expect(reportedId).toBe('some-contract-id');

    const fetchTx = await supertest(api.server).get('/extended/v1/contract/some-contract-id');
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual({
      tx_id: '0x421234',
      canonical: true,
      clarity_version: null,
      contract_id: 'some-contract-id',
      block_height: 1,
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    });

    db.eventEmitter.removeListener('smartContractUpdate', handler);
  });

  test('get versioned-contract by ID', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 1594647996,
      burn_block_time: 1594647996,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
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
    const txId1 = '0x421234';
    const smartContract1: DbSmartContract = {
      tx_id: txId1,
      canonical: true,
      block_height: block1.block_height,
      clarity_version: 2,
      contract_id: 'some-versioned-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    const tx1: DbTxRaw = {
      tx_id: txId1,
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      block_time: 1594647995,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.VersionedSmartContract,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      smart_contract_clarity_version: smartContract1.clarity_version ?? undefined,
      smart_contract_contract_id: smartContract1.contract_id,
      smart_contract_source_code: smartContract1.source_code,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      vm_error: null,
    };

    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [smartContract1],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const fetchTx = await supertest(api.server).get(
      '/extended/v1/contract/some-versioned-contract-id'
    );
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual({
      tx_id: '0x421234',
      canonical: true,
      clarity_version: 2,
      contract_id: 'some-versioned-contract-id',
      block_height: 1,
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    });
  });

  test('list contract with given trait', async () => {
    const block1: DbBlock = {
      block_hash: '0x1235',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x01',
      parent_block_hash: '0xff0012',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 1594647996,
      burn_block_time: 1594647996,
      burn_block_hash: '0x1235',
      burn_block_height: 123,
      miner_txid: '0x4322',
      canonical: true,
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
    const tx1: DbTxRaw = {
      tx_id: '0x421235',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x1235',
      block_hash: '0x5679',
      block_height: block1.block_height,
      block_time: 1594647995,
      burn_block_height: block1.burn_block_height,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      vm_error: null,
    };
    const tx2: DbTxRaw = {
      ...tx1,
      tx_id: '0x012345',
      tx_index: 1,
    };
    const contractLogEvent1: DbSmartContractEvent = {
      event_index: 4,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block1.block_height,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: 'some-contract-id',
      topic: 'some-topic',
      value: bufferToHex(Buffer.from(serializeCV(bufferCVFromString('some val')))),
    };
    const contractJsonAbi = {
      maps: [],
      functions: [
        {
          args: [
            {
              name: 'code',
              type: 'uint128',
            },
          ],
          name: 'err-nft-mint',
          access: 'private',
          outputs: {
            type: {
              response: {
                ok: 'none',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'code',
              type: 'uint128',
            },
          ],
          name: 'err-nft-transfer',
          access: 'private',
          outputs: {
            type: {
              response: {
                ok: 'none',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'code',
              type: 'int128',
            },
          ],
          name: 'err-pox-stack-aggregation-commit',
          access: 'private',
          outputs: {
            type: {
              response: {
                ok: 'none',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'code',
              type: 'uint128',
            },
          ],
          name: 'err-stx-transfer',
          access: 'private',
          outputs: {
            type: {
              response: {
                ok: 'none',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'stack-result',
              type: {
                response: {
                  ok: {
                    tuple: [
                      {
                        name: 'lock-amount',
                        type: 'uint128',
                      },
                      {
                        name: 'stacker',
                        type: 'principal',
                      },
                      {
                        name: 'unlock-burn-height',
                        type: 'uint128',
                      },
                    ],
                  },
                  error: {
                    tuple: [
                      {
                        name: 'code',
                        type: 'uint128',
                      },
                      {
                        name: 'kind',
                        type: {
                          'string-ascii': {
                            length: 32,
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            {
              name: 'total',
              type: 'uint128',
            },
          ],
          name: 'get-total',
          access: 'private',
          outputs: {
            type: 'uint128',
          },
        },
        {
          args: [
            {
              name: 'stacker',
              type: 'principal',
            },
            {
              name: 'amount-ustx',
              type: 'uint128',
            },
            {
              name: 'until-burn-ht',
              type: {
                optional: 'uint128',
              },
            },
          ],
          name: 'mint-and-delegatedly-stack',
          access: 'private',
          outputs: {
            type: {
              response: {
                ok: {
                  tuple: [
                    {
                      name: 'id',
                      type: 'uint128',
                    },
                    {
                      name: 'pox',
                      type: {
                        tuple: [
                          {
                            name: 'lock-amount',
                            type: 'uint128',
                          },
                          {
                            name: 'stacker',
                            type: 'principal',
                          },
                          {
                            name: 'unlock-burn-height',
                            type: 'uint128',
                          },
                        ],
                      },
                    },
                  ],
                },
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'nft-id',
              type: 'uint128',
            },
            {
              name: 'ctx',
              type: {
                tuple: [
                  {
                    name: 'pay-stacks-tip',
                    type: 'uint128',
                  },
                  {
                    name: 'result',
                    type: {
                      list: {
                        type: {
                          response: {
                            ok: 'bool',
                            error: 'uint128',
                          },
                        },
                        length: 750,
                      },
                    },
                  },
                  {
                    name: 'reward-ustx',
                    type: 'uint128',
                  },
                  {
                    name: 'stx-from',
                    type: 'principal',
                  },
                  {
                    name: 'total-ustx',
                    type: 'uint128',
                  },
                ],
              },
            },
          ],
          name: 'payout-nft',
          access: 'private',
          outputs: {
            type: {
              tuple: [
                {
                  name: 'pay-stacks-tip',
                  type: 'uint128',
                },
                {
                  name: 'result',
                  type: {
                    list: {
                      type: {
                        response: {
                          ok: 'bool',
                          error: 'uint128',
                        },
                      },
                      length: 750,
                    },
                  },
                },
                {
                  name: 'reward-ustx',
                  type: 'uint128',
                },
                {
                  name: 'stx-from',
                  type: 'principal',
                },
                {
                  name: 'total-ustx',
                  type: 'uint128',
                },
              ],
            },
          },
        },
        {
          args: [
            {
              name: 'amount-ustx',
              type: 'uint128',
            },
            {
              name: 'until-burn-ht',
              type: {
                optional: 'uint128',
              },
            },
          ],
          name: 'pox-delegate-stx-and-stack',
          access: 'private',
          outputs: {
            type: {
              response: {
                ok: {
                  tuple: [
                    {
                      name: 'lock-amount',
                      type: 'uint128',
                    },
                    {
                      name: 'stacker',
                      type: 'principal',
                    },
                    {
                      name: 'unlock-burn-height',
                      type: 'uint128',
                    },
                  ],
                },
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'nft-id',
              type: 'uint128',
            },
            {
              name: 'total',
              type: 'uint128',
            },
          ],
          name: 'sum-stacked-ustx',
          access: 'private',
          outputs: {
            type: 'uint128',
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
            {
              name: 'stacked-ustx',
              type: 'uint128',
            },
          ],
          name: 'update-meta',
          access: 'private',
          outputs: {
            type: 'bool',
          },
        },
        {
          args: [
            {
              name: 'this-contract',
              type: 'principal',
            },
          ],
          name: 'allow-contract-caller',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: 'bool',
                error: 'int128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'amount-ustx',
              type: 'uint128',
            },
            {
              name: 'stacker',
              type: 'principal',
            },
            {
              name: 'until-burn-ht',
              type: {
                optional: 'uint128',
              },
            },
            {
              name: 'pox-addr',
              type: {
                optional: {
                  tuple: [
                    {
                      name: 'hashbytes',
                      type: {
                        buffer: {
                          length: 20,
                        },
                      },
                    },
                    {
                      name: 'version',
                      type: {
                        buffer: {
                          length: 1,
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
          name: 'delegate-stx',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: {
                  tuple: [
                    {
                      name: 'id',
                      type: 'uint128',
                    },
                    {
                      name: 'pox',
                      type: {
                        tuple: [
                          {
                            name: 'lock-amount',
                            type: 'uint128',
                          },
                          {
                            name: 'stacker',
                            type: 'principal',
                          },
                          {
                            name: 'unlock-burn-height',
                            type: 'uint128',
                          },
                        ],
                      },
                    },
                  ],
                },
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'reward-ustx',
              type: 'uint128',
            },
            {
              name: 'nfts',
              type: {
                list: {
                  type: 'uint128',
                  length: 750,
                },
              },
            },
            {
              name: 'pay-stacks-tip',
              type: 'uint128',
            },
          ],
          name: 'payout',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: {
                  tuple: [
                    {
                      name: 'pay-stacks-tip',
                      type: 'uint128',
                    },
                    {
                      name: 'result',
                      type: {
                        list: {
                          type: {
                            response: {
                              ok: 'bool',
                              error: 'uint128',
                            },
                          },
                          length: 750,
                        },
                      },
                    },
                    {
                      name: 'reward-ustx',
                      type: 'uint128',
                    },
                    {
                      name: 'stx-from',
                      type: 'principal',
                    },
                    {
                      name: 'total-ustx',
                      type: 'uint128',
                    },
                  ],
                },
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'reward-cycle',
              type: 'uint128',
            },
          ],
          name: 'stack-aggregation-commit',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: 'bool',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
            {
              name: 'sender',
              type: 'principal',
            },
            {
              name: 'recipient',
              type: 'principal',
            },
          ],
          name: 'transfer',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: 'bool',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'code',
              type: 'uint128',
            },
          ],
          name: 'get-errstr',
          access: 'read_only',
          outputs: {
            type: {
              'string-ascii': {
                length: 32,
              },
            },
          },
        },
        {
          args: [],
          name: 'get-last-token-id',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: 'uint128',
                error: 'none',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
          ],
          name: 'get-owner',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  optional: 'principal',
                },
                error: 'none',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
          ],
          name: 'get-owner-raw?',
          access: 'read_only',
          outputs: {
            type: {
              optional: 'principal',
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
          ],
          name: 'get-token-uri',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  optional: {
                    'string-ascii': {
                      length: 92,
                    },
                  },
                },
                error: 'none',
              },
            },
          },
        },
        {
          args: [],
          name: 'get-total-stacked',
          access: 'read_only',
          outputs: {
            type: 'uint128',
          },
        },
        {
          args: [
            {
              name: 'nfts',
              type: {
                list: {
                  type: 'uint128',
                  length: 750,
                },
              },
            },
          ],
          name: 'get-total-stacked-ustx',
          access: 'read_only',
          outputs: {
            type: 'uint128',
          },
        },
        {
          args: [
            {
              name: 'nfts',
              type: {
                list: {
                  type: 'uint128',
                  length: 750,
                },
              },
            },
            {
              name: 'stacks-tip',
              type: 'uint128',
            },
          ],
          name: 'get-total-stacked-ustx-at-block',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: 'uint128',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [],
          name: 'last-token-id-raw',
          access: 'read_only',
          outputs: {
            type: 'uint128',
          },
        },
        {
          args: [
            {
              name: 'nft-id',
              type: 'uint128',
            },
          ],
          name: 'nft-details',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  tuple: [
                    {
                      name: 'owner',
                      type: 'principal',
                    },
                    {
                      name: 'stacked-ustx',
                      type: 'uint128',
                    },
                  ],
                },
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'nft-id',
              type: 'uint128',
            },
            {
              name: 'stacks-tip',
              type: 'uint128',
            },
          ],
          name: 'nft-details-at-block',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  tuple: [
                    {
                      name: 'owner',
                      type: 'principal',
                    },
                    {
                      name: 'stacked-ustx',
                      type: 'uint128',
                    },
                  ],
                },
                error: 'uint128',
              },
            },
          },
        },
      ],
      variables: [
        {
          name: 'accnt',
          type: 'principal',
          access: 'constant',
        },
        {
          name: 'dplyr',
          type: 'principal',
          access: 'constant',
        },
        {
          name: 'err-amount-not-positive',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-commit-too-early',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-delegate-below-minimum',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-delegate-invalid-stacker',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-delegate-too-late',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-invalid-asset-id',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-invalid-stacks-tip',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-map-function-failed',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-nft-exists',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-nft-not-found',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-nft-not-owned',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-no-asset-owner',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-not-allowed-sender',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-not-enough-funds',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'err-sender-equals-recipient',
          type: {
            response: {
              ok: 'none',
              error: 'uint128',
            },
          },
          access: 'constant',
        },
        {
          name: 'minimum-amount',
          type: 'uint128',
          access: 'constant',
        },
        {
          name: 'px-addr',
          type: {
            tuple: [
              {
                name: 'hashbytes',
                type: {
                  buffer: {
                    length: 20,
                  },
                },
              },
              {
                name: 'version',
                type: {
                  buffer: {
                    length: 1,
                  },
                },
              },
            ],
          },
          access: 'constant',
        },
        {
          name: 'time-limit',
          type: 'uint128',
          access: 'constant',
        },
        {
          name: 'last-id',
          type: 'uint128',
          access: 'variable',
        },
        {
          name: 'start',
          type: {
            optional: 'uint128',
          },
          access: 'variable',
        },
        {
          name: 'total-stacked',
          type: 'uint128',
          access: 'variable',
        },
      ],
      fungible_tokens: [],
      non_fungible_tokens: [
        {
          name: 'b-12',
          type: 'uint128',
        },
      ],
    };
    const traitJsonAbiRequest = {
      maps: [],
      functions: [
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
            {
              name: 'sender',
              type: 'principal',
            },
            {
              name: 'recipient',
              type: 'principal',
            },
          ],
          name: 'transfer',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: 'bool',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [],
          name: 'get-last-token-id',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: 'uint128',
                error: 'none',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
          ],
          name: 'get-owner',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  optional: 'principal',
                },
                error: 'none',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
          ],
          name: 'get-token-uri',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  optional: {
                    'string-ascii': {
                      length: 92,
                    },
                  },
                },
                error: 'none',
              },
            },
          },
        },
      ],
      variables: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block1.block_height,
      clarity_version: null,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: JSON.stringify(contractJsonAbi),
    };
    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [contractLogEvent1],
          smartContracts: [smartContract1],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: tx2,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });
    const query = await supertest(api.server).get(
      `/extended/v1/contract/by_trait?trait_abi=${JSON.stringify(traitJsonAbiRequest)}`
    );
    expect(query.status).toBe(200);
    expect(JSON.parse(query.body.results[0].abi)).toStrictEqual(contractJsonAbi);

    const traitJsonAbiRequest1 = {
      maps: [],
      functions: [
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
            {
              name: 'sender',
              type: 'principal',
            },
            {
              name: 'recipient',
              type: 'principal',
            },
          ],
          name: 'wrong name',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: 'bool',
                error: 'uint128',
              },
            },
          },
        },
        {
          args: [],
          name: 'get-last-token-id',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: 'uint128',
                error: 'none',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
          ],
          name: 'get-owner',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  optional: 'principal',
                },
                error: 'none',
              },
            },
          },
        },
        {
          args: [
            {
              name: 'id',
              type: 'uint128',
            },
          ],
          name: 'get-token-uri',
          access: 'read_only',
          outputs: {
            type: {
              response: {
                ok: {
                  optional: {
                    'string-ascii': {
                      length: 92,
                    },
                  },
                },
                error: 'none',
              },
            },
          },
        },
      ],
      variables: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    const query1 = await supertest(api.server).get(
      `/extended/v1/contract/by_trait?trait_abi=${JSON.stringify(traitJsonAbiRequest1)}`
    );
    expect(query1.status).toBe(404);
  });

  test('list contract with given trait: Bad request', async () => {
    const traitJsonAbiRequest = {
      //missing functions
      maps: [],
      variables: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    const query = await supertest(api.server).get(
      `/extended/v1/contract/by_trait?trait_abi=${JSON.stringify(traitJsonAbiRequest)}`
    );
    expect(query.status).toBe(400);

    const query1 = await supertest(api.server).get('/extended/v1/contract/by_trait');
    expect(query1.status).toBe(400);
  });

  test('test large query param', async () => {
    let randomData = 'A';
    randomData = randomData.repeat(32 * 1024);

    const query = await supertest(api.server).get(
      `/extended/v1/contract/by_trait?trait_abi=${randomData}`
    );
    expect(query.status).toBe(431);
  });

  test('status for multiple contracts', async () => {
    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({
        tx_id: '0x1234',
        type_id: DbTxTypeId.SmartContract,
        smart_contract_contract_id: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-1',
        smart_contract_source_code: '(some-contract-src)',
        smart_contract_clarity_version: 1,
        abi: JSON.stringify({ some: 'abi' }),
      })
      .build();
    await db.update(block1);
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({
        tx_id: '0x1222',
        type_id: DbTxTypeId.SmartContract,
        smart_contract_contract_id: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-2',
        smart_contract_source_code: '(some-contract-src)',
        smart_contract_clarity_version: 1,
        abi: JSON.stringify({ some: 'abi' }),
      })
      .build();
    await db.update(block2);

    // Contracts are found
    let query = await supertest(api.server).get(
      `/extended/v2/smart-contracts/status?contract_id=SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-1&contract_id=SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-2`
    );
    expect(query.status).toBe(200);
    let json = JSON.parse(query.text);
    expect(json).toStrictEqual({
      'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-1': {
        found: true,
        result: {
          block_height: 1,
          contract_id: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-1',
          status: 'success',
          tx_id: '0x1234',
        },
      },
      'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-2': {
        found: true,
        result: {
          block_height: 2,
          contract_id: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-2',
          status: 'success',
          tx_id: '0x1222',
        },
      },
    });

    // Assume two contract attempts on the mempool
    const mempoolTx1 = testMempoolTx({
      tx_id: '0x111111',
      type_id: DbTxTypeId.SmartContract,
      nonce: 5,
      smart_contract_contract_id: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-3',
    });
    const mempoolTx2 = testMempoolTx({
      tx_id: '0x111122',
      type_id: DbTxTypeId.SmartContract,
      nonce: 6,
      smart_contract_contract_id: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-3',
    });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1, mempoolTx2] });
    query = await supertest(api.server).get(
      `/extended/v2/smart-contracts/status?contract_id=SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-3`
    );
    expect(query.status).toBe(200);
    json = JSON.parse(query.text);
    // Only the first one is reported.
    expect(json).toStrictEqual({
      'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-3': {
        found: true,
        result: {
          contract_id: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.contract-3',
          status: 'pending',
          tx_id: '0x111111',
        },
      },
    });

    // Check found = false
    query = await supertest(api.server).get(
      `/extended/v2/smart-contracts/status?contract_id=SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.abcde`
    );
    expect(query.status).toBe(200);
    json = JSON.parse(query.text);
    // Only the first one is reported.
    expect(json).toStrictEqual({
      'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.abcde': {
        found: false,
      },
    });
  });
});
