import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { DbBurnchainReward, DbRewardSlotHolder } from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';

describe('burnchain tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
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

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
