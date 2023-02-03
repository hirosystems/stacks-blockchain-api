import * as supertest from 'supertest';
import { bufferCVFromString, ChainID, serializeCV } from '@stacks/transactions';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbEventTypeId,
  DbSmartContract,
  DbSmartContractEvent,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { bufferToHexPrefixString, I32_MAX, waiter } from '../helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';

describe('smart contract tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: true,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
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
      coinbase_payload: bufferToHexPrefixString(Buffer.from('hi')),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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
      value: bufferToHexPrefixString(Buffer.from(serializeCV(bufferCVFromString('some val')))),
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
      coinbase_payload: bufferToHexPrefixString(Buffer.from('hi')),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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
      value: bufferToHexPrefixString(Buffer.from(serializeCV(bufferCVFromString('some val')))),
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

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
