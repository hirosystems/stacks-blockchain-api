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
  DataStoreBlockUpdateData,
  DbRewardSlotHolder,
  DbMinerReward,
  DbTokenOfferingLocked,
  DbStxLockEvent,
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
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
  });

  test('contiguous microblock stream fully confirmed in anchor block', async () => {
    const block1: DbBlock = {
      block_hash: '0x11',
      index_block_hash: '0xaa',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x00',
      parent_microblock_hash: '',
      block_height: 1,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
    };
    const block2: DbBlock = {
      block_hash: '0x22',
      index_block_hash: '0xbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '',
      block_height: 2,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
    };
    const block3: DbBlock = {
      block_hash: '0x33',
      index_block_hash: '0xcc',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      parent_microblock_hash: '',
      block_height: 3,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
    };

    const minerReward1: DbMinerReward = {
      ...block1,
      mature_block_height: 3,
      from_index_block_hash: '0x11',
      recipient: 'miner-addr1',
      coinbase_amount: 1000n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 9n,
    };

    const minerReward2: DbMinerReward = {
      ...block2,
      mature_block_height: 4,
      from_index_block_hash: '0x22',
      recipient: 'miner-addr2',
      coinbase_amount: 1000n,
      tx_fees_anchored: 2n,
      tx_fees_streamed_confirmed: 3n,
      tx_fees_streamed_produced: 0n,
    };

    const tx1: DbTx = {
      tx_id: '0x01',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block1.index_block_hash,
      block_hash: block1.block_hash,
      block_height: block1.block_height,
      burn_block_time: block1.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 1,
      parent_index_block_hash: '',
      parent_block_hash: '',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
    };

    const tx2: DbTx = {
      tx_id: '0x02',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block2.index_block_hash,
      block_hash: block2.block_hash,
      block_height: block2.block_height,
      burn_block_time: block2.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      sponsor_address: undefined,
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 1,
      parent_index_block_hash: '',
      parent_block_hash: '',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
    };

    const stxLockEvent1: DbStxLockEvent = {
      ...tx1,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 1234n,
      unlock_height: block1.block_height + 100000,
      locked_address: 'locked-addr1',
    };

    const stxLockEvent2: DbStxLockEvent = {
      ...tx2,
      event_index: 0,
      event_type: DbEventTypeId.StxLock,
      locked_amount: 45n,
      unlock_height: block2.block_height + 100000,
      locked_address: 'locked-addr2',
    };

    await db.update({
      block: block1,
      microblocks: [],
      minerRewards: [minerReward1],
      txs: [
        {
          tx: tx1,
          stxLockEvents: [stxLockEvent1],
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
    await db.update({
      block: block2,
      microblocks: [],
      minerRewards: [minerReward2],
      txs: [
        {
          tx: tx2,
          stxLockEvents: [stxLockEvent2],
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
    await db.update({ block: block3, microblocks: [], minerRewards: [], txs: [] });

    const block2b: DbBlock = {
      block_hash: '0x22bb',
      index_block_hash: '0xbbbb',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      parent_microblock_hash: '',
      block_height: 2,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
    };
    const tx3: DbTx = {
      tx_id: '0x03',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block2b.index_block_hash,
      block_hash: block2b.block_hash,
      block_height: block2b.block_height,
      burn_block_time: block2b.burn_block_time,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 0,
      parent_index_block_hash: '',
      parent_block_hash: '',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
    };
    const contract1: DbSmartContract = {
      tx_id: tx3.tx_id,
      canonical: true,
      contract_id: 'my-contract',
      block_height: tx3.block_height,
      source_code: '(my-src)',
      abi: '{thing:1}',
    };

    await db.update({
      block: block2b,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx3,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [contract1],
          names: [
            {
              tx_id: tx3.tx_id,
              tx_index: tx3.tx_index,
              name: 'xyz',
              address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
              namespace_id: 'abc',
              registered_at: 1,
              expire_block: 14,
              zonefile:
                '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
              zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
              canonical: true,
            },
          ],
          namespaces: [
            {
              tx_id: tx3.tx_id,
              tx_index: tx3.tx_index,
              namespace_id: 'abc',
              address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
              base: 1,
              coeff: 1,
              launched_at: 14,
              lifetime: 1,
              no_vowel_discount: 1,
              nonalpha_discount: 1,
              ready_block: 2,
              reveal_block: 6,
              status: 'ready',
              buckets: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
              canonical: true,
            },
          ],
        },
      ],
    });
    const isBlock2bCanonical = await db.getBlock({ hash: block2b.block_hash });
    await db.resolveBnsSubdomains(
      {
        index_block_hash: block2b.index_block_hash,
        parent_index_block_hash: block2b.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [
        {
          namespace_id: 'abc',
          name: 'xyz',
          fully_qualified_subdomain: 'def.xyz.abc',
          owner: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
          canonical: isBlock2bCanonical.result?.canonical ?? false,
          zonefile: 'zone file ',
          zonefile_hash: 'zone file hash',
          parent_zonefile_hash: 'parent zone file hash',
          parent_zonefile_index: 1,
          block_height: 2,
          tx_index: 0,
          tx_id: '',
          zonefile_offset: 0,
          resolver: 'resolver',
        },
      ]
    );

    const blockQuery1 = await db.getBlock({ hash: block2b.block_hash });
    expect(blockQuery1.result?.canonical).toBe(false);
    const chainTip1 = await db.getChainTip(client);
    expect(chainTip1).toEqual({ blockHash: '0x33', blockHeight: 3, indexBlockHash: '0xcc' });
    const namespaces = await db.getNamespaceList({ includeUnanchored: false });
    expect(namespaces.results.length).toBe(0);
    const names = await db.getNamespaceNamesList({
      namespace: 'abc',
      page: 0,
      includeUnanchored: false,
    });
    expect(names.results.length).toBe(0);
    const subdomain = await db.getSubdomain({ subdomain: 'def.xyz.abc', includeUnanchored: false });
    expect(subdomain.found).toBe(false);

    const block3b: DbBlock = {
      block_hash: '0x33bb',
      index_block_hash: '0xccbb',
      parent_index_block_hash: block2b.index_block_hash,
      parent_block_hash: block2b.block_hash,
      parent_microblock_hash: '',
      block_height: 3,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
    };
    await db.update({ block: block3b, microblocks: [], minerRewards: [], txs: [] });
    const blockQuery2 = await db.getBlock({ hash: block3b.block_hash });
    expect(blockQuery2.result?.canonical).toBe(false);
    const chainTip2 = await db.getChainTip(client);
    expect(chainTip2).toEqual({ blockHash: '0x33', blockHeight: 3, indexBlockHash: '0xcc' });

    const block4b: DbBlock = {
      block_hash: '0x44bb',
      index_block_hash: '0xddbb',
      parent_index_block_hash: block3b.index_block_hash,
      parent_block_hash: block3b.block_hash,
      parent_microblock_hash: '',
      block_height: 4,
      burn_block_time: 1234,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
    };
    await db.update({ block: block4b, microblocks: [], minerRewards: [], txs: [] });
    const blockQuery3 = await db.getBlock({ hash: block3b.block_hash });
    expect(blockQuery3.result?.canonical).toBe(true);
    const chainTip3 = await db.getChainTip(client);
    expect(chainTip3).toEqual({ blockHash: '0x44bb', blockHeight: 4, indexBlockHash: '0xddbb' });

    const b1 = await db.getBlock({ hash: block1.block_hash });
    const b2 = await db.getBlock({ hash: block2.block_hash });
    const b2b = await db.getBlock({ hash: block2b.block_hash });
    const b3 = await db.getBlock({ hash: block3.block_hash });
    const b3b = await db.getBlock({ hash: block3b.block_hash });
    const b4 = await db.getBlock({ hash: block4b.block_hash });
    expect(b1.result?.canonical).toBe(true);
    expect(b2.result?.canonical).toBe(false);
    expect(b2b.result?.canonical).toBe(true);
    expect(b3.result?.canonical).toBe(false);
    expect(b3b.result?.canonical).toBe(true);
    expect(b4.result?.canonical).toBe(true);

    const r1 = await db.getStxBalance({
      stxAddress: minerReward1.recipient,
      includeUnanchored: false,
    });
    const r2 = await db.getStxBalance({
      stxAddress: minerReward2.recipient,
      includeUnanchored: false,
    });
    expect(r1.totalMinerRewardsReceived).toBe(1014n);
    expect(r2.totalMinerRewardsReceived).toBe(0n);

    const lock1 = await db.getStxBalance({
      stxAddress: stxLockEvent1.locked_address,
      includeUnanchored: false,
    });
    const lock2 = await db.getStxBalance({
      stxAddress: stxLockEvent2.locked_address,
      includeUnanchored: false,
    });
    expect(lock1.locked).toBe(1234n);
    expect(lock2.locked).toBe(0n);

    const t1 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
    const t2 = await db.getTx({ txId: tx2.tx_id, includeUnanchored: false });
    const t3 = await db.getTx({ txId: tx3.tx_id, includeUnanchored: false });
    expect(t1.result?.canonical).toBe(true);
    expect(t2.result?.canonical).toBe(false);
    expect(t3.result?.canonical).toBe(true);

    const sc1 = await db.getSmartContract(contract1.contract_id);
    expect(sc1.result?.canonical).toBe(true);
  });

  afterEach(async () => {
    await api.terminate();
    client.release();
    await db?.close();
    // await runMigrations(undefined, 'down');
  });
});
