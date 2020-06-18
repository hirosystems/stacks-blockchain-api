import * as supertest from 'supertest';
import {
  makeContractCall,
  NonFungibleConditionCode,
  FungibleConditionCode,
  bufferCVFromString,
  ClarityAbi,
  ClarityType,
  makeSmartContractDeploy,
} from '@blockstack/stacks-transactions';
import {
  createNonFungiblePostCondition,
  createFungiblePostCondition,
  createSTXPostCondition,
} from '@blockstack/stacks-transactions/lib/postcondition';
import * as BN from 'bn.js';
import { readTransaction } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
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
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';

describe('api tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    api = await startApiServer(db);
  });

  test('address info', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';

    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: testAddr1,
      origin_hash_mode: 1,
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
      createStxEvent(testAddr2, testContractAddr, 250),
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
          value: Buffer.from([0]),
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

    const fetchAddrBalance1 = await supertest(api.server).get(
      `/sidecar/v1/address/${testAddr2}/balances`
    );
    expect(fetchAddrBalance1.status).toBe(200);
    expect(fetchAddrBalance1.type).toBe('application/json');
    const expectedResp1 = {
      stx: { balance: '99615', total_sent: '385', total_received: '100000' },
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
    };
    expect(JSON.parse(fetchAddrBalance1.text)).toEqual(expectedResp1);

    const fetchAddrBalance2 = await supertest(api.server).get(
      `/sidecar/v1/address/${testContractAddr}/balances`
    );
    expect(fetchAddrBalance2.status).toBe(200);
    expect(fetchAddrBalance2.type).toBe('application/json');
    const expectedResp2 = {
      stx: { balance: '335', total_sent: '15', total_received: '350' },
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
  });

  test('getTxList() returns object', async () => {
    const expectedResp = {
      limit: 96,
      offset: 0,
      results: [],
      total: 0,
    };
    const fetchTx = await supertest(api.server).get('/sidecar/v1/tx/');
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('block store and process', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1235,
      burn_block_time: 94869286,
      canonical: true,
    };
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, tx);

    const blockQuery = await getBlockFromDataStore(block.block_hash, db);
    if (!blockQuery.found) {
      throw new Error('block not found');
    }

    const expectedResp = {
      burn_block_time: 94869286,
      canonical: true,
      hash: '0x1234',
      height: 1235,
      parent_block_hash: '0xff0011',
      txs: ['0x1234'],
    };

    expect(blockQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/sidecar/v1/block/${block.block_hash}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing', async () => {
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
      functionArgs: [{ type: ClarityType.Int, value: new BN(556) }],
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [pc1, pc2, pc3],
      nonce: new BN(0),
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        result: void 0,
        status: 'success',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      index_block_hash: '0xaa',
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 345,
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
    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 345,
      canonical: true,
      tx_id: '0xc3e2fabaf7017fa2f6967db4f21be4540fdeae2d593af809c18a6adf369bfb03',
      tx_index: 2,
      tx_status: 'success',
      tx_type: 'contract_call',
      fee_rate: '200',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsored: false,
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
          asset_value: { hex: '0x020000000b61737365742d76616c7565', repr: '"asset-value"' },
        },
        {
          type: 'fungible',
          condition_code: 'sent_greater_than',
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
          condition_code: 'sent_less_than',
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
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/sidecar/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing - abort_by_response', async () => {
    const txBuilder = await makeSmartContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        result: void 0,
        status: 'abort_by_response',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: '0xaa',
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 345,
    });
    await db.updateTx(client, dbTx);

    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 345,
      canonical: true,
      tx_id: '0x79abc7783de19569106087302b02379dd02cbb52d20c6c3a7c3d79cbedd559fa',
      tx_index: 2,
      tx_status: 'abort_by_response',
      tx_type: 'smart_contract',
      fee_rate: '200',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/sidecar/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing - abort_by_post_condition', async () => {
    const txBuilder = await makeSmartContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
      nonce: new BN(0),
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        result: void 0,
        status: 'abort_by_post_condition',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: '0xaa',
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 345,
    });
    await db.updateTx(client, dbTx);

    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 345,
      canonical: true,
      tx_id: '0x79abc7783de19569106087302b02379dd02cbb52d20c6c3a7c3d79cbedd559fa',
      tx_index: 2,
      tx_status: 'abort_by_post_condition',
      tx_type: 'smart_contract',
      fee_rate: '200',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/sidecar/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  afterEach(async () => {
    await new Promise(resolve => api.server.close(() => resolve()));
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
