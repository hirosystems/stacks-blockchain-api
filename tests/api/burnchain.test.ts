import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import {
  DbBurnBlockPoxTx,
  DbBurnchainReward,
  DbRewardSlotHolder,
} from '../../src/datastore/common';
import { startApiServer, ApiServer } from '../../src/api/init';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { PgSqlClient } from '@stacks/api-toolkit';
import { migrate } from '../utils/test-helpers';

describe('burnchain tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
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
      rewards: [reward1, reward2],
    });
    await db.updateBurnchainRewards({
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
      rewards: [reward1],
    });
    await db.updateBurnchainRewards({
      rewards: [reward2],
    });
    await db.updateBurnchainRewards({
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

  describe('pox transactions', () => {
    test('fetch pox transactions for burn block', async () => {
      const burnBlocks = [
        { hash: '0xaa01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1', height: 200 },
        { hash: '0xbb02a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0', height: 201 },
        { hash: '0xcc03a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9', height: 202 },
      ];
      const recipients = [
        '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      ];

      const poxTransactions: DbBurnBlockPoxTx[] = [];
      for (let i = 0; i < 20; i++) {
        const burnBlock = burnBlocks[i % 3];
        poxTransactions.push({
          canonical: true,
          burn_block_hash: burnBlock.hash,
          burn_block_height: burnBlock.height,
          tx_id: `0x${(i + 1).toString(16).padStart(4, '0')}`,
          recipient: recipients[i % 5],
          utxo_idx: i,
          amount: BigInt((i + 1) * 1000),
        });
      }

      await db.updateBurnBlockPoxTxs({
        burnBlockPoxTxs: poxTransactions,
      });

      // Fetch for first block by hash with a limit
      let result = await supertest(api.server).get(
        `/extended/v2/burn-blocks/${burnBlocks[0].hash}/pox-transactions?limit=5`
      );
      expect(result.status).toBe(200);
      expect(result.type).toBe('application/json');
      let jsonResult = JSON.parse(result.text);
      expect(jsonResult.limit).toBe(5);
      expect(jsonResult.offset).toBe(0);
      expect(jsonResult.total).toBe(7);
      expect(jsonResult.results.length).toBe(5);
      expect(jsonResult.results[0]).toStrictEqual({
        amount: '1000',
        burn_block_hash: burnBlocks[0].hash,
        burn_block_height: burnBlocks[0].height,
        recipient: '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ',
        tx_id: '0x0001',
        utxo_idx: 0,
      });

      // Fetch for second block by height with an offset
      result = await supertest(api.server).get(
        `/extended/v2/burn-blocks/${burnBlocks[1].height}/pox-transactions?offset=1`
      );
      expect(result.status).toBe(200);
      expect(result.type).toBe('application/json');
      jsonResult = JSON.parse(result.text);
      expect(jsonResult.limit).toBe(20);
      expect(jsonResult.offset).toBe(1);
      expect(jsonResult.total).toBe(7);
      expect(jsonResult.results.length).toBe(6);
      expect(jsonResult.results[0]).toStrictEqual({
        amount: '5000',
        burn_block_hash: burnBlocks[1].hash,
        burn_block_height: burnBlocks[1].height,
        recipient: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        tx_id: '0x0005',
        utxo_idx: 4,
      });

      // Fetch for third block by latest
      result = await supertest(api.server).get(`/extended/v2/burn-blocks/latest/pox-transactions`);
      expect(result.status).toBe(200);
      expect(result.type).toBe('application/json');
      jsonResult = JSON.parse(result.text);
      expect(jsonResult.limit).toBe(20);
      expect(jsonResult.offset).toBe(0);
      expect(jsonResult.total).toBe(6);
      expect(jsonResult.results.length).toBe(6);
      expect(jsonResult.results[0]).toStrictEqual({
        amount: '3000',
        burn_block_hash: burnBlocks[2].hash,
        burn_block_height: burnBlocks[2].height,
        recipient: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
        tx_id: '0x0003',
        utxo_idx: 2,
      });

      // Fetch unknown block
      result = await supertest(api.server).get(`/extended/v2/burn-blocks/300/pox-transactions`);
      expect(result.status).toBe(200);
      expect(result.type).toBe('application/json');
      jsonResult = JSON.parse(result.text);
      expect(jsonResult.limit).toBe(20);
      expect(jsonResult.offset).toBe(0);
      expect(jsonResult.total).toBe(0);
      expect(jsonResult.results.length).toBe(0);

      // Fetch for address with a limit and offset
      result = await supertest(api.server).get(
        `/extended/v2/addresses/${recipients[0]}/pox-transactions?limit=2&offset=1`
      );
      expect(result.status).toBe(200);
      expect(result.type).toBe('application/json');
      jsonResult = JSON.parse(result.text);
      expect(jsonResult.limit).toBe(2);
      expect(jsonResult.offset).toBe(1);
      expect(jsonResult.total).toBe(4);
      expect(jsonResult.results.length).toBe(2);
      expect(jsonResult.results[0]).toStrictEqual({
        amount: '11000',
        burn_block_hash: burnBlocks[1].hash,
        burn_block_height: burnBlocks[1].height,
        recipient: recipients[0],
        tx_id: '0x000b',
        utxo_idx: 10,
      });
    });
  });
});
