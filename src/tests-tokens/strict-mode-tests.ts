import * as nock from 'nock';
import { ChainID, ClarityAbi, cvToHex, noneCV, uintCV } from '@stacks/transactions';
import { PoolClient } from 'pg';
import { TestBlockBuilder } from '../test-utils/test-builders';
import { ApiServer, startApiServer } from '../api/init';
import {
  METADATA_MAX_PAYLOAD_BYTE_SIZE,
  TokensContractHandler,
} from '../token-metadata/tokens-contract-handler';
import { DbTxTypeId } from '../datastore/common';
import { stringCV } from '@stacks/transactions/dist/clarity/types/stringCV';
import { getTokenMetadataFetchTimeoutMs } from '../token-metadata/helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { TokensProcessorQueue } from '../token-metadata/tokens-processor-queue';

const NFT_CONTRACT_ABI: ClarityAbi = {
  maps: [],
  functions: [
    {
      access: 'read_only',
      args: [],
      name: 'get-last-token-id',
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
      access: 'read_only',
      args: [{ name: 'any', type: 'uint128' }],
      name: 'get-token-uri',
      outputs: {
        type: {
          response: {
            ok: {
              optional: { 'string-ascii': { length: 256 } },
            },
            error: 'uint128',
          },
        },
      },
    },
    {
      access: 'read_only',
      args: [{ type: 'uint128', name: 'any' }],
      name: 'get-owner',
      outputs: {
        type: {
          response: {
            ok: {
              optional: 'principal',
            },
            error: 'uint128',
          },
        },
      },
    },
    {
      access: 'public',
      args: [
        { type: 'uint128', name: 'id' },
        { type: 'principal', name: 'sender' },
        { type: 'principal', name: 'recipient' },
      ],
      name: 'transfer',
      outputs: {
        type: {
          response: {
            ok: 'bool',
            error: {
              tuple: [
                { type: { 'string-ascii': { length: 32 } }, name: 'kind' },
                { type: 'uint128', name: 'code' },
              ],
            },
          },
        },
      },
    },
  ],
  variables: [
    {
      name: 'nft-not-found-err',
      type: { response: { ok: 'none', error: 'uint128' } },
      access: 'constant',
    },
    {
      name: 'nft-not-owned-err',
      type: { response: { ok: 'none', error: 'uint128' } },
      access: 'constant',
    },
    {
      name: 'sender-equals-recipient-err',
      type: { response: { ok: 'none', error: 'uint128' } },
      access: 'constant',
    },
  ],
  fungible_tokens: [],
  non_fungible_tokens: [{ name: 'beeple', type: 'uint128' }],
};

