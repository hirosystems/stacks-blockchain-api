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
  AnchorMode,
  intCV,
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
  DataStoreBlockUpdateData,
  DbRewardSlotHolder,
  DbMinerReward,
  DbTokenOfferingLocked,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { bufferToHexPrefixString, I32_MAX, microStxToStx, STACKS_DECIMAL_PLACES } from '../helpers';
import { FEE_RATE } from './../api/routes/fee-rate';
import { FeeRateRequest } from 'docs/generated';

describe('api tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
  });

  test('info block time', async () => {
    const query1 = await supertest(api.server).get(`/extended/v1/info/network_block_times`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      testnet: { target_block_time: 120 },
      mainnet: { target_block_time: 600 },
    });

    const query2 = await supertest(api.server).get(`/extended/v1/info/network_block_time/mainnet`);
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(JSON.parse(query2.text)).toEqual({ target_block_time: 600 });

    const query3 = await supertest(api.server).get(`/extended/v1/info/network_block_time/testnet`);
    expect(query3.status).toBe(200);
    expect(query3.type).toBe('application/json');
    expect(JSON.parse(query3.text)).toEqual({ target_block_time: 120 });

    const query4 = await supertest(api.server).get(`/extended/v1/info/network_block_time/badnet`);
    expect(query4.status).toBe(400);
    expect(query4.type).toBe('application/json');
    expect(JSON.parse(query4.text)).toEqual({
      error: '`network` param must be `testnet` or `mainnet`',
    });
  });

  test('stx-supply', async () => {
    const testAddr1 = 'testAddr1';
    const dbBlock1: DbBlock = {
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 39486,
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
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: dbBlock1.index_block_hash,
      block_hash: dbBlock1.block_hash,
      block_height: dbBlock1.block_height,
      burn_block_time: dbBlock1.burn_block_time,
      parent_burn_block_time: 0,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: testAddr1,
      origin_hash_mode: 1,
      event_count: 5,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const stxMintEvent1: DbStxEvent = {
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Mint,
      recipient: tx.sender_address,
      event_type: DbEventTypeId.StxAsset,
      amount: 230_000_000_000_000n,
    };
    const stxMintEvent2: DbStxEvent = {
      ...stxMintEvent1,
      amount: 5_000_000_000_000n,
    };
    await db.updateBlock(client, dbBlock1);
    await db.updateTx(client, tx);
    await db.updateStxEvent(client, tx, stxMintEvent1);
    await db.updateStxEvent(client, tx, stxMintEvent2);

    const expectedTotalStx1 = stxMintEvent1.amount + stxMintEvent2.amount;
    const result1 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');
    const expectedResp1 = {
      unlocked_percent: '17.38',
      total_stx: '1352464600.000000',
      unlocked_stx: microStxToStx(expectedTotalStx1),
      block_height: dbBlock1.block_height,
    };
    expect(JSON.parse(result1.text)).toEqual(expectedResp1);

    // ensure burned STX reduce the unlocked stx supply
    const stxBurnEvent1: DbStxEvent = {
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Burn,
      sender: tx.sender_address,
      event_type: DbEventTypeId.StxAsset,
      amount: 10_000_000_000_000n,
    };
    await db.updateStxEvent(client, tx, stxBurnEvent1);
    const expectedTotalStx2 = stxMintEvent1.amount + stxMintEvent2.amount - stxBurnEvent1.amount;
    const result2 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    expect(result2.status).toBe(200);
    expect(result2.type).toBe('application/json');
    const expectedResp2 = {
      unlocked_percent: '16.64',
      total_stx: '1352464600.000000',
      unlocked_stx: microStxToStx(expectedTotalStx2),
      block_height: dbBlock1.block_height,
    };
    expect(JSON.parse(result2.text)).toEqual(expectedResp2);

    // ensure miner coinbase rewards are included
    const minerReward1: DbMinerReward = {
      block_hash: dbBlock1.block_hash,
      index_block_hash: dbBlock1.index_block_hash,
      from_index_block_hash: dbBlock1.index_block_hash,
      mature_block_height: dbBlock1.block_height,
      canonical: true,
      recipient: testAddr1,
      coinbase_amount: 15_000_000_000_000n,
      tx_fees_anchored: 1_000_000_000_000n,
      tx_fees_streamed_confirmed: 2_000_000_000_000n,
      tx_fees_streamed_produced: 3_000_000_000_000n,
    };
    await db.updateMinerReward(client, minerReward1);
    const expectedTotalStx3 =
      stxMintEvent1.amount +
      stxMintEvent2.amount -
      stxBurnEvent1.amount +
      minerReward1.coinbase_amount;
    const result3 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    expect(result3.status).toBe(200);
    expect(result3.type).toBe('application/json');
    const expectedResp3 = {
      unlocked_percent: '17.75',
      total_stx: '1352464600.000000',
      unlocked_stx: microStxToStx(expectedTotalStx3),
      block_height: dbBlock1.block_height,
    };
    expect(JSON.parse(result3.text)).toEqual(expectedResp3);

    const result4 = await supertest(api.server).get(`/extended/v1/stx_supply/total/plain`);
    expect(result4.status).toBe(200);
    expect(result4.type).toBe('text/plain');
    expect(result4.text).toEqual('1352464600.000000');

    const result5 = await supertest(api.server).get(`/extended/v1/stx_supply/circulating/plain`);
    expect(result5.status).toBe(200);
    expect(result5.type).toBe('text/plain');
    expect(result5.text).toEqual(microStxToStx(expectedTotalStx3));

    // test legacy endpoint response formatting
    const result6 = await supertest(api.server).get(`/extended/v1/stx_supply/legacy_format`);
    expect(result6.status).toBe(200);
    expect(result6.type).toBe('application/json');
    const expectedResp6 = {
      unlockedPercent: '17.75',
      totalStacks: '1352464600.000000',
      totalStacksFormatted: '1,352,464,600.000000',
      unlockedSupply: microStxToStx(expectedTotalStx3),
      unlockedSupplyFormatted: new Intl.NumberFormat('en', {
        minimumFractionDigits: STACKS_DECIMAL_PLACES,
      }).format(parseInt(microStxToStx(expectedTotalStx3))),
      blockHeight: dbBlock1.block_height.toString(),
    };
    expect(JSON.parse(result6.text)).toEqual(expectedResp6);
  });

  test('fetch reward slot holders', async () => {
    const slotHolder1: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 2,
      address: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
      slot_index: 0,
    };
    const slotHolder2: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 2,
      address: '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z',
      slot_index: 1,
    };
    await db.updateBurnchainRewardSlotHolders({
      burnchainBlockHash: '0x1234',
      burnchainBlockHeight: 2,
      slotHolders: [slotHolder1, slotHolder2],
    });
    const result = await supertest(api.server).get(`/extended/v1/burnchain/reward_slot_holders`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      total: 2,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 2,
          address: '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z',
          slot_index: 1,
        },
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 2,
          address: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
          slot_index: 0,
        },
      ],
    };
    expect(JSON.parse(result.text)).toEqual(expectedResp1);
  });

  test('fetch reward slot holder entries for BTC address', async () => {
    const slotHolder1: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 2,
      address: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
      slot_index: 0,
    };
    const slotHolder2: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 2,
      address: '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z',
      slot_index: 1,
    };
    await db.updateBurnchainRewardSlotHolders({
      burnchainBlockHash: '0x1234',
      burnchainBlockHeight: 2,
      slotHolders: [slotHolder1, slotHolder2],
    });
    const result = await supertest(api.server).get(
      `/extended/v1/burnchain/reward_slot_holders/${slotHolder1.address}`
    );
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      total: 1,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 2,
          address: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
          slot_index: 0,
        },
      ],
    };
    expect(JSON.parse(result.text)).toEqual(expectedResp1);
  });

  test('fetch reward slot holder entries for mainnet STX address', async () => {
    const mainnetStxAddr = 'SP2JKEZC09WVMR33NBSCWQAJC5GS590RP1FR9CK55';
    const mainnetBtcAddr = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';

    const slotHolder1: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 2,
      address: mainnetBtcAddr,
      slot_index: 0,
    };
    const slotHolder2: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 2,
      address: '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z',
      slot_index: 1,
    };
    await db.updateBurnchainRewardSlotHolders({
      burnchainBlockHash: '0x1234',
      burnchainBlockHeight: 2,
      slotHolders: [slotHolder1, slotHolder2],
    });
    const result = await supertest(api.server).get(
      `/extended/v1/burnchain/reward_slot_holders/${mainnetStxAddr}`
    );
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      total: 1,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 2,
          address: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
          slot_index: 0,
        },
      ],
    };
    expect(JSON.parse(result.text)).toEqual(expectedResp1);
  });

  test('fetch burnchain rewards', async () => {
    const addr1 = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
    const addr2 = '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z';
    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: addr1,
      reward_amount: 900n,
      reward_index: 0,
    };
    const reward2: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2001n,
      reward_recipient: addr1,
      reward_amount: 901n,
      reward_index: 1,
    };
    const reward3: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x2345',
      burn_block_height: 201,
      burn_amount: 3001n,
      reward_recipient: addr2,
      reward_amount: 902n,
      reward_index: 0,
    };
    const reward4: DbBurnchainReward = {
      ...reward3,
      reward_index: 1,
    };
    const reward5: DbBurnchainReward = {
      ...reward3,
      reward_index: 2,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1, reward2],
    });
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward3.burn_block_hash,
      burnchainBlockHeight: reward3.burn_block_height,
      rewards: [reward3, reward4, reward5],
    });

    const rewardResult = await supertest(api.server).get(
      `/extended/v1/burnchain/rewards?limit=3&offset=0`
    );
    expect(rewardResult.status).toBe(200);
    expect(rewardResult.type).toBe('application/json');
    const expectedResp1 = {
      limit: 3,
      offset: 0,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x2345',
          burn_block_height: 201,
          burn_amount: '3001',
          reward_recipient: '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z',
          reward_amount: '902',
          reward_index: 2,
        },
        {
          canonical: true,
          burn_block_hash: '0x2345',
          burn_block_height: 201,
          burn_amount: '3001',
          reward_recipient: '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z',
          reward_amount: '902',
          reward_index: 1,
        },
        {
          canonical: true,
          burn_block_hash: '0x2345',
          burn_block_height: 201,
          burn_amount: '3001',
          reward_recipient: '1DDUAqoyXvhF4cxznN9uL6j9ok1oncsT2z',
          reward_amount: '902',
          reward_index: 0,
        },
      ],
    };
    expect(JSON.parse(rewardResult.text)).toEqual(expectedResp1);
  });

  test('fetch burnchain total rewards for BTC address', async () => {
    const addr = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: addr,
      reward_amount: 1000n,
      reward_index: 0,
    };
    const reward2: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x2234',
      burn_block_height: 201,
      burn_amount: 2000n,
      reward_recipient: addr,
      reward_amount: 1001n,
      reward_index: 0,
    };
    const reward3: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x3234',
      burn_block_height: 202,
      burn_amount: 2000n,
      reward_recipient: addr,
      reward_amount: 1002n,
      reward_index: 0,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1],
    });
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward2.burn_block_hash,
      burnchainBlockHeight: reward2.burn_block_height,
      rewards: [reward2],
    });
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward3.burn_block_hash,
      burnchainBlockHeight: reward3.burn_block_height,
      rewards: [reward3],
    });
    const rewardResult = await supertest(api.server).get(
      `/extended/v1/burnchain/rewards/${addr}/total`
    );
    expect(rewardResult.status).toBe(200);
    expect(rewardResult.type).toBe('application/json');
    const expectedResp1 = {
      reward_recipient: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
      reward_amount: '3003',
    };
    expect(JSON.parse(rewardResult.text)).toEqual(expectedResp1);
  });

  test('fetch burnchain rewards for BTC address', async () => {
    const addr1 = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: addr1,
      reward_amount: 900n,
      reward_index: 0,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1],
    });
    const rewardResult = await supertest(api.server).get(`/extended/v1/burnchain/rewards/${addr1}`);
    expect(rewardResult.status).toBe(200);
    expect(rewardResult.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 200,
          burn_amount: '2000',
          reward_recipient: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
          reward_amount: '900',
          reward_index: 0,
        },
      ],
    };

    expect(JSON.parse(rewardResult.text)).toEqual(expectedResp1);
  });

  test('fetch burnchain rewards for mainnet STX address', async () => {
    const mainnetStxAddr = 'SP2JKEZC09WVMR33NBSCWQAJC5GS590RP1FR9CK55';
    const mainnetBtcAddr = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';

    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: mainnetBtcAddr,
      reward_amount: 900n,
      reward_index: 0,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1],
    });
    const rewardResult = await supertest(api.server).get(
      `/extended/v1/burnchain/rewards/${mainnetStxAddr}`
    );
    expect(rewardResult.status).toBe(200);
    expect(rewardResult.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 200,
          burn_amount: '2000',
          reward_recipient: mainnetBtcAddr,
          reward_amount: '900',
          reward_index: 0,
        },
      ],
    };

    expect(JSON.parse(rewardResult.text)).toEqual(expectedResp1);
  });

  test('fetch burnchain rewards for testnet STX address', async () => {
    const testnetStxAddr = 'STDFV22FCWGHB7B5563BHXVMCSYM183PRB9DH090';
    const testnetBtcAddr = 'mhyfanXuwsCMrixyQcCDzh28iHEdtQzZEm';

    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: testnetBtcAddr,
      reward_amount: 900n,
      reward_index: 0,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1],
    });
    const rewardResult = await supertest(api.server).get(
      `/extended/v1/burnchain/rewards/${testnetStxAddr}`
    );
    expect(rewardResult.status).toBe(200);
    expect(rewardResult.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 200,
          burn_amount: '2000',
          reward_recipient: testnetBtcAddr,
          reward_amount: '900',
          reward_index: 0,
        },
      ],
    };

    expect(JSON.parse(rewardResult.text)).toEqual(expectedResp1);
  });

  test('fetch burnchain rewards for testnet STX address', async () => {
    const testnetStxAddr = 'STDFV22FCWGHB7B5563BHXVMCSYM183PRB9DH090';
    const testnetBtcAddr = 'mhyfanXuwsCMrixyQcCDzh28iHEdtQzZEm';

    const reward1: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: '0x1234',
      burn_block_height: 200,
      burn_amount: 2000n,
      reward_recipient: testnetBtcAddr,
      reward_amount: 900n,
      reward_index: 0,
    };
    await db.updateBurnchainRewards({
      burnchainBlockHash: reward1.burn_block_hash,
      burnchainBlockHeight: reward1.burn_block_height,
      rewards: [reward1],
    });
    const rewardResult = await supertest(api.server).get(
      `/extended/v1/burnchain/rewards/${testnetStxAddr}`
    );
    expect(rewardResult.status).toBe(200);
    expect(rewardResult.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      results: [
        {
          canonical: true,
          burn_block_hash: '0x1234',
          burn_block_height: 200,
          burn_amount: '2000',
          reward_recipient: testnetBtcAddr,
          reward_amount: '900',
          reward_index: 0,
        },
      ],
    };

    expect(JSON.parse(rewardResult.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx', async () => {
    const mempoolTx: DbMempoolTx = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      receipt_time: 1594307695,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'pending',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx - sponsored', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const mempoolTx: DbMempoolTx = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      receipt_time: 1594307695,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'pending',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx - dropped', async () => {
    const mempoolTx1: DbMempoolTx = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      receipt_time: 1594307695,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
    };
    const mempoolTx2: DbMempoolTx = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
      receipt_time: 1594307702,
    };
    const mempoolTx3: DbMempoolTx = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
      receipt_time: 1594307703,
    };
    const mempoolTx4: DbMempoolTx = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
      receipt_time: 1594307704,
    };
    const mempoolTx5: DbMempoolTx = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
      receipt_time: 1594307705,
    };
    const mempoolTx6: DbMempoolTx = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
      receipt_time: 1594307706,
    };

    await db.updateMempoolTxs({
      mempoolTxs: [mempoolTx1, mempoolTx2, mempoolTx3, mempoolTx4, mempoolTx5],
    });
    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedReplaceAcrossFork,
      txIds: [mempoolTx1.tx_id, mempoolTx2.tx_id],
    });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx1.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'dropped_replace_across_fork',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    const searchResult2 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx2.tx_id}`);
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
      tx_status: 'dropped_replace_across_fork',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307702,
      receipt_time_iso: '2020-07-09T15:15:02.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };

    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedReplaceByFee,
      txIds: [mempoolTx3.tx_id],
    });
    const searchResult3 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx3.tx_id}`);
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
      tx_status: 'dropped_replace_by_fee',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307703,
      receipt_time_iso: '2020-07-09T15:15:03.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedTooExpensive,
      txIds: [mempoolTx4.tx_id],
    });
    const searchResult4 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx4.tx_id}`);
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
      tx_status: 'dropped_too_expensive',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307704,
      receipt_time_iso: '2020-07-09T15:15:04.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedStaleGarbageCollect,
      txIds: [mempoolTx5.tx_id],
    });
    const searchResult5 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx5.tx_id}`);
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
      tx_status: 'dropped_stale_garbage_collect',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307705,
      receipt_time_iso: '2020-07-09T15:15:05.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    const mempoolDroppedResult1 = await supertest(api.server).get(
      '/extended/v1/tx/mempool/dropped'
    );
    expect(mempoolDroppedResult1.status).toBe(200);
    expect(mempoolDroppedResult1.type).toBe('application/json');
    expect(mempoolDroppedResult1.body).toEqual(
      expect.objectContaining({
        results: expect.arrayContaining([
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
            tx_status: 'dropped_stale_garbage_collect',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
            tx_status: 'dropped_too_expensive',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
            tx_status: 'dropped_replace_by_fee',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
            tx_status: 'dropped_replace_across_fork',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
            tx_status: 'dropped_replace_across_fork',
          }),
        ]),
      })
    );

    const dbBlock1: DbBlock = {
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const dbTx1: DbTx = {
      ...mempoolTx1,
      ...dbBlock1,
      parent_burn_block_time: 1626122935,
      tx_index: 4,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const dataStoreUpdate1: DataStoreBlockUpdateData = {
      block: dbBlock1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx1,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    };
    await db.update(dataStoreUpdate1);

    const mempoolDroppedResult2 = await supertest(api.server).get(
      '/extended/v1/tx/mempool/dropped'
    );
    expect(mempoolDroppedResult2.status).toBe(200);
    expect(mempoolDroppedResult2.type).toBe('application/json');
    expect(mempoolDroppedResult2.body.results).toHaveLength(4);
    expect(mempoolDroppedResult2.body).toEqual(
      expect.objectContaining({
        results: expect.arrayContaining([
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
            tx_status: 'dropped_stale_garbage_collect',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
            tx_status: 'dropped_too_expensive',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
            tx_status: 'dropped_replace_by_fee',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
            tx_status: 'dropped_replace_across_fork',
          }),
        ]),
      })
    );
  });

  test('fetch mempool-tx list', async () => {
    for (let i = 0; i < 10; i++) {
      const mempoolTx: DbMempoolTx = {
        pruned: false,
        tx_id: `0x891200000000000000000000000000000000000000000000000000000000000${i}`,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: Buffer.from('test-raw-tx'),
        type_id: DbTxTypeId.Coinbase,
        receipt_time: (new Date(`2020-07-09T15:14:0${i}Z`).getTime() / 1000) | 0,
        coinbase_payload: Buffer.from('coinbase hi'),
        status: 1,
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: 'sender-addr',
        origin_hash_mode: 1,
      };
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    }
    const searchResult1 = await supertest(api.server).get(
      '/extended/v1/tx/mempool?limit=3&offset=2'
    );
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      limit: 3,
      offset: 2,
      total: 10,
      results: [
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000007',
          tx_status: 'pending',
          tx_type: 'coinbase',
          receipt_time: 1594307647,
          receipt_time_iso: '2020-07-09T15:14:07.000Z',
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: { data: '0x636f696e62617365206869' },
        },
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
          tx_status: 'pending',
          tx_type: 'coinbase',
          receipt_time: 1594307646,
          receipt_time_iso: '2020-07-09T15:14:06.000Z',
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: { data: '0x636f696e62617365206869' },
        },
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          tx_type: 'coinbase',
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: { data: '0x636f696e62617365206869' },
        },
      ],
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx list filtered', async () => {
    const sendAddr = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const recvAddr = 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC';
    const contractAddr = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const contractCallId = 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0';
    const stxTransfers: {
      sender: string;
      receiver: string;
      smart_contract_id?: string;
      smart_contract_source?: string;
      contract_call_id?: string;
      contract_call_function_name?: string;
      type_id: DbTxTypeId;
    }[] = new Array(5).fill({
      sender: 'sender-addr',
      receiver: 'receiver-addr',
      type_id: DbTxTypeId.TokenTransfer,
    });
    stxTransfers.push(
      {
        sender: sendAddr,
        receiver: recvAddr,
        type_id: DbTxTypeId.TokenTransfer,
      },
      {
        sender: sendAddr,
        receiver: 'testRecv1',
        type_id: DbTxTypeId.TokenTransfer,
      },
      {
        sender: 'testSend1',
        receiver: recvAddr,
        type_id: DbTxTypeId.TokenTransfer,
      },
      {
        sender: 'testSend1',
        receiver: 'testRecv1',
        contract_call_id: contractCallId,
        contract_call_function_name: 'mint',
        type_id: DbTxTypeId.ContractCall,
      },
      {
        sender: 'testSend1',
        receiver: 'testRecv1',
        smart_contract_id: contractAddr,
        smart_contract_source: '(define-public (say-hi) (ok "hello world"))',
        type_id: DbTxTypeId.SmartContract,
      },
      {
        sender: 'testSend1',
        receiver: contractCallId,
        type_id: DbTxTypeId.TokenTransfer,
      }
    );
    let index = 0;
    for (const xfer of stxTransfers) {
      const paddedIndex = ('00' + index).slice(-2);
      const mempoolTx: DbMempoolTx = {
        pruned: false,
        tx_id: `0x89120000000000000000000000000000000000000000000000000000000000${paddedIndex}`,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: Buffer.from('test-raw-tx'),
        type_id: xfer.type_id,
        receipt_time: (new Date(`2020-07-09T15:14:${paddedIndex}Z`).getTime() / 1000) | 0,
        status: 1,
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        origin_hash_mode: 1,
        sender_address: xfer.sender,
        token_transfer_recipient_address: xfer.receiver,
        token_transfer_amount: 1234n,
        token_transfer_memo: Buffer.alloc(0),
        contract_call_contract_id: xfer.contract_call_id,
        contract_call_function_name: xfer.contract_call_function_name,
        smart_contract_contract_id: xfer.smart_contract_id,
        smart_contract_source_code: xfer.smart_contract_source,
      };
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
      index++;
    }
    const searchResult1 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?sender_address=${sendAddr}`
    );
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      limit: 96,
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307646,
          receipt_time_iso: '2020-07-09T15:14:06.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'testRecv1',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?recipient_address=${recvAddr}`
    );
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      limit: 96,
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307647,
          receipt_time_iso: '2020-07-09T15:14:07.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000007',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    const searchResult3 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?sender_address=${sendAddr}&recipient_address=${recvAddr}&`
    );
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      limit: 96,
      offset: 0,
      total: 1,
      results: [
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    const searchResult4 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?address=${sendAddr}`
    );
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      limit: 96,
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307646,
          receipt_time_iso: '2020-07-09T15:14:06.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'testRecv1',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    const searchResult5 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?address=${contractCallId}`
    );
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      limit: 96,
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307650,
          receipt_time_iso: '2020-07-09T15:14:10.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000010',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307648,
          receipt_time_iso: '2020-07-09T15:14:08.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000008',
          tx_status: 'pending',
          tx_type: 'contract_call',
          contract_call: {
            contract_id: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
            function_name: 'mint',
            function_signature: '',
          },
        },
      ],
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    const searchResult6 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?address=${contractAddr}`
    );
    expect(searchResult6.status).toBe(200);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      limit: 96,
      offset: 0,
      total: 1,
      results: [
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307649,
          receipt_time_iso: '2020-07-09T15:14:09.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000009',
          tx_status: 'pending',
          tx_type: 'smart_contract',
          smart_contract: {
            contract_id: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
            source_code: '(define-public (say-hi) (ok "hello world"))',
          },
        },
      ],
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    const searchResult7 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?recipient_address=${contractCallId}`
    );
    expect(searchResult7.status).toBe(200);
    expect(searchResult7.type).toBe('application/json');
    const expectedResp7 = {
      limit: 96,
      offset: 0,
      total: 1,
      results: [
        {
          fee_rate: '1234',
          nonce: 0,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307650,
          receipt_time_iso: '2020-07-09T15:14:10.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '',
            recipient_address: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000010',
          tx_status: 'pending',
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult7.text)).toEqual(expectedResp7);
  });

  test('search term - hash', async () => {
    const block: DbBlock = {
      block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1235,
      burn_block_time: 94869286,
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
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);

    const mempoolTx: DbMempoolTx = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      receipt_time: 123456,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(
      `/extended/v1/search/0x1234000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      found: true,
      result: {
        entity_id: '0x1234000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'block_hash',
        block_data: {
          canonical: true,
          hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          parent_block_hash: '0xff0011',
          burn_block_time: 94869286,
          height: 1235,
        },
      },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    // test without 0x-prefix
    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/search/1234000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      found: true,
      result: {
        entity_id: '0x1234000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'block_hash',
        block_data: {
          canonical: true,
          hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          parent_block_hash: '0xff0011',
          burn_block_time: 94869286,
          height: 1235,
        },
      },
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    // test whitespace
    const searchResult3 = await supertest(api.server).get(
      `/extended/v1/search/ 1234000000000000000000000000000000000000000000000000000000000000 `
    );
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      found: true,
      result: {
        entity_id: '0x1234000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'block_hash',
        block_data: {
          canonical: true,
          hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          parent_block_hash: '0xff0011',
          burn_block_time: 94869286,
          height: 1235,
        },
      },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    // test tx search
    const searchResult4 = await supertest(api.server).get(
      `/extended/v1/search/0x4567000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      found: true,
      result: {
        entity_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'tx_id',
        tx_data: {
          canonical: true,
          block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          burn_block_time: 2837565,
          block_height: 68456,
          tx_type: 'coinbase',
        },
      },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    // test mempool tx search
    const searchResult5 = await supertest(api.server).get(
      `/extended/v1/search/0x8912000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      found: true,
      result: {
        entity_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'mempool_tx_id',
        tx_data: { tx_type: 'coinbase' },
      },
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    // test hash not found
    const searchResult6 = await supertest(api.server).get(
      `/extended/v1/search/0x1111000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult6.status).toBe(404);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      found: false,
      result: { entity_type: 'unknown_hash' },
      error:
        'No block or transaction found with hash "0x1111000000000000000000000000000000000000000000000000000000000000"',
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    // test invalid hash hex
    const invalidHex = '0x1111w00000000000000000000000000000000000000000000000000000000000';
    const searchResult7 = await supertest(api.server).get(`/extended/v1/search/${invalidHex}`);
    expect(searchResult7.status).toBe(404);
    expect(searchResult7.type).toBe('application/json');
    const expectedResp7 = {
      found: false,
      result: { entity_type: 'invalid_term' },
      error:
        'The term "0x1111w00000000000000000000000000000000000000000000000000000000000" is not a valid block hash, transaction ID, contract principal, or account address principal',
    };
    expect(JSON.parse(searchResult7.text)).toEqual(expectedResp7);
  });

  test('search term - principal', async () => {
    const addr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const addr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const addr3 = 'ST37VASHEJRMFRS91GWK1HZZKKEYQTEP85ARXCQPH';
    const addr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
    const addr5 = 'ST3YKTGBCY1BNKN6J18A3QKAX7CE36SZH3A5XN9ZQ';
    const addr6 = 'SZ2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQ9H6DPR';
    const addr7 = 'SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQVX8X0G';
    const addr8 = 'ST3AMFNNS7KBQ28ECMJMN2G3AGJ37SSA2HSY82CMH';
    const addr9 = 'STAR26VJ4BC24SMNKRY533MAM0K3JA5ZJDVBD45A';
    const addr10 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const addr11 = 'ST3R34339DRYJ7V6E4Y78P9ZQYRJ7D68SG2RYDEEX';
    const addr12 = 'STG087YK10C83YJVPGSVZA7276A9REH656HCAKPT';
    const addr13 = 'ST2WVE3HKMQ7YQ6QMRDM8QE6S9G9CG9JNXD0A4P8W';
    const contractAddr1 = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const contractAddr2 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name';
    const contractAddr3 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.test-contract';

    const stxTx1: DbTx = {
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: 'none',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: addr1,
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, stxTx1);

    // test address as a tx sender
    const searchResult1 = await supertest(api.server).get(`/extended/v1/search/${addr1}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr1,
      },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    const stxTx2: DbTx = {
      tx_id: '0x2222000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: addr2,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'none',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, stxTx2);

    // test address as a stx tx recipient
    const searchResult2 = await supertest(api.server).get(`/extended/v1/search/${addr2}`);
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr2,
      },
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    const stxEvent1: DbStxEvent = {
      canonical: true,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      amount: 1n,
      recipient: addr3,
      sender: 'none',
    };
    await db.updateStxEvent(client, stxTx1, stxEvent1);

    // test address as a stx event recipient
    const searchResult3 = await supertest(api.server).get(`/extended/v1/search/${addr3}`);
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr3,
      },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    const stxEvent2: DbStxEvent = {
      canonical: true,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      amount: 1n,
      recipient: 'none',
      sender: addr4,
    };
    await db.updateStxEvent(client, stxTx1, stxEvent2);

    // test address as a stx event sender
    const searchResult4 = await supertest(api.server).get(`/extended/v1/search/${addr4}`);
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr4,
      },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    const ftEvent1: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      amount: 1n,
      recipient: addr5,
      sender: 'none',
    };
    await db.updateFtEvent(client, stxTx1, ftEvent1);

    // test address as a ft event recipient
    const searchResult5 = await supertest(api.server).get(`/extended/v1/search/${addr5}`);
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr5,
      },
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    const ftEvent2: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      amount: 1n,
      recipient: 'none',
      sender: addr6,
    };
    await db.updateFtEvent(client, stxTx1, ftEvent2);

    // test address as a ft event sender
    const searchResult6 = await supertest(api.server).get(`/extended/v1/search/${addr6}`);
    expect(searchResult6.status).toBe(200);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr6,
      },
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    const nftEvent1: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      value: serializeCV(intCV(0)),
      recipient: addr7,
      sender: 'none',
    };
    await db.updateNftEvent(client, stxTx1, nftEvent1);

    // test address as a nft event recipient
    const searchResult7 = await supertest(api.server).get(`/extended/v1/search/${addr7}`);
    expect(searchResult7.status).toBe(200);
    expect(searchResult7.type).toBe('application/json');
    const expectedResp7 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr7,
      },
    };
    expect(JSON.parse(searchResult7.text)).toEqual(expectedResp7);

    const nftEvent2: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      value: serializeCV(intCV(0)),
      recipient: 'none',
      sender: addr8,
    };
    await db.updateNftEvent(client, stxTx1, nftEvent2);

    // test address as a nft event sender
    const searchResult8 = await supertest(api.server).get(`/extended/v1/search/${addr8}`);
    expect(searchResult8.status).toBe(200);
    expect(searchResult8.type).toBe('application/json');
    const expectedResp8 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr8,
      },
    };
    expect(JSON.parse(searchResult8.text)).toEqual(expectedResp8);

    const smartContract: DbTx = {
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      smart_contract_contract_id: contractAddr1,
      smart_contract_source_code: '(some-src)',
      block_height: 1,
      tx_index: 0,
      index_block_hash: '0x543288',
      block_hash: '0x9876',
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'none',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, smartContract);

    // test contract address
    const searchResult9 = await supertest(api.server).get(`/extended/v1/search/${contractAddr1}`);
    expect(searchResult9.status).toBe(200);
    expect(searchResult9.type).toBe('application/json');
    const expectedResp9 = {
      found: true,
      result: {
        entity_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
        entity_type: 'contract_address',
        tx_data: {
          canonical: true,
          block_hash: '0x9876',
          burn_block_time: 2837565,
          block_height: 1,
          tx_type: 'smart_contract',
          tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
        },
      },
    };
    expect(JSON.parse(searchResult9.text)).toEqual(expectedResp9);

    const smartContractMempoolTx: DbMempoolTx = {
      pruned: false,
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      receipt_time: 123456,
      smart_contract_contract_id: contractAddr2,
      smart_contract_source_code: '(some-src)',
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'none',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [smartContractMempoolTx] });

    // test contract address associated with mempool tx
    const searchResult10 = await supertest(api.server).get(`/extended/v1/search/${contractAddr2}`);
    expect(searchResult10.status).toBe(200);
    expect(searchResult10.type).toBe('application/json');
    const expectedResp10 = {
      found: true,
      result: {
        entity_id: 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name',
        entity_type: 'contract_address',
        tx_data: {
          tx_type: 'smart_contract',
          tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
        },
      },
    };
    expect(JSON.parse(searchResult10.text)).toEqual(expectedResp10);

    // test contract address not found
    const searchResult11 = await supertest(api.server).get(`/extended/v1/search/${contractAddr3}`);
    expect(searchResult11.status).toBe(404);
    expect(searchResult11.type).toBe('application/json');
    const expectedResp11 = {
      found: false,
      result: { entity_type: 'contract_address' },
      error:
        'No principal found with address "STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.test-contract"',
    };
    expect(JSON.parse(searchResult11.text)).toEqual(expectedResp11);

    // test standard address not found
    const searchResult12 = await supertest(api.server).get(`/extended/v1/search/${addr9}`);
    expect(searchResult12.status).toBe(404);
    expect(searchResult12.type).toBe('application/json');
    const expectedResp12 = {
      found: false,
      result: { entity_type: 'standard_address' },
      error: 'No principal found with address "STAR26VJ4BC24SMNKRY533MAM0K3JA5ZJDVBD45A"',
    };
    expect(JSON.parse(searchResult12.text)).toEqual(expectedResp12);

    // test invalid term
    const invalidTerm = 'bogus123';
    const searchResult13 = await supertest(api.server).get(`/extended/v1/search/${invalidTerm}`);
    expect(searchResult13.status).toBe(404);
    expect(searchResult13.type).toBe('application/json');
    const expectedResp13 = {
      found: false,
      result: { entity_type: 'invalid_term' },
      error:
        'The term "bogus123" is not a valid block hash, transaction ID, contract principal, or account address principal',
    };
    expect(JSON.parse(searchResult13.text)).toEqual(expectedResp13);
  });

  test('address transaction transfers', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
    const testTxId = '0x12340006';

    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x2345',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 100123123,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 100123123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateBlock(client, block);

    let indexIdIndex = 0;
    const createStxTx = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true,
      stxEventCount = 1,
      ftEventCount = 1,
      nftEventCount = 1
    ): [DbTx, DbStxEvent[], DbFtEvent[], DbNftEvent[]] => {
      const tx: DbTx = {
        tx_id: '0x1234' + (++indexIdIndex).toString().padStart(4, '0'),
        tx_index: indexIdIndex,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: Buffer.alloc(0),
        index_block_hash: '0x5432',
        block_hash: '0x9876',
        block_height: 68456,
        burn_block_time: 1594647994,
        parent_burn_block_time: 1626122935,
        type_id: DbTxTypeId.TokenTransfer,
        token_transfer_amount: BigInt(amount),
        token_transfer_memo: Buffer.from('hi'),
        token_transfer_recipient_address: recipient,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical,
        microblock_canonical: true,
        microblock_sequence: I32_MAX,
        microblock_hash: '',
        parent_index_block_hash: '',
        parent_block_hash: '',
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: sender,
        origin_hash_mode: 1,
        event_count: 0,
        execution_cost_read_count: 1,
        execution_cost_read_length: 2,
        execution_cost_runtime: 3,
        execution_cost_write_count: 4,
        execution_cost_write_length: 5,
      };
      const stxEvents: DbStxEvent[] = [];
      for (let i = 0; i < stxEventCount; i++) {
        const stxEvent: DbStxEvent = {
          canonical,
          event_type: DbEventTypeId.StxAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: i,
          tx_id: tx.tx_id,
          tx_index: tx.tx_index,
          block_height: tx.block_height,
          amount: BigInt(amount),
          recipient,
          sender,
        };
        stxEvents.push(stxEvent);
      }
      const ftEvents: DbFtEvent[] = [];
      for (let i = 0; i < ftEventCount; i++) {
        const ftEvent: DbFtEvent = {
          canonical,
          event_type: DbEventTypeId.FungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          asset_identifier: 'usdc',
          event_index: i,
          tx_id: tx.tx_id,
          tx_index: tx.tx_index,
          block_height: tx.block_height,
          amount: BigInt(amount),
          recipient,
          sender,
        };
        ftEvents.push(ftEvent);
      }
      const nftEvents: DbNftEvent[] = [];
      for (let i = 0; i < nftEventCount; i++) {
        const nftEvent: DbNftEvent = {
          canonical,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          asset_identifier: 'punk1',
          event_index: i,
          tx_id: tx.tx_id,
          tx_index: tx.tx_index,
          block_height: tx.block_height,
          value: Buffer.from(amount.toString()),
          recipient,
          sender,
        };
        nftEvents.push(nftEvent);
      }
      return [tx, stxEvents, ftEvents, nftEvents];
    };

    const txs = [
      createStxTx(testAddr1, testAddr2, 100_000, true, 1, 1, 1),
      createStxTx(testAddr2, testContractAddr, 100, true, 1, 2, 1),
      createStxTx(testAddr2, testContractAddr, 250, true, 1, 0, 1),
      createStxTx(testAddr2, testContractAddr, 40, false, 1, 1, 1),
      createStxTx(testContractAddr, testAddr4, 15, true, 1, 1, 0),
      createStxTx(testAddr2, testAddr4, 35, true, 3, 1, 2),
    ];
    for (const [tx, stxEvents, ftEvents, nftEvents] of txs) {
      await db.updateTx(client, tx);
      for (const event of stxEvents) {
        await db.updateStxEvent(client, tx, event);
      }
      for (const event of ftEvents) {
        await db.updateFtEvent(client, tx, event);
      }
      for (const event of nftEvents) {
        await db.updateNftEvent(client, tx, event);
      }
    }

    const fetch1 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/transactions_with_transfers?limit=3&offset=0`
    );
    expect(fetch1.status).toBe(200);
    expect(fetch1.type).toBe('application/json');
    const expected1 = {
      limit: 3,
      offset: 0,
      total: 4,
      results: [
        {
          tx: {
            tx_id: '0x12340006',
            tx_type: 'token_transfer',
            nonce: 0,
            anchor_mode: 'any',
            fee_rate: '1234',
            is_unanchored: false,
            sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            sponsored: false,
            post_condition_mode: 'allow',
            post_conditions: [],
            tx_status: 'success',
            block_hash: '0x9876',
            block_height: 68456,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '',
            microblock_sequence: I32_MAX,
            parent_block_hash: '',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 6,
            tx_result: { hex: '0x0100000000000000000000000000000001', repr: 'u1' },
            token_transfer: {
              recipient_address: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              amount: '35',
              memo: '0x6869',
            },
            events: [],
            event_count: 0,
            execution_cost_read_count: 1,
            execution_cost_read_length: 2,
            execution_cost_runtime: 3,
            execution_cost_write_count: 4,
            execution_cost_write_length: 5,
          },
          stx_sent: '1339',
          stx_received: '0',
          stx_transfers: [
            {
              amount: '35',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
            {
              amount: '35',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
            {
              amount: '35',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
          ],
          ft_transfers: [
            {
              amount: '35',
              asset_identifier: 'usdc',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
          ],
          nft_transfers: [
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              value: '35',
            },
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              value: '35',
            },
          ],
        },
        {
          tx: {
            tx_id: '0x12340003',
            tx_type: 'token_transfer',
            nonce: 0,
            anchor_mode: 'any',
            fee_rate: '1234',
            is_unanchored: false,
            sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            sponsored: false,
            post_condition_mode: 'allow',
            post_conditions: [],
            tx_status: 'success',
            block_hash: '0x9876',
            block_height: 68456,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '',
            microblock_sequence: I32_MAX,
            parent_block_hash: '',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 3,
            tx_result: { hex: '0x0100000000000000000000000000000001', repr: 'u1' },
            token_transfer: {
              recipient_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
              amount: '250',
              memo: '0x6869',
            },
            events: [],
            event_count: 0,
            execution_cost_read_count: 1,
            execution_cost_read_length: 2,
            execution_cost_runtime: 3,
            execution_cost_write_count: 4,
            execution_cost_write_length: 5,
          },
          stx_sent: '1484',
          stx_received: '0',
          stx_transfers: [
            {
              amount: '250',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            },
          ],
          ft_transfers: [],
          nft_transfers: [
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
              value: '250',
            },
          ],
        },
        {
          tx: {
            tx_id: '0x12340002',
            tx_type: 'token_transfer',
            nonce: 0,
            anchor_mode: 'any',
            fee_rate: '1234',
            is_unanchored: false,
            sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            sponsored: false,
            post_condition_mode: 'allow',
            post_conditions: [],
            tx_status: 'success',
            block_hash: '0x9876',
            block_height: 68456,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '',
            microblock_sequence: I32_MAX,
            parent_block_hash: '',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 2,
            tx_result: { hex: '0x0100000000000000000000000000000001', repr: 'u1' },
            token_transfer: {
              recipient_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
              amount: '100',
              memo: '0x6869',
            },
            events: [],
            event_count: 0,
            execution_cost_read_count: 1,
            execution_cost_read_length: 2,
            execution_cost_runtime: 3,
            execution_cost_write_count: 4,
            execution_cost_write_length: 5,
          },
          stx_sent: '1334',
          stx_received: '0',
          stx_transfers: [
            {
              amount: '100',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            },
          ],
          ft_transfers: [
            {
              amount: '100',
              asset_identifier: 'usdc',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            },
            {
              amount: '100',
              asset_identifier: 'usdc',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            },
          ],
          nft_transfers: [
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
              value: '100',
            },
          ],
        },
      ],
    };
    expect(JSON.parse(fetch1.text)).toEqual(expected1);

    // testing single txs information based on given tx_id
    const fetchSingleTxInformation = await supertest(api.server).get(
      `/extended/v1/address/${testAddr4}/${testTxId}/with_transfers`
    );
    expect(fetchSingleTxInformation.status).toBe(200);
    expect(fetchSingleTxInformation.type).toBe('application/json');
    const expectedSingleTxInformation = {
      tx: {
        tx_id: '0x12340006',
        tx_type: 'token_transfer',
        nonce: 0,
        anchor_mode: 'any',
        fee_rate: '1234',
        is_unanchored: false,
        sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
        sponsored: false,
        post_condition_mode: 'allow',
        post_conditions: [],
        tx_status: 'success',
        block_hash: '0x9876',
        block_height: 68456,
        burn_block_time: 1594647994,
        burn_block_time_iso: '2020-07-13T13:46:34.000Z',
        canonical: true,
        microblock_canonical: true,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        parent_block_hash: '',
        parent_burn_block_time: 1626122935,
        parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
        tx_index: 6,
        tx_result: { hex: '0x0100000000000000000000000000000001', repr: 'u1' },
        token_transfer: {
          recipient_address: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
          amount: '35',
          memo: '0x6869',
        },
        events: [],
        event_count: 0,
        execution_cost_read_count: 1,
        execution_cost_read_length: 2,
        execution_cost_runtime: 3,
        execution_cost_write_count: 4,
        execution_cost_write_length: 5,
      },
      stx_sent: '0',
      stx_received: '105',
      stx_transfers: [
        {
          amount: '35',
          sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
        },
        {
          amount: '35',
          sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
        },
        {
          amount: '35',
          sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
        },
      ],
    };
    expect(JSON.parse(fetchSingleTxInformation.text)).toEqual(expectedSingleTxInformation);

    // testing for multiple tx_ids given a single stx addr
    const fetch2 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr4}/transactions_with_transfers`
    );
    expect(fetch2.status).toBe(200);
    expect(fetch2.type).toBe('application/json');
    const expected2 = {
      limit: 20,
      offset: 0,
      total: 2,
      results: [
        {
          tx: {
            tx_id: '0x12340006',
            tx_type: 'token_transfer',
            nonce: 0,
            anchor_mode: 'any',
            fee_rate: '1234',
            is_unanchored: false,
            sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            sponsored: false,
            post_condition_mode: 'allow',
            post_conditions: [],
            tx_status: 'success',
            block_hash: '0x9876',
            block_height: 68456,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '',
            microblock_sequence: I32_MAX,
            parent_block_hash: '',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 6,
            tx_result: { hex: '0x0100000000000000000000000000000001', repr: 'u1' },
            token_transfer: {
              recipient_address: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              amount: '35',
              memo: '0x6869',
            },
            events: [],
            event_count: 0,
            execution_cost_read_count: 1,
            execution_cost_read_length: 2,
            execution_cost_runtime: 3,
            execution_cost_write_count: 4,
            execution_cost_write_length: 5,
          },
          stx_sent: '0',
          stx_received: '105',
          stx_transfers: [
            {
              amount: '35',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
            {
              amount: '35',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
            {
              amount: '35',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
          ],
          ft_transfers: [
            {
              amount: '35',
              asset_identifier: 'usdc',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
          ],
          nft_transfers: [
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              value: '35',
            },
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              value: '35',
            },
          ],
        },
        {
          tx: {
            tx_id: '0x12340005',
            tx_type: 'token_transfer',
            nonce: 0,
            anchor_mode: 'any',
            fee_rate: '1234',
            is_unanchored: false,
            sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            sponsored: false,
            post_condition_mode: 'allow',
            post_conditions: [],
            tx_status: 'success',
            block_hash: '0x9876',
            block_height: 68456,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '',
            microblock_sequence: I32_MAX,
            parent_block_hash: '',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 5,
            tx_result: { hex: '0x0100000000000000000000000000000001', repr: 'u1' },
            token_transfer: {
              recipient_address: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              amount: '15',
              memo: '0x6869',
            },
            events: [],
            event_count: 0,
            execution_cost_read_count: 1,
            execution_cost_read_length: 2,
            execution_cost_runtime: 3,
            execution_cost_write_count: 4,
            execution_cost_write_length: 5,
          },
          stx_sent: '0',
          stx_received: '15',
          stx_transfers: [
            {
              amount: '15',
              sender: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
          ],
          ft_transfers: [
            {
              amount: '15',
              asset_identifier: 'usdc',
              sender: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            },
          ],
          nft_transfers: [],
        },
      ],
    };
    expect(JSON.parse(fetch2.text)).toEqual(expected2);
  });

  test('address info', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';

    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x2345',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 100123123,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 100123123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateBlock(client, block);

    let indexIdIndex = 0;
    const createStxTx = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true
    ): DbTx => {
      const tx: DbTx = {
        tx_id: '0x1234' + (++indexIdIndex).toString().padStart(4, '0'),
        tx_index: indexIdIndex,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: Buffer.alloc(0),
        index_block_hash: '0x5432',
        block_hash: '0x9876',
        block_height: 68456,
        burn_block_time: 1594647994,
        parent_burn_block_time: 1626122935,
        type_id: DbTxTypeId.TokenTransfer,
        token_transfer_amount: BigInt(amount),
        token_transfer_memo: Buffer.from('hi'),
        token_transfer_recipient_address: recipient,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical,
        microblock_canonical: true,
        microblock_sequence: I32_MAX,
        microblock_hash: '',
        parent_index_block_hash: '',
        parent_block_hash: '',
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: sender,
        origin_hash_mode: 1,
        event_count: 0,
        execution_cost_read_count: 0,
        execution_cost_read_length: 0,
        execution_cost_runtime: 0,
        execution_cost_write_count: 0,
        execution_cost_write_length: 0,
      };
      return tx;
    };

    const txs = [
      createStxTx(testAddr1, testAddr2, 100_000),
      createStxTx(testAddr2, testContractAddr, 100),
      createStxTx(testAddr2, testContractAddr, 250),
      createStxTx(testAddr2, testContractAddr, 40, false),
      createStxTx(testContractAddr, testAddr4, 15),
      createStxTx(testAddr2, testAddr4, 35),
    ];
    for (const tx of txs) {
      await db.updateTx(client, tx);
    }

    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 1594647994,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: testAddr1,
      origin_hash_mode: 1,
      event_count: 5,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const createStxEvent = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true
    ): DbStxEvent => {
      const stxEvent: DbStxEvent = {
        canonical,
        event_type: DbEventTypeId.StxAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: 0,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        block_height: tx.block_height,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return stxEvent;
    };
    const events = [
      createStxEvent(testAddr1, testAddr2, 100_000),
      createStxEvent(testAddr2, testContractAddr, 100),
      createStxEvent(testAddr2, testContractAddr, 1250),
      createStxEvent(testAddr2, testContractAddr, 40, false),
      createStxEvent(testContractAddr, testAddr4, 15),
      createStxEvent(testAddr2, testAddr4, 35),
    ];
    for (const event of events) {
      await db.updateStxEvent(client, tx, event);
    }

    const createFtEvent = (
      sender: string,
      recipient: string,
      assetId: string,
      amount: number,
      canonical: boolean = true
    ): DbFtEvent => {
      const ftEvent: DbFtEvent = {
        canonical,
        event_type: DbEventTypeId.FungibleTokenAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: 0,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        block_height: tx.block_height,
        asset_identifier: assetId,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return ftEvent;
    };
    const ftEvents = [
      createFtEvent(testAddr1, testAddr2, 'bux', 100_000),
      createFtEvent(testAddr2, testContractAddr, 'bux', 100),
      createFtEvent(testAddr2, testContractAddr, 'bux', 250),
      createFtEvent(testAddr2, testContractAddr, 'bux', 40, false),
      createFtEvent(testContractAddr, testAddr4, 'bux', 15),
      createFtEvent(testAddr2, testAddr4, 'bux', 35),
      createFtEvent(testAddr1, testAddr2, 'gox', 200_000),
      createFtEvent(testAddr2, testContractAddr, 'gox', 200),
      createFtEvent(testAddr2, testContractAddr, 'gox', 350),
      createFtEvent(testAddr2, testContractAddr, 'gox', 60, false),
      createFtEvent(testContractAddr, testAddr4, 'gox', 25),
      createFtEvent(testAddr2, testAddr4, 'gox', 75),
      createFtEvent(testAddr1, testAddr2, 'cash', 500_000),
      createFtEvent(testAddr2, testAddr1, 'tendies', 1_000_000),
    ];
    for (const event of ftEvents) {
      await db.updateFtEvent(client, tx, event);
    }

    const createNFtEvents = (
      sender: string,
      recipient: string,
      assetId: string,
      count: number,
      canonical: boolean = true
    ): DbNftEvent[] => {
      const events: DbNftEvent[] = [];
      for (let i = 0; i < count; i++) {
        const nftEvent: DbNftEvent = {
          canonical,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: 0,
          tx_id: tx.tx_id,
          tx_index: tx.tx_index,
          block_height: tx.block_height,
          asset_identifier: assetId,
          value: serializeCV(intCV(0)),
          recipient,
          sender,
        };
        events.push(nftEvent);
      }
      return events;
    };
    const nftEvents = [
      createNFtEvents(testAddr1, testAddr2, 'bux', 300),
      createNFtEvents(testAddr2, testContractAddr, 'bux', 10),
      createNFtEvents(testAddr2, testContractAddr, 'bux', 25),
      createNFtEvents(testAddr2, testContractAddr, 'bux', 4, false),
      createNFtEvents(testContractAddr, testAddr4, 'bux', 1),
      createNFtEvents(testAddr2, testAddr4, 'bux', 3),
      createNFtEvents(testAddr1, testAddr2, 'gox', 200),
      createNFtEvents(testAddr2, testContractAddr, 'gox', 20),
      createNFtEvents(testAddr2, testContractAddr, 'gox', 35),
      createNFtEvents(testAddr2, testContractAddr, 'gox', 6, false),
      createNFtEvents(testContractAddr, testAddr4, 'gox', 2),
      createNFtEvents(testAddr2, testAddr4, 'gox', 7),
      createNFtEvents(testAddr1, testAddr2, 'cash', 500),
      createNFtEvents(testAddr2, testAddr1, 'tendies', 100),
    ];
    for (const event of nftEvents.flat()) {
      await db.updateNftEvent(client, tx, event);
    }

    const tokenOfferingLocked: DbTokenOfferingLocked = {
      address: testAddr2,
      value: BigInt(4139394444),
      block: 33477,
    };
    await db.updateBatchTokenOfferingLocked(client, [tokenOfferingLocked]);

    const fetchAddrBalance1 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/balances`
    );
    expect(fetchAddrBalance1.status).toBe(200);
    expect(fetchAddrBalance1.type).toBe('application/json');
    const expectedResp1 = {
      stx: {
        balance: '94913',
        total_sent: '1385',
        total_received: '100000',
        total_fees_sent: '3702',
        total_miner_rewards_received: '0',
        burnchain_lock_height: 0,
        burnchain_unlock_height: 0,
        lock_height: 0,
        lock_tx_id: '',
        locked: '0',
      },
      fungible_tokens: {
        bux: { balance: '99615', total_sent: '385', total_received: '100000' },
        cash: { balance: '500000', total_sent: '0', total_received: '500000' },
        gox: { balance: '199375', total_sent: '625', total_received: '200000' },
        tendies: { balance: '-1000000', total_sent: '1000000', total_received: '0' },
      },
      non_fungible_tokens: {
        bux: { count: '262', total_sent: '38', total_received: '300' },
        cash: { count: '500', total_sent: '0', total_received: '500' },
        gox: { count: '138', total_sent: '62', total_received: '200' },
        tendies: { count: '-100', total_sent: '100', total_received: '0' },
      },
      token_offering_locked: {
        total_locked: '0',
        total_unlocked: '4139394444',
        unlock_schedule: [
          {
            amount: '4139394444',
            block_height: 33477,
          },
        ],
      },
    };
    expect(JSON.parse(fetchAddrBalance1.text)).toEqual(expectedResp1);

    const fetchAddrBalance2 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/balances`
    );
    expect(fetchAddrBalance2.status).toBe(200);
    expect(fetchAddrBalance2.type).toBe('application/json');
    const expectedResp2 = {
      stx: {
        balance: '101',
        total_sent: '15',
        total_received: '1350',
        total_fees_sent: '1234',
        total_miner_rewards_received: '0',
        burnchain_lock_height: 0,
        burnchain_unlock_height: 0,
        lock_height: 0,
        lock_tx_id: '',
        locked: '0',
      },
      fungible_tokens: {
        bux: { balance: '335', total_sent: '15', total_received: '350' },
        gox: { balance: '525', total_sent: '25', total_received: '550' },
      },
      non_fungible_tokens: {
        bux: { count: '34', total_sent: '1', total_received: '35' },
        gox: { count: '53', total_sent: '2', total_received: '55' },
      },
    };
    expect(JSON.parse(fetchAddrBalance2.text)).toEqual(expectedResp2);

    const tokenLocked: DbTokenOfferingLocked = {
      address: testContractAddr,
      value: BigInt(4139391122),
      block: 20477,
    };

    await db.updateBatchTokenOfferingLocked(client, [tokenLocked]);
    const fetchAddrStxBalance1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/stx`
    );
    expect(fetchAddrStxBalance1.status).toBe(200);
    expect(fetchAddrStxBalance1.type).toBe('application/json');
    const expectedStxResp1 = {
      balance: '101',
      total_sent: '15',
      total_received: '1350',
      total_fees_sent: '1234',
      total_miner_rewards_received: '0',
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
      lock_height: 0,
      lock_tx_id: '',
      locked: '0',
      token_offering_locked: {
        total_locked: '0',
        total_unlocked: '4139391122',
        unlock_schedule: [
          {
            amount: '4139391122',
            block_height: 20477,
          },
        ],
      },
    };
    expect(JSON.parse(fetchAddrStxBalance1.text)).toEqual(expectedStxResp1);

    const fetchAddrAssets1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/assets?limit=8&offset=2`
    );
    expect(fetchAddrAssets1.status).toBe(200);
    expect(fetchAddrAssets1.type).toBe('application/json');
    const expectedResp3 = {
      limit: 8,
      offset: 2,
      total: 102,
      results: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '100',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '250',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            amount: '15',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'gox',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '200',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'gox',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '350',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'gox',
            sender: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            amount: '25',
          },
        },
        {
          event_index: 0,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
          },
        },
        {
          event_index: 0,
          event_type: 'stx_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '100',
          },
        },
      ],
    };
    expect(JSON.parse(fetchAddrAssets1.text)).toEqual(expectedResp3);

    const fetchAddrTx1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/transactions`
    );
    expect(fetchAddrTx1.status).toBe(200);
    expect(fetchAddrTx1.type).toBe('application/json');
    const expectedResp4 = {
      limit: 20,
      offset: 0,
      total: 3,
      results: [
        {
          tx_id: '0x12340005',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'token_transfer',
          fee_rate: '1234',
          is_unanchored: false,
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          block_hash: '0x9876',
          block_height: 68456,
          burn_block_time: 1594647994,
          burn_block_time_iso: '2020-07-13T13:46:34.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '',
          microblock_sequence: I32_MAX,
          parent_block_hash: '',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          tx_index: 5,
          token_transfer: {
            recipient_address: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            amount: '15',
            memo: '0x6869',
          },
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        },
        {
          tx_id: '0x12340003',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'token_transfer',
          fee_rate: '1234',
          is_unanchored: false,
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          block_hash: '0x9876',
          block_height: 68456,
          burn_block_time: 1594647994,
          burn_block_time_iso: '2020-07-13T13:46:34.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '',
          microblock_sequence: I32_MAX,
          parent_block_hash: '',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          tx_index: 3,
          token_transfer: {
            recipient_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '250',
            memo: '0x6869',
          },
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        },
        {
          tx_id: '0x12340002',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'token_transfer',
          fee_rate: '1234',
          is_unanchored: false,
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          block_hash: '0x9876',
          block_height: 68456,
          burn_block_time: 1594647994,
          burn_block_time_iso: '2020-07-13T13:46:34.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '',
          microblock_sequence: I32_MAX,
          parent_block_hash: '',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          tx_index: 2,
          token_transfer: {
            recipient_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '100',
            memo: '0x6869',
          },
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        },
      ],
    };
    expect(JSON.parse(fetchAddrTx1.text)).toEqual(expectedResp4);
  });

  test('list contract log events', async () => {
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
    const tx1: DbTx = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
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
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx2: DbTx = {
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
      value: serializeCV(bufferCVFromString('some val')),
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block1.block_height,
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
        },
      ],
    });

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
  });

  test('getTxList() returns object', async () => {
    const expectedResp = {
      limit: 96,
      offset: 0,
      results: [],
      total: 0,
    };
    const fetchTx = await supertest(api.server).get('/extended/v1/tx/');
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('block store and process', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1235,
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
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x1234',
      anchor_mode: 3,
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);

    const blockQuery = await getBlockFromDataStore({
      blockIdentifer: { hash: block.block_hash },
      db,
    });
    if (!blockQuery.found) {
      throw new Error('block not found');
    }

    const expectedResp = {
      burn_block_time: 1594647996,
      burn_block_time_iso: '2020-07-13T13:46:36.000Z',
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      hash: '0x1234',
      height: 1235,
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      txs: ['0x1234'],
      microblocks_accepted: [],
      microblocks_streamed: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    expect(blockQuery.result).toEqual(expectedResp);

    const fetchBlockByHash = await supertest(api.server).get(
      `/extended/v1/block/${block.block_hash}`
    );
    expect(fetchBlockByHash.status).toBe(200);
    expect(fetchBlockByHash.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHash.text)).toEqual(expectedResp);

    const fetchBlockByHeight = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block.block_height}`
    );
    expect(fetchBlockByHeight.status).toBe(200);
    expect(fetchBlockByHeight.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHeight.text)).toEqual(expectedResp);

    const fetchBlockByBurnBlockHeight = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/${block.burn_block_height}`
    );
    expect(fetchBlockByBurnBlockHeight.status).toBe(200);
    expect(fetchBlockByBurnBlockHeight.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByBurnBlockHeight.text)).toEqual(expectedResp);

    const fetchBlockByInvalidBurnBlockHeight1 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/999`
    );
    expect(fetchBlockByInvalidBurnBlockHeight1.status).toBe(404);
    expect(fetchBlockByInvalidBurnBlockHeight1.type).toBe('application/json');
    const expectedResp1 = {
      error: 'cannot find block by height 999',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight1.text)).toEqual(expectedResp1);

    const fetchBlockByInvalidBurnBlockHeight2 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/abc`
    );
    expect(fetchBlockByInvalidBurnBlockHeight2.status).toBe(400);
    expect(fetchBlockByInvalidBurnBlockHeight2.type).toBe('application/json');
    const expectedResp2 = {
      error: 'burnchain height is not a valid integer: abc',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight2.text)).toEqual(expectedResp2);

    const fetchBlockByInvalidBurnBlockHeight3 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/0`
    );
    expect(fetchBlockByInvalidBurnBlockHeight3.status).toBe(400);
    expect(fetchBlockByInvalidBurnBlockHeight3.type).toBe('application/json');
    const expectedResp3 = {
      error: 'burnchain height is not a positive integer: 0',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight3.text)).toEqual(expectedResp3);

    const fetchBlockByBurnBlockHash = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_hash/${block.burn_block_hash}`
    );
    expect(fetchBlockByBurnBlockHash.status).toBe(200);
    expect(fetchBlockByBurnBlockHash.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByBurnBlockHash.text)).toEqual(expectedResp);

    const fetchBlockByInvalidBurnBlockHash = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_hash/0x000000`
    );
    expect(fetchBlockByInvalidBurnBlockHash.status).toBe(404);
    expect(fetchBlockByInvalidBurnBlockHash.type).toBe('application/json');
    const expectedResp4 = {
      error: 'cannot find block by burn block hash 0x000000',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHash.text)).toEqual(expectedResp4);
  });

  test('tx - sponsored', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: BigInt(556) }],
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      nonce: new BN(0),
      sponsored: true,
      anchorMode: AnchorMode.Any,
    });
    const sponsoredTx = await sponsorTransaction({
      transaction: txBuilder,
      sponsorPrivateKey: '381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301',
      fee: new BN(300),
      sponsorNonce: new BN(2),
    });
    const serialized = sponsoredTx.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.updateTx(client, dbTx);
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    await db.updateSmartContract(client, dbTx, {
      tx_id: dbTx.tx_id,
      canonical: true,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: dbBlock.block_height,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    });
    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0xc889d593d349834e100f63cf58975b6aa2787d6f3784a26f5654221e38f75b05',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'contract_call',
      fee_rate: '200',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: true,
      post_condition_mode: 'deny',
      post_conditions: [],
      contract_call: {
        contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
        function_name: 'fn-name',
        function_signature: '(define-public (fn-name (arg1 int)))',
        function_args: [
          { hex: '0x000000000000000000000000000000022c', repr: '556', name: 'arg1', type: 'int' },
        ],
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);

    const pc1 = createNonFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      NonFungibleConditionCode.Owns,
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello::asset-name',
      bufferCVFromString('asset-value')
    );

    const pc2 = createFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.GreaterEqual,
      new BN(123456),
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello-ft::asset-name-ft'
    );

    const pc3 = createSTXPostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.LessEqual,
      new BN(36723458)
    );

    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: BigInt(556) }],
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [pc1, pc2, pc3],
      nonce: new BN(0),
      anchorMode: AnchorMode.Any,
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: 1594647995,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.updateTx(client, dbTx);
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    await db.updateSmartContract(client, dbTx, {
      tx_id: dbTx.tx_id,
      canonical: true,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: 123,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    });
    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0xc3e2fabaf7017fa2f6967db4f21be4540fdeae2d593af809c18a6adf369bfb03',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'contract_call',
      fee_rate: '200',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsored: false,
      sponsor_address: undefined,
      post_condition_mode: 'deny',
      post_conditions: [
        {
          type: 'non_fungible',
          condition_code: 'not_sent',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello',
            asset_name: 'asset-name',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
          asset_value: {
            hex: '0x020000000b61737365742d76616c7565',
            repr: '0x61737365742d76616c7565',
          },
        },
        {
          type: 'fungible',
          condition_code: 'sent_greater_than_or_equal_to',
          amount: '123456',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello-ft',
            asset_name: 'asset-name-ft',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
        },
        {
          type: 'stx',
          condition_code: 'sent_less_than_or_equal_to',
          amount: '36723458',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
        },
      ],
      contract_call: {
        contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
        function_name: 'fn-name',
        function_signature: '(define-public (fn-name (arg1 int)))',
        function_args: [
          { hex: '0x000000000000000000000000000000022c', repr: '556', name: 'arg1', type: 'int' },
        ],
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing - abort_by_response', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const txBuilder = await makeContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: new BN(200),
      nonce: new BN(0),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
      anchorMode: AnchorMode.Any,
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        raw_result: '0x0100000000000000000000000000000001', // u1
        status: 'abort_by_response',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.parent_block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: 1594647995,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.updateTx(client, dbTx);

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0x5678',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_id: '0x79abc7783de19569106087302b02379dd02cbb52d20c6c3a7c3d79cbedd559fa',
      tx_index: 2,
      tx_status: 'abort_by_response',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'smart_contract',
      fee_rate: '200',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      sponsor_address: undefined,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing - abort_by_post_condition', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const txBuilder = await makeContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
      nonce: new BN(0),
      anchorMode: AnchorMode.Any,
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        raw_result: '0x0100000000000000000000000000000001', // u1
        status: 'abort_by_post_condition',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        execution_cost: {
          read_count: 0,
          read_length: 0,
          runtime: 0,
          write_count: 0,
          write_length: 0,
        },
      },
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsor_address: undefined,
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
    await db.updateTx(client, dbTx);

    const txQuery = await getTxFromDataStore(db, { txId: dbTx.tx_id, includeUnanchored: false });
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      microblock_canonical: true,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x5678',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      canonical: true,
      tx_id: '0x79abc7783de19569106087302b02379dd02cbb52d20c6c3a7c3d79cbedd559fa',
      tx_index: 2,
      tx_status: 'abort_by_post_condition',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'smart_contract',
      fee_rate: '200',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      sponsor_address: undefined,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      event_count: 0,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('fetch raw tx', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
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
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    });

    const mempoolTx: DbMempoolTx = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-mempool-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${tx.tx_id}/raw`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    expect(searchResult1.body.raw_tx).toEqual(bufferToHexPrefixString(Buffer.from('test-raw-tx')));
    const expectedResponse1 = {
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResponse1);

    const searchResult2 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}/raw`);
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    expect(searchResult2.body.raw_tx).toEqual(
      bufferToHexPrefixString(Buffer.from('test-raw-mempool-tx'))
    );
    const expectedResponse2 = {
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-mempool-tx')),
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResponse2);
  });

  test('fetch raw tx: transaction not found', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
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
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x421234',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      index_block_hash: '0x1234',
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    });
    const searchResult = await supertest(api.server).get(`/extended/v1/tx/0x1234/raw`);
    expect(searchResult.status).toBe(404);
  });
  test('Success: nft events for address', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);

    const addr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const addr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';

    const stxTx: DbTx = {
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: 'none',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: addr1,
      origin_hash_mode: 1,
      event_count: 10,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, stxTx);

    const nftEvent1: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: dbBlock.block_height,
      asset_identifier: 'some-asset',
      value: serializeCV(intCV(0)),
      recipient: addr1,
      sender: 'none',
    };
    for (let i = 0; i < 10; i++) {
      await db.updateNftEvent(client, stxTx, nftEvent1);
    }
    const limit = 2;
    const offset = 0;

    // test nft for given addresses
    const result = await supertest(api.server).get(
      `/extended/v1/address/${addr1}/nft_events?limit=${limit}&offset=${offset}`
    );
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(result.body.total).toEqual(10);
    expect(result.body.nft_events.length).toEqual(2);
    expect(result.body.nft_events[0].recipient).toBe(addr1);
    expect(result.body.nft_events[0].tx_id).toBe(
      '0x1111000000000000000000000000000000000000000000000000000000000000'
    );
    expect(result.body.nft_events[0].block_height).toBe(1);
    expect(result.body.nft_events[0].value.repr).toBe('0');

    const stxTx1: DbTx = {
      tx_id: '0x1111100000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: dbBlock.index_block_hash,
      block_hash: dbBlock.block_hash,
      block_height: dbBlock.block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: 'none',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: addr2,
      origin_hash_mode: 1,
      event_count: 1,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, stxTx1);

    const nftEvent2: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 1,
      tx_id: '0x1111100000000000000000000000000000000000000000000000000000000000',
      tx_index: 2,
      block_height: dbBlock.block_height,
      asset_identifier: 'some-asset',
      value: serializeCV(intCV(0)),
      recipient: addr2,
      sender: 'none',
    };
    await db.updateNftEvent(client, stxTx, nftEvent2);

    const result1 = await supertest(api.server).get(`/extended/v1/address/${addr2}/nft_events`);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');
    expect(result1.body.total).toEqual(1);
    expect(result1.body.nft_events.length).toEqual(1);
    expect(result1.body.nft_events[0].recipient).toBe(addr2);
    expect(result1.body.nft_events[0].tx_id).toBe(
      '0x1111100000000000000000000000000000000000000000000000000000000000'
    );
    expect(result1.body.nft_events[0].block_height).toBe(1);
    expect(result.body.nft_events[0].value.repr).toBe('0');

    //check ownership for addr
    const result2 = await supertest(api.server).get(`/extended/v1/address/${addr1}/nft_events`);
    expect(result2.status).toBe(200);
    expect(result2.type).toBe('application/json');
    expect(result2.body.nft_events.length).toEqual(0);
    expect(result2.body.total).toEqual(0);
  });

  test('nft invalid address', async () => {
    const result = await supertest(api.server).get(
      `/extended/v1/address/invalid-address/nft_events`
    );
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');
  });

  test('event count value', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const block: DbBlock = {
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
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 1,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);

    const nftEvent: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      asset_identifier: 'bux',
      value: serializeCV(intCV(0)),
      recipient: testAddr1,
      sender: testAddr2,
    };

    await db.updateNftEvent(client, tx, nftEvent);

    const expectedResponse = {
      tx_id: '0x1234',
      tx_type: 'coinbase',
      nonce: 0,
      anchor_mode: 'any',
      fee_rate: '1234',
      is_unanchored: false,
      sender_address: 'sender-addr',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      microblock_canonical: true,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      parent_block_hash: block.parent_block_hash,
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_status: 'success',
      block_hash: '0x1234',
      block_height: 1,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      tx_index: 4,
      tx_result: {
        hex: '0x0100000000000000000000000000000001',
        repr: 'u1',
      },
      coinbase_payload: {
        data: '0x636f696e62617365206869',
      },
      event_count: 1,
      events: [
        {
          event_index: 0,
          event_type: 'non_fungible_token_asset',
          tx_id: '0x1234',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
            value: { hex: '0x0000000000000000000000000000000000', repr: '0' },
          },
        },
      ],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${tx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResponse);
  });

  test('get mempool transactions from address', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const senderAddress = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const mempoolTx: DbMempoolTx = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-mempool-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const result = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
  });

  test('get mempool transactions: address not valid', async () => {
    const senderAddress = 'test-sender-address';
    const mempoolTx: DbMempoolTx = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-mempool-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const result = await supertest(api.server).get(`/extended/v1/address/${senderAddress}/mempool`);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');
  });

  test('get mempool transactions from address with offset and limit', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const senderAddress = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const mempoolTx: DbMempoolTx = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-mempool-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const result = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool?limit=20&offset=0`
    );
    const expectedResponse = {
      limit: 20,
      offset: 0,
      total: 1,
      results: [
        {
          tx_id: '0x521234',
          tx_status: 'pending',
          tx_type: 'coinbase',
          receipt_time: 1616063078,
          receipt_time_iso: '2021-03-18T10:24:38.000Z',
          anchor_mode: 'any',
          nonce: 0,
          fee_rate: '1234',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: {
            data: '0x6869',
          },
        },
      ],
    };
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(result.body.results.length).toBe(1);
    expect(result.body.total).toBe(1);
    expect(result.body.limit).toBe(20);
    expect(result.body.offset).toBe(0);
    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('fetch transactions from block', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
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
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_microblock_hash,
      parent_block_hash: block.parent_index_block_hash,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);
    const result = await supertest(api.server).get(
      `/extended/v1/tx/block/${block.block_hash}?limit=20&offset=0`
    );
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
  });

  test('fetch transactions from block', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
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
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);
    const result1 = await supertest(api.server).get(`/extended/v1/tx/block/${block.block_hash}`);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');
    expect(result1.body.limit).toBe(96);
    expect(result1.body.offset).toBe(0);
    expect(result1.body.total).toBe(1);
    expect(result1.body.results.length).toBe(1);

    const result2 = await supertest(api.server).get(
      `/extended/v1/tx/block/${block.block_hash}?limit=20&offset=15`
    );
    expect(result2.body.limit).toBe(20);
    expect(result2.body.offset).toBe(15);
    expect(result2.body.total).toBe(1);
    expect(result2.body.results.length).toBe(0);

    const result3 = await supertest(api.server).get(
      `/extended/v1/tx/block_height/${block.block_height}`
    );
    expect(result3.status).toBe(200);
    expect(result3.type).toBe('application/json');
    expect(result3.body.limit).toBe(96);
    expect(result3.body.offset).toBe(0);
    expect(result3.body.total).toBe(1);
    expect(result3.body.results.length).toBe(1);

    const result4 = await supertest(api.server).get(
      `/extended/v1/tx/block_height/${block.block_height}?limit=20&offset=15`
    );
    expect(result4.body.limit).toBe(20);
    expect(result4.body.offset).toBe(15);
    expect(result4.body.total).toBe(1);
    expect(result4.body.results.length).toBe(0);
  });

  test('Get fee rate', async () => {
    const request: FeeRateRequest = {
      transaction: '0x5e9f3933e358df6a73fec0d47ce3e1062c20812c129f5294e6f37a8d27c051d9',
    };
    const result = await supertest(api.server).post('/extended/v1/fee_rate').send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(result.body.fee_rate).toBe(FEE_RATE);
  });

  test('Block execution cost', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: false,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const dbTx1: DbTx = {
      ...dbBlock,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
      parent_burn_block_time: 1626122935,
      tx_index: 4,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      event_count: 0,
      execution_cost_read_count: 1,
      execution_cost_read_length: 2,
      execution_cost_runtime: 2,
      execution_cost_write_count: 1,
      execution_cost_write_length: 1,
    };
    const dbTx2: DbTx = {
      ...dbBlock,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
      parent_burn_block_time: 1626122935,
      tx_index: 4,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      event_count: 0,
      execution_cost_read_count: 2,
      execution_cost_read_length: 2,
      execution_cost_runtime: 2,
      execution_cost_write_count: 2,
      execution_cost_write_length: 2,
    };
    const dataStoreUpdate: DataStoreBlockUpdateData = {
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx1,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
        {
          tx: dbTx2,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    };
    await db.update(dataStoreUpdate);

    const blockQuery = await supertest(api.server).get(`/extended/v1/block/${dbBlock.block_hash}`);
    expect(blockQuery.body.execution_cost_read_count).toBe(3);
    expect(blockQuery.body.execution_cost_read_length).toBe(4);
    expect(blockQuery.body.execution_cost_runtime).toBe(4);
    expect(blockQuery.body.execution_cost_write_count).toBe(3);
    expect(blockQuery.body.execution_cost_write_length).toBe(3);
  });

  afterEach(async () => {
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
