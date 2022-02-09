import * as supertest from 'supertest';
import {
  makeContractDeploy,
  ChainID,
  getAddressFromPrivateKey,
  PostConditionMode,
  AnchorMode,
} from '@stacks/transactions';
import * as BN from 'bn.js';
import {
  DbTx,
  DbTxStatus,
  DbFungibleTokenMetadata,
  DbNonFungibleTokenMetadata,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import * as fs from 'fs';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { getStacksTestnetNetwork } from '../rosetta-helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { logger, timeout } from '../helpers';
import * as nock from 'nock';
import { performFetch, TokensProcessorQueue } from './../event-stream/tokens-contract-handler';

const pKey = 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01';
const stacksNetwork = getStacksTestnetNetwork();
const HOST = 'localhost';
const PORT = 20443;

describe('api tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;
  let eventServer: EventStreamServer;
  let tokensProcessorQueue: TokensProcessorQueue;

  function standByForTx(expectedTxId: string): Promise<DbTx> {
    const broadcastTx = new Promise<DbTx>((resolve, reject) => {
      const listener: (txId: string) => void = async txId => {
        const dbTxQuery = await api.datastore.getTx({ txId: txId, includeUnanchored: true });
        if (!dbTxQuery.found) {
          return;
        }
        const dbTx = dbTxQuery.result;
        if (
          dbTx.tx_id === expectedTxId &&
          (dbTx.status === DbTxStatus.Success ||
            dbTx.status === DbTxStatus.AbortByResponse ||
            dbTx.status === DbTxStatus.AbortByPostCondition)
        ) {
          api.datastore.removeListener('txUpdate', listener);
          resolve(dbTx);
        }
      };
      api.datastore.addListener('txUpdate', listener);
    });

    return broadcastTx;
  }

  function standByForTokens(id: string): Promise<void> {
    const contractId = new Promise<void>(resolve => {
      tokensProcessorQueue.processEndEvent.attachOnce(
        token => token.contractId === id,
        () => resolve()
      );
    });

    return contractId;
  }

  async function sendCoreTx(serializedTx: Buffer): Promise<{ txId: string }> {
    try {
      const submitResult = await new StacksCoreRpcClient({
        host: HOST,
        port: PORT,
      }).sendTransaction(serializedTx);
      return submitResult;
    } catch (error) {
      logger.error('error: ', error);
    }
    return Promise.resolve({ txId: '' });
  }

  async function deployContract(contractName: string, senderPk: string, sourceFile: string) {
    const senderAddress = getAddressFromPrivateKey(senderPk, stacksNetwork.version);
    const source = fs.readFileSync(sourceFile).toString();
    const normalized_contract_source = source.replace(/\r/g, '').replace(/\t/g, ' ');

    const contractDeployTx = await makeContractDeploy({
      contractName: contractName,
      codeBody: normalized_contract_source,
      senderKey: senderPk,
      network: stacksNetwork,
      postConditionMode: PostConditionMode.Allow,
      sponsored: false,
      anchorMode: AnchorMode.Any,
    });

    const contractId = senderAddress + '.' + contractName;

    const feeRateReq = await fetch(stacksNetwork.getTransferFeeEstimateApiUrl());
    const feeRateResult = await feeRateReq.text();
    const txBytes = new BN(contractDeployTx.serialize().byteLength);
    const feeRate = new BN(feeRateResult);
    const fee = feeRate.mul(txBytes);
    contractDeployTx.setFee(fee);
    const { txId } = await sendCoreTx(contractDeployTx.serialize());
    return { txId, contractId };
  }

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect({ usageName: 'tests' });
    client = await db.pool.connect();
    eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
    tokensProcessorQueue = new TokensProcessorQueue(db, ChainID.Testnet);
  });

  beforeEach(() => {
    process.env['STACKS_API_ENABLE_FT_METADATA'] = '1';
    process.env['STACKS_API_ENABLE_NFT_METADATA'] = '1';
    nock.cleanAll();
  });

  test('metadata disabled', async () => {
    process.env['STACKS_API_ENABLE_FT_METADATA'] = '0';
    process.env['STACKS_API_ENABLE_NFT_METADATA'] = '0';
    const query1 = await supertest(api.server).get(`/extended/v1/tokens/nft/metadata`);
    expect(query1.status).toBe(500);
    expect(query1.body.error).toMatch(/not enabled/);
    const query2 = await supertest(api.server).get(`/extended/v1/tokens/ft/metadata`);
    expect(query2.status).toBe(500);
    expect(query2.body.error).toMatch(/not enabled/);
    const query3 = await supertest(api.server).get(`/extended/v1/tokens/example/nft/metadata`);
    expect(query3.status).toBe(500);
    expect(query3.body.error).toMatch(/not enabled/);
    const query4 = await supertest(api.server).get(`/extended/v1/tokens/example/ft/metadata`);
    expect(query4.status).toBe(500);
    expect(query4.body.error).toMatch(/not enabled/);
  });

  test('token nft-metadata data URL plain percent-encoded', async () => {
    const contract1 = await deployContract(
      'beeple-a',
      pKey,
      'src/tests-tokens/test-contracts/beeple-data-url-a.clar'
    );
    await standByForTokens(contract1.contractId);

    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/${contract1.contractId}/nft/metadata`
    );
    expect(query1.status).toBe(200);
    expect(query1.body).toHaveProperty('token_uri');
    expect(query1.body).toHaveProperty('name');
    expect(query1.body).toHaveProperty('description');
    expect(query1.body).toHaveProperty('image_uri');
    expect(query1.body).toHaveProperty('image_canonical_uri');
    expect(query1.body).toHaveProperty('tx_id');
    expect(query1.body).toHaveProperty('sender_address');
  });

  test('token nft-metadata data URL base64 w/o media type', async () => {
    const contract1 = await deployContract(
      'beeple-b',
      pKey,
      'src/tests-tokens/test-contracts/beeple-data-url-b.clar'
    );

    await standByForTokens(contract1.contractId);

    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/${contract1.contractId}/nft/metadata`
    );
    expect(query1.status).toBe(200);
    expect(query1.body).toHaveProperty('token_uri');
    expect(query1.body).toHaveProperty('name');
    expect(query1.body).toHaveProperty('description');
    expect(query1.body).toHaveProperty('image_uri');
    expect(query1.body).toHaveProperty('image_canonical_uri');
    expect(query1.body).toHaveProperty('tx_id');
    expect(query1.body).toHaveProperty('sender_address');
  });

  test('token nft-metadata data URL plain non-encoded', async () => {
    const contract1 = await deployContract(
      'beeple-c',
      pKey,
      'src/tests-tokens/test-contracts/beeple-data-url-c.clar'
    );

    await standByForTokens(contract1.contractId);

    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/${contract1.contractId}/nft/metadata`
    );
    expect(query1.status).toBe(200);
    expect(query1.body).toHaveProperty('token_uri');
    expect(query1.body).toHaveProperty('name');
    expect(query1.body).toHaveProperty('description');
    expect(query1.body).toHaveProperty('image_uri');
    expect(query1.body).toHaveProperty('image_canonical_uri');
    expect(query1.body).toHaveProperty('tx_id');
    expect(query1.body).toHaveProperty('sender_address');
  });

  test('token nft-metadata', async () => {
    //mock the response
    const nftMetadata = {
      name: 'EVERYDAYS: THE FIRST 5000 DAYS',
      imageUrl:
        'https://ipfsgateway.makersplace.com/ipfs/QmZ15eQX8FPjfrtdX3QYbrhZxJpbLpvDpsgb2p3VEH8Bqq',
      description:
        'I made a picture from start to finish every single day from May 1st, 2007 - January 7th, 2021. This is every motherfucking one of those pictures.',
    };
    nock('https://ipfs.io')
      .get('/ipfs/QmPAg1mjxcEQPPtqsLoEcauVedaeMH81WXDPvPx3VC5zUz')
      .reply(200, nftMetadata);

    const contract = await deployContract(
      'nft-trait',
      pKey,
      'src/tests-tokens/test-contracts/nft-trait.clar'
    );
    const tx = await standByForTx(contract.txId);
    if (tx.status != 1) logger.error('contract deploy error', tx);

    const contract1 = await deployContract(
      'beeple',
      pKey,
      'src/tests-tokens/test-contracts/beeple.clar'
    );

    await standByForTokens(contract1.contractId);

    const senderAddress = getAddressFromPrivateKey(pKey, stacksNetwork.version);
    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/${senderAddress}.beeple/nft/metadata`
    );
    expect(query1.status).toBe(200);
    expect(query1.body).toHaveProperty('token_uri');
    expect(query1.body.name).toBe(nftMetadata.name);
    expect(query1.body.description).toBe(nftMetadata.description);
    expect(query1.body.image_uri).toBe(nftMetadata.imageUrl);
    expect(query1.body).toHaveProperty('image_canonical_uri');
    expect(query1.body).toHaveProperty('tx_id');
    expect(query1.body).toHaveProperty('sender_address');
  });

  test('token ft-metadata tests', async () => {
    //mock the response
    const ftMetadata = {
      name: 'Heystack',
      description:
        'Heystack is a SIP-010-compliant fungible token on the Stacks Blockchain, used on the Heystack app',
      image: 'https://heystack.xyz/assets/Stacks128w.png',
    };

    nock('https://heystack.xyz').get('/token-metadata.json').reply(200, ftMetadata);

    const contract = await deployContract(
      'ft-trait',
      pKey,
      'src/tests-tokens/test-contracts/ft-trait.clar'
    );

    const tx = await standByForTx(contract.txId);
    if (tx.status != 1) logger.error('contract deploy error', tx);

    const contract1 = await deployContract(
      'hey-token',
      pKey,
      'src/tests-tokens/test-contracts/hey-token.clar'
    );

    await standByForTokens(contract1.contractId);

    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/${contract1.contractId}/ft/metadata`
    );

    expect(query1.body).toHaveProperty('token_uri');
    expect(query1.body).toHaveProperty('name');
    expect(query1.body.description).toBe(ftMetadata.description);
    expect(query1.body.image_uri).toBe(ftMetadata.image);
    expect(query1.body).toHaveProperty('image_canonical_uri');
    expect(query1.body).toHaveProperty('tx_id');
    expect(query1.body).toHaveProperty('sender_address');
  });

  test('token ft-metadata list', async () => {
    for (let i = 0; i < 200; i++) {
      const ftMetadata: DbFungibleTokenMetadata = {
        token_uri: 'ft-token',
        name: 'ft-metadata' + i,
        description: 'ft -metadata description',
        symbol: 'stx',
        decimals: 5,
        image_uri: 'ft-metadata image uri example',
        image_canonical_uri: 'ft-metadata image canonical uri example',
        contract_id: 'ABCDEFGHIJ.ft-metadata',
        tx_id: '0x123456',
        sender_address: 'ABCDEFGHIJ',
      };
      await db.updateFtMetadata(ftMetadata, 0);
    }

    const query = await supertest(api.server).get(`/extended/v1/tokens/ft/metadata`);
    expect(query.status).toBe(200);
    expect(query.body.total).toBeGreaterThan(96);
    expect(query.body.limit).toStrictEqual(96);
    expect(query.body.offset).toStrictEqual(0);
    expect(query.body.results.length).toStrictEqual(96);

    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/ft/metadata?limit=20&offset=10`
    );
    expect(query1.status).toBe(200);
    expect(query1.body.total).toBeGreaterThanOrEqual(200);
    expect(query1.body.limit).toStrictEqual(20);
    expect(query1.body.offset).toStrictEqual(10);
    expect(query1.body.results.length).toStrictEqual(20);
  });

  test('token nft-metadata list', async () => {
    for (let i = 0; i < 200; i++) {
      const nftMetadata: DbNonFungibleTokenMetadata = {
        token_uri: 'nft-tokenuri',
        name: 'nft-metadata' + i,
        description: 'nft -metadata description' + i,
        image_uri: 'nft-metadata image uri example',
        image_canonical_uri: 'nft-metadata image canonical uri example',
        contract_id: 'ABCDEFGHIJ.nft-metadata' + i,
        tx_id: '0x12345678',
        sender_address: 'ABCDEFGHIJ',
      };

      await db.updateNFtMetadata(nftMetadata, 0);
    }

    const query = await supertest(api.server).get(`/extended/v1/tokens/nft/metadata`);
    expect(query.status).toBe(200);
    expect(query.body.total).toBeGreaterThan(96);
    expect(query.body.limit).toStrictEqual(96);
    expect(query.body.offset).toStrictEqual(0);
    expect(query.body.results.length).toStrictEqual(96);

    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/metadata?limit=20&offset=10`
    );
    expect(query1.status).toBe(200);
    expect(query1.body.total).toBeGreaterThanOrEqual(200);
    expect(query1.body.limit).toStrictEqual(20);
    expect(query1.body.offset).toStrictEqual(10);
    expect(query1.body.results.length).toStrictEqual(20);
  });

  test('large metadata payload test', async () => {
    //mock the response
    const maxResponseBytes = 10_000;
    const randomData = Buffer.alloc(maxResponseBytes + 100, 'x', 'utf8');
    nock('https://example.com').get('/large_payload').reply(200, randomData.toString());

    await expect(async () => {
      await performFetch('https://example.com/large_payload', {
        maxResponseBytes: maxResponseBytes,
      });
    }).rejects.toThrow(/over limit/);
  });

  test('timeout metadata payload test', async () => {
    //mock the response
    const responseTimeout = 100;
    nock('https://example.com')
      .get('/timeout_payload')
      .reply(200, async (_uri, _requestBody, cb) => {
        await timeout(responseTimeout + 200);
        cb(null, '{"hello":"world"}');
      });

    await expect(async () => {
      await performFetch('https://example.com/timeout_payload', {
        timeoutMs: responseTimeout,
      });
    }).rejects.toThrow(/network timeout/);
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
