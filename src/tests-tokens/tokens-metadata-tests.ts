import * as supertest from 'supertest';
import {
  makeContractDeploy,
  ChainID,
  getAddressFromPrivateKey,
  PostConditionMode,
} from '@stacks/transactions';
import * as BN from 'bn.js';
import { DbTx, DbMempoolTx, DbTxStatus } from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import * as fs from 'fs';
import { Server } from 'node:net';
import { startEventServer } from '../event-stream/event-server';
import { getStacksTestnetNetwork } from '../rosetta-helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { logger } from '../helpers';

const pKey = 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01';
const stacksNetwork = getStacksTestnetNetwork();
const HOST = 'localhost';
const PORT = 20443;

describe('api tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;
  let eventServer: Server;

  function standByForTx(expectedTxId: string): Promise<DbTx> {
    const broadcastTx = new Promise<DbTx>(resolve => {
      const listener: (info: DbTx | DbMempoolTx) => void = info => {
        if (
          info.tx_id === expectedTxId &&
          (info.status === DbTxStatus.Success ||
            info.status === DbTxStatus.AbortByResponse ||
            info.status === DbTxStatus.AbortByPostCondition)
        ) {
          api.datastore.removeListener('txUpdate', listener);
          resolve(info as DbTx);
        }
      };
      api.datastore.addListener('txUpdate', listener);
    });

    return broadcastTx;
  }

  function standByForTokens(id: string): Promise<string> {
    const contractId = new Promise<string>(resolve => {
      const listener: (info: string) => void = info => {
        if (info === id) {
          api.datastore.removeListener('tokensUpdate', listener);
          resolve(info);
        }
      };
      api.datastore.addListener('tokensUpdate', listener);
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

  async function deployContract(
    contractName: string,
    senderPk: string,
    sourceFile: string,
    api: ApiServer
  ) {
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
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    eventServer = await startEventServer({ db, chainId: ChainID.Testnet });
    api = await startApiServer(db, ChainID.Testnet);
  });

  test('token nft-metadata', async () => {
    const contract = await deployContract(
      'nft-trait',
      pKey,
      'src/tests-tokens/test-contracts/nft-trait.clar',
      api
    );
    const tx = await standByForTx(contract.txId);
    if (tx.status != 1) logger.error('contract deploy error', tx);

    const contract1 = await deployContract(
      'beeple',
      pKey,
      'src/tests-tokens/test-contracts/beeple.clar',
      api
    );
    const tx1 = await standByForTx(contract1.txId);
    if (tx1.status != 1) logger.error('contract deploy error', tx1);

    await standByForTokens(contract1.contractId);

    const query = await db.getNftMetadata(contract1.contractId);
    expect(query.found).toBe(true);

    const senderAddress = getAddressFromPrivateKey(pKey, stacksNetwork.version);
    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/${senderAddress}.beeple/nft/metadata`
    );
    expect(query1.status).toBe(200);
    expect(query1.body).toHaveProperty('name');
    expect(query1.body).toHaveProperty('description');
    expect(query1.body).toHaveProperty('image_uri');
    expect(query1.body).toHaveProperty('image_canonical_uri');
  });

  test('token ft-metadata tests', async () => {
    const contract = await deployContract(
      'ft-trait',
      pKey,
      'src/tests-tokens/test-contracts/ft-trait.clar',
      api
    );

    const tx = await standByForTx(contract.txId);
    if (tx.status != 1) logger.error('contract deploy error', tx);

    const contract1 = await deployContract(
      'hey-token',
      pKey,
      'src/tests-tokens/test-contracts/hey-token.clar',
      api
    );
    const tx1 = await standByForTx(contract1.txId);
    if (tx1.status != 1) logger.error('contract deploy error', tx1);

    await standByForTokens(contract1.contractId);

    const query = await db.getFtMetadata(contract1.contractId);
    expect(query.found).toBe(true);

    const senderAddress = getAddressFromPrivateKey(pKey, stacksNetwork.version);
    const query1 = await supertest(api.server).get(
      `/extended/v1/tokens/${senderAddress}.hey-token/ft/metadata`
    );

    expect(query1.body).toHaveProperty('name');
    expect(query1.body).toHaveProperty('description');
    expect(query1.body).toHaveProperty('image_uri');
    expect(query1.body).toHaveProperty('image_canonical_uri');
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
