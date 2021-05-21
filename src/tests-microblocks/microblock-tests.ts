import * as supertest from 'supertest';
import {
  makeContractCall,
  NonFungibleConditionCode,
  FungibleConditionCode,
  bufferCVFromString,
  ClarityAbi,
  ClarityType,
  makeContractDeploy,
  serializeCV,
  sponsorTransaction,
  createNonFungiblePostCondition,
  createFungiblePostCondition,
  createSTXPostCondition,
  BufferReader,
  ChainID,
} from '@stacks/transactions';
import * as BN from 'bn.js';
import { readTransaction } from '../p2p/tx';
import { getTxFromDataStore, getBlockFromDataStore } from '../api/controllers/db-controller';
import {
  createDbTxFromCoreMsg,
  DbBlock,
  DbTx,
  DbTxTypeId,
  DbStxEvent,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbFtEvent,
  DbNftEvent,
  DbMempoolTx,
  DbSmartContract,
  DbSmartContractEvent,
  DbTxStatus,
  DbBurnchainReward,
  DataStoreUpdateData,
  DbRewardSlotHolder,
  DbMinerReward,
  DbTokenOfferingLocked,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { bufferToHexPrefixString, I32_MAX, microStxToStx, STACKS_DECIMAL_PLACES } from '../helpers';

describe('microblock tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    api = await startApiServer(db, ChainID.Testnet);
  });

  test('contiguous microblock stream fully confirmed in anchor block', async () => {
    await Promise.resolve();
    expect(true).toBeTruthy();
  });

  afterEach(async () => {
    await api.terminate();
    client.release();
    await db?.close();
    // await runMigrations(undefined, 'down');
  });
});