describe('token metadata strict mode', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const contractId = 'SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD.project-indigo-act1';
  const contractTxId = '0x1f1f';

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

    process.env['STACKS_API_ENABLE_FT_METADATA'] = '1';
    process.env['STACKS_API_ENABLE_NFT_METADATA'] = '1';
    process.env['STACKS_CORE_RPC_PORT'] = '20443';
    nock.cleanAll();

    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx()
      .addTx({
        tx_id: contractTxId,
        type_id: DbTxTypeId.SmartContract,
        smart_contract_contract_id: contractId,
        smart_contract_source_code: '(source)',
      })
      .addTxSmartContract({
        contract_id: contractId,
        contract_source: '(source)',
        abi: JSON.stringify(NFT_CONTRACT_ABI),
      })
      .build();
    await db.update(block);
  });

  test('retryable error increases retry_count', async () => {
    process.env['STACKS_CORE_RPC_PORT'] = '11111'; // Make node unreachable
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toBe(1);
    expect(entry.result?.processed).toBe(false);
  });

  test('retry_count limit reached marks entry as processed', async () => {
    process.env['STACKS_CORE_RPC_PORT'] = '11111'; // Make node unreachable
    process.env['STACKS_API_TOKEN_METADATA_MAX_RETRIES'] = '0';
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(1);
    expect(entry.result?.processed).toBe(true);
  });

  test('strict mode ignores retry_count limit', async () => {
    process.env['STACKS_CORE_RPC_PORT'] = '11111'; // Make node unreachable
    process.env['STACKS_API_TOKEN_METADATA_STRICT_MODE'] = '1';
    process.env['STACKS_API_TOKEN_METADATA_MAX_RETRIES'] = '0';
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(1);
    expect(entry.result?.processed).toBe(false);
  });

  test('db errors are handled gracefully in contract handler', async () => {
    process.env['STACKS_CORE_RPC_PORT'] = '11111'; // Make node unreachable
    process.env['STACKS_API_TOKEN_METADATA_STRICT_MODE'] = '1';
    process.env['STACKS_API_TOKEN_METADATA_MAX_RETRIES'] = '0';
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await db.close(); // End connection to trigger postgres error
    await expect(handler.start()).resolves.not.toThrow();
  });

  test('db errors are handled gracefully in queue', async () => {
    const queue = new TokensProcessorQueue(db, ChainID.Testnet);
    await db.close(); // End connection to trigger postgres error
    await expect(queue.checkDbQueue()).resolves.not.toThrow();
    await expect(queue.drainDbQueue()).resolves.not.toThrow();
    await expect(queue.queueNotificationHandler(1)).resolves.not.toThrow();
    await expect(
      queue.queueHandler({ queueId: 1, txId: '0x11', contractId: 'test' })
    ).resolves.not.toThrow();
  });

  test('node runtime errors get retried', async () => {
    const mockResponse = {
      okay: false,
      cause: 'Runtime(Foo(Bar))',
    };
    nock('http://127.0.0.1:20443')
      .post(
        '/v2/contracts/call-read/SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD/project-indigo-act1/get-token-uri'
      )
      .reply(200, mockResponse);
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(1);
    expect(entry.result?.processed).toBe(false);
  });

  test('other node errors fail immediately', async () => {
    const mockResponse = {
      okay: false,
      cause: 'Unchecked(Foo(Bar))',
    };
    nock('http://127.0.0.1:20443')
      .post(
        '/v2/contracts/call-read/SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD/project-indigo-act1/get-token-uri'
      )
      .reply(200, mockResponse);
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(0);
    expect(entry.result?.processed).toBe(true);
  });

  test('clarity value parse errors get retried', async () => {
    const mockResponse = {
      okay: true,
      result: cvToHex(uintCV(5)), // `get-token-uri` will fail because this is a `uint`
    };
    nock('http://127.0.0.1:20443')
      .post(
        '/v2/contracts/call-read/SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD/project-indigo-act1/get-token-uri'
      )
      .reply(200, mockResponse);
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(1);
    expect(entry.result?.processed).toBe(false);
  });

  test('incorrect none uri strings are parsed as undefined', async () => {
    const mockResponse = {
      okay: true,
      result: cvToHex(noneCV()),
    };
    nock('http://127.0.0.1:20443')
      .post(
        '/v2/contracts/call-read/SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD/project-indigo-act1/get-token-uri'
      )
      .reply(200, mockResponse);
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(0);
    expect(entry.result?.processed).toBe(true);
    const metadata = await db.getNftMetadata(
      'SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD.project-indigo-act1'
    );
    expect(metadata.result?.token_uri).toEqual('');
  });

  test('metadata timeout errors get retried immediately', async () => {
    process.env['STACKS_API_TOKEN_METADATA_FETCH_TIMEOUT_MS'] = '500';
    const mockTokenUri = {
      okay: true,
      result: cvToHex(stringCV('http://indigo.com/nft.jpeg', 'ascii')),
    };
    nock('http://127.0.0.1:20443')
      .post(
        '/v2/contracts/call-read/SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD/project-indigo-act1/get-token-uri'
      )
      .reply(200, mockTokenUri);
    // Timeout first time.
    nock('http://indigo.com')
      .get('/nft.jpeg')
      .times(1)
      .delay(getTokenMetadataFetchTimeoutMs() + 100)
      .reply(200);
    // Correct second time.
    nock('http://indigo.com').get('/nft.jpeg').reply(200, {});
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(0);
    expect(entry.result?.processed).toBe(true);
  });

  test('metadata size exceeded errors fail immediately', async () => {
    const mockTokenUri = {
      okay: true,
      result: cvToHex(stringCV('http://indigo.com/nft.jpeg', 'ascii')),
    };
    nock('http://127.0.0.1:20443')
      .post(
        '/v2/contracts/call-read/SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD/project-indigo-act1/get-token-uri'
      )
      .reply(200, mockTokenUri);
    const bigAssBuffer = Buffer.alloc(METADATA_MAX_PAYLOAD_BYTE_SIZE + 100);
    nock('http://indigo.com').get('/nft.jpeg').reply(200, bigAssBuffer);
    const handler = new TokensContractHandler({
      contractId: contractId,
      smartContractAbi: NFT_CONTRACT_ABI,
      datastore: db,
      chainId: ChainID.Testnet,
      txId: contractTxId,
      dbQueueId: 1,
    });
    await handler.start();
    const entry = await db.getTokenMetadataQueueEntry(1);
    expect(entry.result?.retry_count).toEqual(0);
    expect(entry.result?.processed).toBe(true);

    // Metadata still contains the rest of the data.
    const metadata = await db.getNftMetadata(contractId);
    expect(metadata.found).toBe(true);
    expect(metadata.result?.token_uri).toBe('http://indigo.com/nft.jpeg');
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
