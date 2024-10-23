import * as supertest from 'supertest';
import * as assert from 'assert';
import {
  makeContractCall,
  ClarityAbi,
  ClarityType,
  sponsorTransaction,
  ChainID,
  AnchorMode,
  uintCV,
  stringAsciiCV,
  serializeCV,
} from '@stacks/transactions';
import { createClarityValueArray } from '../../src/stacks-encoding-helpers';
import { decodeTransaction } from 'stacks-encoding-native-js';
import {
  DbBlock,
  DbTxTypeId,
  DbStxEvent,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbFtEvent,
  DbNftEvent,
  DbSmartContract,
  DbSmartContractEvent,
  DbTokenOfferingLocked,
  DataStoreTxEventData,
  DataStoreMicroblockUpdateData,
  DbTxRaw,
  DbMempoolTxRaw,
  DbTx,
} from '../../src/datastore/common';
import { startApiServer, ApiServer } from '../../src/api/init';
import { I32_MAX } from '../../src/helpers';
import {
  TestBlockBuilder,
  testMempoolTx,
  TestMicroblockStreamBuilder,
} from '../utils/test-builders';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { createDbTxFromCoreMsg } from '../../src/datastore/helpers';
import { PgSqlClient, bufferToHex } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';

describe('address tests', () => {
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

  test('address transaction transfers', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
    const testAddr5 = 'ST29H5FH57AZVJSBWHCTJB5ATS2ZAH9SXN1XJDNK';
    const testTxId = '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b890009';

    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x2345',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 39486,
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
      tx_count: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };
    let indexIdIndex = 0;
    const createStxTx = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true,
      stxEventCount = 1,
      ftEventCount = 1,
      nftEventCount = 1,
      eventAddressesOnly = false
    ): [DbTxRaw, DbStxEvent[], DbFtEvent[], DbNftEvent[]] => {
      const tx: DbTxRaw = {
        tx_id:
          '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b89' +
          (++indexIdIndex).toString().padStart(4, '0'),
        tx_index: indexIdIndex,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: bufferToHex(Buffer.from('')),
        index_block_hash: block.index_block_hash,
        block_hash: block.block_hash,
        block_height: block.block_height,
        block_time: 1594647994,
        burn_block_height: block.burn_block_height,
        burn_block_time: 1594647994,
        parent_burn_block_time: 1626122935,
        type_id: DbTxTypeId.TokenTransfer,
        token_transfer_amount: BigInt(amount),
        token_transfer_memo: bufferToHex(Buffer.from('hi')),
        token_transfer_recipient_address: eventAddressesOnly ? '' : recipient,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical,
        microblock_canonical: true,
        microblock_sequence: I32_MAX,
        microblock_hash: '',
        parent_index_block_hash: '',
        parent_block_hash: '',
        post_conditions: '0x01f5',
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: eventAddressesOnly ? '' : sender,
        origin_hash_mode: 1,
        event_count: 0,
        execution_cost_read_count: 1,
        execution_cost_read_length: 2,
        execution_cost_runtime: 3,
        execution_cost_write_count: 4,
        execution_cost_write_length: 5,
      };
      let eventIndex = 0;
      const stxEvents: DbStxEvent[] = [];
      for (let i = 0; i < stxEventCount; i++) {
        const stxEvent: DbStxEvent = {
          canonical,
          event_type: DbEventTypeId.StxAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: eventIndex++,
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
          event_index: eventIndex++,
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
          event_index: eventIndex++,
          tx_id: tx.tx_id,
          tx_index: tx.tx_index,
          block_height: tx.block_height,
          value: bufferToHex(Buffer.from(serializeCV(uintCV(amount)))),
          recipient,
          sender,
        };
        nftEvents.push(nftEvent);
      }
      return [tx, stxEvents, ftEvents, nftEvents];
    };
    const txs = [
      createStxTx(testAddr4, testAddr2, 0, true, 1, 0, 0, true),
      createStxTx(testAddr4, testAddr2, 0, true, 0, 1, 0, true),
      createStxTx(testAddr4, testAddr2, 0, true, 0, 0, 1, true),
      createStxTx(testAddr1, testAddr2, 100_000, true, 1, 1, 1),
      createStxTx(testAddr2, testContractAddr, 100, true, 1, 2, 1),
      createStxTx(testAddr2, testContractAddr, 250, true, 1, 0, 1),
      createStxTx(testAddr2, testContractAddr, 40, false, 1, 1, 1),
      createStxTx(testContractAddr, testAddr4, 15, true, 1, 1, 0),
      createStxTx(testAddr2, testAddr4, 35, true, 3, 1, 2),
    ];

    const tx1 = txs[0];
    const addr3FtEvent: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      asset_identifier: 'usdc',
      event_index: 1234,
      tx_id: tx1[0].tx_id,
      tx_index: tx1[0].tx_index,
      block_height: tx1[0].block_height,
      amount: BigInt(12345),
      recipient: testAddr5,
      sender: 'STEH21DTN67ECXDRXG858XHBZMEBEBFE2FV79DEF',
    };
    tx1[2].push(addr3FtEvent);

    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: txs.map(data => ({
        tx: data[0],
        stxEvents: data[1],
        ftEvents: data[2],
        nftEvents: data[3],
        stxLockEvents: [],
        contractLogEvents: [],
        names: [],
        namespaces: [],
        smartContracts: [],
        pox2Events: [],
        pox3Events: [],
        pox4Events: [],
      })),
    });

    const fetch1 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/transactions_with_transfers?limit=3&offset=0`
    );
    expect(fetch1.status).toBe(200);
    expect(fetch1.type).toBe('application/json');
    const expected1 = {
      limit: 3,
      offset: 0,
      total: 7,
      results: [
        {
          tx: {
            tx_id: '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b890009',
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
            block_hash: '0x1234',
            block_height: 1,
            block_time: 1594647994,
            block_time_iso: '2020-07-13T13:46:34.000Z',
            burn_block_height: 100123123,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '0x',
            microblock_sequence: I32_MAX,
            parent_block_hash: '0x',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 9,
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
              value: {
                hex: '0x0100000000000000000000000000000023',
                repr: 'u35',
              },
            },
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              value: {
                hex: '0x0100000000000000000000000000000023',
                repr: 'u35',
              },
            },
          ],
        },
        {
          tx: {
            tx_id: '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b890006',
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
            block_hash: '0x1234',
            block_height: 1,
            block_time: 1594647994,
            block_time_iso: '2020-07-13T13:46:34.000Z',
            burn_block_height: 100123123,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '0x',
            microblock_sequence: I32_MAX,
            parent_block_hash: '0x',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 6,
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
              value: {
                hex: '0x01000000000000000000000000000000fa',
                repr: 'u250',
              },
            },
          ],
        },
        {
          tx: {
            tx_id: '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b890005',
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
            block_hash: '0x1234',
            block_height: 1,
            block_time: 1594647994,
            block_time_iso: '2020-07-13T13:46:34.000Z',
            burn_block_height: 100123123,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '0x',
            microblock_sequence: I32_MAX,
            parent_block_hash: '0x',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 5,
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
              value: {
                hex: '0x0100000000000000000000000000000064',
                repr: 'u100',
              },
            },
          ],
        },
      ],
    };
    const fetch1Json = JSON.parse(fetch1.text);
    expect(fetch1Json).toEqual(expected1);

    // Test v2 endpoints
    const v2Fetch1 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions`
    );
    expect(v2Fetch1.status).toBe(200);
    expect(v2Fetch1.type).toBe('application/json');
    const v2Fetch1Json = JSON.parse(v2Fetch1.text);
    expect(v2Fetch1Json.total).toBe(7);
    expect(v2Fetch1Json.results[0].tx).toStrictEqual(expected1.results[0].tx);
    expect(v2Fetch1Json.results[0].stx_sent).toBe('1339');
    expect(v2Fetch1Json.results[0].stx_received).toBe('0');
    expect(v2Fetch1Json.results[0].events.stx).toStrictEqual({
      transfer: 3,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[0].events.ft).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[0].events.nft).toStrictEqual({
      transfer: 2,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[1].tx).toStrictEqual(expected1.results[1].tx);
    expect(v2Fetch1Json.results[1].stx_sent).toBe('1484');
    expect(v2Fetch1Json.results[1].stx_received).toBe('0');
    expect(v2Fetch1Json.results[1].events.stx).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[1].events.ft).toStrictEqual({
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[1].events.nft).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[2].tx).toStrictEqual(expected1.results[2].tx);
    expect(v2Fetch1Json.results[2].stx_sent).toBe('1334');
    expect(v2Fetch1Json.results[2].stx_received).toBe('0');
    expect(v2Fetch1Json.results[2].events.stx).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[2].events.ft).toStrictEqual({
      transfer: 2,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[2].events.nft).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[4].stx_sent).toBe('0');
    expect(v2Fetch1Json.results[4].stx_received).toBe('0');
    expect(v2Fetch1Json.results[4].events.stx).toStrictEqual({
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[4].events.ft).toStrictEqual({
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[4].events.nft).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[5].stx_sent).toBe('0');
    expect(v2Fetch1Json.results[5].stx_received).toBe('0');
    expect(v2Fetch1Json.results[5].events.stx).toStrictEqual({
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[5].events.ft).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[5].events.nft).toStrictEqual({
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[6].stx_sent).toBe('0');
    expect(v2Fetch1Json.results[6].stx_received).toBe('0');
    expect(v2Fetch1Json.results[6].events.stx).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[6].events.ft).toStrictEqual({
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch1Json.results[6].events.nft).toStrictEqual({
      transfer: 0,
      mint: 0,
      burn: 0,
    });

    // fetch with offset
    const v2Fetch1offset = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions?offset=1`
    );
    expect(v2Fetch1offset.status).toBe(200);
    expect(v2Fetch1offset.type).toBe('application/json');
    const v2Fetch1offsetJson = JSON.parse(v2Fetch1offset.text);
    expect(v2Fetch1offsetJson.total).toBe(7);

    const v2Fetch2 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions/${v2Fetch1Json.results[0].tx.tx_id}/events?limit=3`
    );
    expect(v2Fetch2.status).toBe(200);
    expect(v2Fetch2.type).toBe('application/json');
    expect(JSON.parse(v2Fetch2.text)).toStrictEqual({
      limit: 3,
      offset: 0,
      results: [
        {
          data: {
            type: 'transfer',
            amount: '35',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          },
          event_index: 0,
          type: 'stx',
        },
        {
          data: {
            type: 'transfer',
            amount: '35',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          },
          event_index: 1,
          type: 'stx',
        },
        {
          data: {
            type: 'transfer',
            amount: '35',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          },
          event_index: 2,
          type: 'stx',
        },
      ],
      total: 6,
    });
    const v2Fetch3 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions/${v2Fetch1Json.results[0].tx.tx_id}/events?offset=3&limit=3`
    );
    expect(v2Fetch3.status).toBe(200);
    expect(v2Fetch3.type).toBe('application/json');
    expect(JSON.parse(v2Fetch3.text)).toStrictEqual({
      limit: 3,
      offset: 3,
      results: [
        {
          data: {
            type: 'transfer',
            amount: '35',
            asset_identifier: 'usdc',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          },
          event_index: 3,
          type: 'ft',
        },
        {
          data: {
            type: 'transfer',
            asset_identifier: 'punk1',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            value: {
              hex: '0x0100000000000000000000000000000023',
              repr: 'u35',
            },
          },
          event_index: 4,
          type: 'nft',
        },
        {
          data: {
            type: 'transfer',
            asset_identifier: 'punk1',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            value: {
              hex: '0x0100000000000000000000000000000023',
              repr: 'u35',
            },
          },
          event_index: 5,
          type: 'nft',
        },
      ],
      total: 6,
    });

    // test address that only received ft balance from an ft event
    const v2Fetch4 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr5}/transactions`
    );
    expect(v2Fetch4.status).toBe(200);
    expect(v2Fetch4.type).toBe('application/json');
    expect(v2Fetch4.body.total).toBe(1);
    expect(v2Fetch4.body.results[0].events.ft).toStrictEqual({
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    expect(v2Fetch4.body.results[0].stx_sent).toBe('0');
    expect(v2Fetch4.body.results[0].stx_received).toBe('0');

    const v2Fetch4Events = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr5}/transactions/${addr3FtEvent.tx_id}/events`
    );
    expect(v2Fetch4Events.status).toBe(200);
    expect(v2Fetch4Events.type).toBe('application/json');
    expect(v2Fetch4Events.body.total).toBe(1);
    expect(v2Fetch4Events.body.results[0]).toStrictEqual({
      type: 'ft',
      event_index: addr3FtEvent.event_index,
      data: {
        type: 'transfer',
        amount: addr3FtEvent.amount.toString(),
        asset_identifier: addr3FtEvent.asset_identifier,
        sender: addr3FtEvent.sender,
        recipient: addr3FtEvent.recipient,
      },
    });

    // testing single txs information based on given tx_id
    const fetchSingleTxInformation = await supertest(api.server).get(
      `/extended/v1/address/${testAddr4}/${testTxId}/with_transfers`
    );
    expect(fetchSingleTxInformation.status).toBe(200);
    expect(fetchSingleTxInformation.type).toBe('application/json');
    const expectedSingleTxInformation = {
      tx: {
        tx_id: '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b890009',
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
        block_hash: '0x1234',
        block_height: 1,
        block_time: 1594647994,
        block_time_iso: '2020-07-13T13:46:34.000Z',
        burn_block_height: 100123123,
        burn_block_time: 1594647994,
        burn_block_time_iso: '2020-07-13T13:46:34.000Z',
        canonical: true,
        microblock_canonical: true,
        microblock_hash: '0x',
        microblock_sequence: I32_MAX,
        parent_block_hash: '0x',
        parent_burn_block_time: 1626122935,
        parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
        tx_index: 9,
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
      `/extended/v1/address/${testAddr4}/transactions_with_transfers?limit=2`
    );
    expect(fetch2.status).toBe(200);
    expect(fetch2.type).toBe('application/json');
    const expected2 = {
      limit: 2,
      offset: 0,
      total: 5,
      results: [
        {
          tx: {
            tx_id: '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b890009',
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
            block_hash: '0x1234',
            block_height: 1,
            block_time: 1594647994,
            block_time_iso: '2020-07-13T13:46:34.000Z',
            burn_block_height: 100123123,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '0x',
            microblock_sequence: I32_MAX,
            parent_block_hash: '0x',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 9,
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
              value: {
                hex: '0x0100000000000000000000000000000023',
                repr: 'u35',
              },
            },
            {
              asset_identifier: 'punk1',
              sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
              recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
              value: {
                hex: '0x0100000000000000000000000000000023',
                repr: 'u35',
              },
            },
          ],
        },
        {
          tx: {
            tx_id: '0x03807fdb726b3cb843e0330c564a4974037be8f9ea58ec7f8ebe03c34b890008',
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
            block_hash: '0x1234',
            block_height: 1,
            block_time: 1594647994,
            block_time_iso: '2020-07-13T13:46:34.000Z',
            burn_block_height: 100123123,
            burn_block_time: 1594647994,
            burn_block_time_iso: '2020-07-13T13:46:34.000Z',
            canonical: true,
            microblock_canonical: true,
            microblock_hash: '0x',
            microblock_sequence: I32_MAX,
            parent_block_hash: '0x',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            tx_index: 8,
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

  test('address nonce', async () => {
    const testAddr1 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
    const testAddr2 = 'ST5F760KN84TZK3VTZCTVFYCVXQBEVKNV9M7H2CW';

    const block1 = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x0001',
      index_block_hash: '0x9001',
    })
      .addTx({ tx_id: '0x0101', nonce: 1, sender_address: testAddr1 })
      .build();
    await db.update(block1);

    const block2 = new TestBlockBuilder({
      block_height: 2,
      block_hash: '0x0002',
      index_block_hash: '0x9002',
      parent_index_block_hash: block1.block.index_block_hash,
    })
      .addTx({ tx_id: '0x0201', nonce: 2, sender_address: testAddr1 })
      .build();
    await db.update(block2);

    const block3 = new TestBlockBuilder({
      block_height: 3,
      block_hash: '0x0003',
      index_block_hash: '0x9003',
      parent_index_block_hash: block2.block.index_block_hash,
    })
      .addTx({ tx_id: '0x0301', nonce: 3, sender_address: testAddr1 })
      .build();
    await db.update(block3);

    const mempoolTx1 = testMempoolTx({
      tx_id: '0x1401',
      nonce: 4,
      type_id: DbTxTypeId.TokenTransfer,
      sender_address: testAddr1,
    });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1] });

    // Chain-tip nonce
    const expectedNonceResults1 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: 3,
      last_mempool_tx_nonce: 4,
      possible_next_nonce: 5,
    };
    const nonceResults1 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces`
    );
    expect(nonceResults1.status).toBe(200);
    expect(nonceResults1.type).toBe('application/json');
    expect(nonceResults1.body).toEqual(expectedNonceResults1);

    // Detect missing nonce
    const mempoolTx2 = testMempoolTx({
      tx_id: '0x1402',
      nonce: 7,
      type_id: DbTxTypeId.TokenTransfer,
      sender_address: testAddr1,
    });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx2] });
    const expectedNonceResults2 = {
      detected_missing_nonces: [6, 5],
      detected_mempool_nonces: [4],
      last_executed_tx_nonce: 3,
      last_mempool_tx_nonce: 7,
      possible_next_nonce: 8,
    };
    const nonceResults2 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces`
    );
    expect(nonceResults2.status).toBe(200);
    expect(nonceResults2.type).toBe('application/json');
    expect(nonceResults2.body).toEqual(expectedNonceResults2);

    // Get nonce at block height
    const expectedNonceResults3 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: 2,
      last_mempool_tx_nonce: null,
      possible_next_nonce: 3,
    };
    const nonceResults3 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_height=${block2.block.block_height}`
    );
    expect(nonceResults3.status).toBe(200);
    expect(nonceResults3.type).toBe('application/json');
    expect(nonceResults3.body).toEqual(expectedNonceResults3);

    // Get nonce at block hash
    const expectedNonceResults4 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: 2,
      last_mempool_tx_nonce: null,
      possible_next_nonce: 3,
    };
    const nonceResults4 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_hash=${block2.block.block_hash}`
    );
    expect(nonceResults4.status).toBe(200);
    expect(nonceResults4.type).toBe('application/json');
    expect(nonceResults4.body).toEqual(expectedNonceResults4);

    // Get nonce for account with no transactions
    const expectedNonceResultsNoTxs1 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: null,
      last_mempool_tx_nonce: null,
      possible_next_nonce: 0,
    };
    const nonceResultsNoTxs1 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/nonces`
    );
    expect(nonceResultsNoTxs1.status).toBe(200);
    expect(nonceResultsNoTxs1.type).toBe('application/json');
    expect(nonceResultsNoTxs1.body).toEqual(expectedNonceResultsNoTxs1);

    // Get nonce for account with no transactions
    const expectedNonceResultsNoTxs2 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: null,
      last_mempool_tx_nonce: null,
      possible_next_nonce: 0,
    };
    const nonceResultsNoTxs2 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/nonces?block_height=${block2.block.block_height}`
    );
    expect(nonceResultsNoTxs2.status).toBe(200);
    expect(nonceResultsNoTxs2.type).toBe('application/json');
    expect(nonceResultsNoTxs2.body).toEqual(expectedNonceResultsNoTxs2);

    // Bad requests
    const nonceResults5 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_hash=xcvbnmn`
    );
    expect(nonceResults5.status).toBe(400);

    const nonceResults6 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_height=xcvbnmn`
    );
    expect(nonceResults6.status).toBe(400);

    const nonceResults7 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_height=xcvbnmn&block_hash=xcvbnmn`
    );
    expect(nonceResults7.status).toBe(400);

    const nonceResults8 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_height=999999999`
    );
    expect(nonceResults8.status).toBe(404);
  });

  test('address info', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
    const testAddr5 = 'ST3V11C6X2EBFN72RMS3B1NYQ1BX98F61GVYRDRXW';
    const testAddr6 = 'ST2F8G7616B2F8PYG216BX9AJCHP7YRK7ND7M0ZN3';
    const testAddr7 = 'ST1YAE5W95DARZB24E1W507D72TEAAEZFNGRVVX09';

    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x2345',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 39486,
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
      tx_count: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };

    let indexIdIndex = 0;
    const createStxTx = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true,
      sponsoredAddress: string | undefined = undefined
    ): DbTxRaw => {
      const tx: DbTxRaw = {
        tx_id: '0x1234' + (++indexIdIndex).toString().padStart(4, '0'),
        tx_index: indexIdIndex,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: bufferToHex(Buffer.from('')),
        index_block_hash: block.index_block_hash,
        block_hash: block.block_hash,
        block_height: block.block_height,
        block_time: block.burn_block_time,
        burn_block_height: block.burn_block_height,
        burn_block_time: block.burn_block_time,
        parent_burn_block_time: 1626122935,
        type_id: DbTxTypeId.TokenTransfer,
        token_transfer_amount: BigInt(amount),
        token_transfer_memo: bufferToHex(Buffer.from('hi')),
        token_transfer_recipient_address: recipient,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical,
        microblock_canonical: true,
        microblock_sequence: I32_MAX,
        microblock_hash: '',
        parent_index_block_hash: '',
        parent_block_hash: '',
        post_conditions: '0x01f5',
        fee_rate: 1234n,
        sponsored: sponsoredAddress != undefined,
        sponsor_address: sponsoredAddress,
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
      createStxTx(testAddr2, testAddr7, 5000),
      createStxTx(testAddr2, testAddr4, 35, true, testAddr7),
    ];

    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 9,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('')),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      block_time: block.burn_block_time,
      burn_block_height: block.burn_block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
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
      createStxEvent(testAddr2, testAddr7, 5000),
    ];

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
          value: '0x0000000000000000000000000000000000',
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

    const contractJsonAbi = {
      maps: [],
      functions: [
        {
          args: [
            { type: 'uint128', name: 'amount' },
            { type: 'string-ascii', name: 'desc' },
          ],
          name: 'test-contract-fn',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: 'uint128',
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
    const contractLogEvent1: DbSmartContractEvent = {
      event_index: 4,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block.block_height,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: testContractAddr,
      topic: 'some-topic',
      value: '0x0000000000000000000000000000000000',
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block.block_height,
      clarity_version: null,
      contract_id: testContractAddr,
      source_code: '(some-contract-src)',
      abi: JSON.stringify(contractJsonAbi),
    };
    const contractCall: DbTx = {
      tx_id: '0x1232000000000000000000000000000000000000000000000000000000000000',
      tx_index: 10,
      anchor_mode: 3,
      nonce: 0,
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: block.block_height,
      block_time: block.burn_block_time,
      burn_block_height: block.burn_block_height,
      burn_block_time: block.burn_block_time,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.ContractCall,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '0x',
      parent_index_block_hash: '0x',
      parent_block_hash: '0x',
      post_conditions: '0x01f5',
      fee_rate: 10n,
      sponsored: false,
      sponsor_address: testAddr1,
      sponsor_nonce: undefined,
      sender_address: testContractAddr,
      origin_hash_mode: 1,
      event_count: 5,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      contract_call_contract_id: testContractAddr,
      contract_call_function_name: 'test-contract-fn',
      contract_call_function_args: bufferToHex(
        createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
      ),
      abi: JSON.stringify(contractJsonAbi),
    };

    const dataStoreTxs = txs.map(DbTxRaw => {
      return {
        tx: DbTxRaw,
        stxLockEvents: [],
        stxEvents: [],
        ftEvents: [],
        nftEvents: [],
        contractLogEvents: [],
        smartContracts: [],
        names: [],
        namespaces: [],
        pox2Events: [],
        pox3Events: [],
        pox4Events: [],
      } as DataStoreTxEventData;
    });
    dataStoreTxs.push({
      tx: tx,
      stxLockEvents: [],
      stxEvents: events,
      ftEvents: ftEvents,
      nftEvents: nftEvents.flat(),
      contractLogEvents: [contractLogEvent1],
      smartContracts: [smartContract1],
      names: [],
      namespaces: [],
      pox2Events: [],
      pox3Events: [],
      pox4Events: [],
    });
    dataStoreTxs.push({
      tx: { ...contractCall, raw_tx: '0x' },
      stxLockEvents: [],
      stxEvents: [
        {
          canonical: true,
          event_type: DbEventTypeId.StxAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: 0,
          tx_id: contractCall.tx_id,
          tx_index: contractCall.tx_index,
          block_height: contractCall.block_height,
          amount: 4321n,
          sender: testAddr5,
          recipient: testAddr6,
        },
      ],
      ftEvents: [],
      nftEvents: [],
      contractLogEvents: [],
      smartContracts: [],
      names: [],
      namespaces: [],
      pox2Events: [],
      pox3Events: [],
      pox4Events: [],
    });
    await db.update({
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: dataStoreTxs,
    });

    const tokenOfferingLocked: DbTokenOfferingLocked = {
      address: testAddr2,
      value: BigInt(4139394444),
      block: 1,
    };
    await db.updateBatchTokenOfferingLocked(client, [tokenOfferingLocked]);

    const fetchAddrBalance1 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/balances`
    );
    expect(fetchAddrBalance1.status).toBe(200);
    expect(fetchAddrBalance1.type).toBe('application/json');
    const expectedResp1 = {
      stx: {
        balance: '88679',
        estimated_balance: '88679',
        total_sent: '6385',
        total_received: '100000',
        total_fees_sent: '4936',
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
            block_height: 1,
          },
        ],
      },
    };
    expect(JSON.parse(fetchAddrBalance1.text)).toEqual(expectedResp1);

    const fetchAddrBalance1AtBlock = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/balances?until_block=1`
    );
    expect(fetchAddrBalance1AtBlock.status).toBe(200);
    expect(fetchAddrBalance1AtBlock.type).toBe('application/json');

    const fetchAddrBalance2 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/balances`
    );
    expect(fetchAddrBalance2.status).toBe(200);
    expect(fetchAddrBalance2.type).toBe('application/json');
    const expectedResp2 = {
      stx: {
        balance: '91',
        estimated_balance: '91',
        total_sent: '15',
        total_received: '1350',
        total_fees_sent: '1244',
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
      block: 1,
    };

    await db.updateBatchTokenOfferingLocked(client, [tokenLocked]);
    const fetchAddrStxBalance1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/stx`
    );
    expect(fetchAddrStxBalance1.status).toBe(200);
    expect(fetchAddrStxBalance1.type).toBe('application/json');
    const expectedStxResp1 = {
      balance: '91',
      estimated_balance: '91',
      total_sent: '15',
      total_received: '1350',
      total_fees_sent: '1244',
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
            block_height: 1,
          },
        ],
      },
    };
    expect(JSON.parse(fetchAddrStxBalance1.text)).toEqual(expectedStxResp1);

    //test for sponsored transaction
    const fetchAddrStxBalanceSponsored = await supertest(api.server).get(
      `/extended/v1/address/${testAddr7}/stx`
    );
    expect(fetchAddrStxBalance1.status).toBe(200);
    expect(fetchAddrStxBalance1.type).toBe('application/json');
    const expectedStxResp1Sponsored = {
      balance: '3766',
      estimated_balance: '3766',
      total_sent: '0',
      total_received: '5000',
      total_fees_sent: '1234',
      total_miner_rewards_received: '0',
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
      lock_height: 0,
      lock_tx_id: '',
      locked: '0',
    };
    expect(JSON.parse(fetchAddrStxBalanceSponsored.text)).toEqual(expectedStxResp1Sponsored);

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
      total: 5,
      results: [
        {
          tx_id: '0x1232000000000000000000000000000000000000000000000000000000000000',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'contract_call',
          fee_rate: '10',
          is_unanchored: false,
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
          sponsor_address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          block_hash: '0x1234',
          block_height: 1,
          block_time: 39486,
          block_time_iso: '1970-01-01T10:58:06.000Z',
          burn_block_height: 100123123,
          burn_block_time: 39486,
          burn_block_time_iso: '1970-01-01T10:58:06.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '0x',
          microblock_sequence: I32_MAX,
          parent_block_hash: '0x',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          tx_index: 10,
          contract_call: {
            contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            function_name: 'test-contract-fn',
            function_signature:
              '(define-public (test-contract-fn (amount uint) (desc string-ascii)))',
            function_args: [
              {
                hex: '0x010000000000000000000000000001e240',
                name: 'amount',
                repr: 'u123456',
                type: 'uint',
              },
              {
                hex: '0x0d0000000568656c6c6f',
                name: 'desc',
                repr: '"hello"',
                type: 'string-ascii',
              },
            ],
          },
          event_count: 5,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        },
        {
          tx_id: '0x1234',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'coinbase',
          fee_rate: '1234',
          is_unanchored: false,
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          block_hash: '0x1234',
          block_height: 1,
          block_time: 39486,
          block_time_iso: '1970-01-01T10:58:06.000Z',
          burn_block_height: 100123123,
          burn_block_time: 39486,
          burn_block_time_iso: '1970-01-01T10:58:06.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '0x',
          microblock_sequence: I32_MAX,
          parent_block_hash: '0x',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          tx_index: 9,
          coinbase_payload: {
            data: '0x636f696e62617365206869',
            alt_recipient: null,
          },
          event_count: 5,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        },
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
          block_hash: '0x1234',
          block_height: 1,
          block_time: 39486,
          block_time_iso: '1970-01-01T10:58:06.000Z',
          burn_block_height: 100123123,
          burn_block_time: 39486,
          burn_block_time_iso: '1970-01-01T10:58:06.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '0x',
          microblock_sequence: I32_MAX,
          parent_block_hash: '0x',
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
          block_hash: '0x1234',
          block_height: 1,
          block_time: 39486,
          block_time_iso: '1970-01-01T10:58:06.000Z',
          burn_block_height: 100123123,
          burn_block_time: 39486,
          burn_block_time_iso: '1970-01-01T10:58:06.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '0x',
          microblock_sequence: I32_MAX,
          parent_block_hash: '0x',
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
          block_hash: '0x1234',
          block_height: 1,
          block_time: 39486,
          burn_block_height: 100123123,
          block_time_iso: '1970-01-01T10:58:06.000Z',
          burn_block_time: 39486,
          burn_block_time_iso: '1970-01-01T10:58:06.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '0x',
          microblock_sequence: I32_MAX,
          parent_block_hash: '0x',
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

    const fetchAddrTx2 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr5}/transactions`
    );
    expect(fetchAddrTx2.status).toBe(200);
    expect(fetchAddrTx2.type).toBe('application/json');
    const expectedResp5 = {
      limit: 20,
      offset: 0,
      total: 1,
      results: [
        {
          tx_id: '0x1232000000000000000000000000000000000000000000000000000000000000',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'contract_call',
          fee_rate: '10',
          is_unanchored: false,
          nonce: 0,
          anchor_mode: 'any',
          sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
          sponsor_address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          block_hash: '0x1234',
          block_height: 1,
          block_time: 39486,
          burn_block_height: 100123123,
          block_time_iso: '1970-01-01T10:58:06.000Z',
          burn_block_time: 39486,
          burn_block_time_iso: '1970-01-01T10:58:06.000Z',
          canonical: true,
          microblock_canonical: true,
          microblock_hash: '0x',
          microblock_sequence: I32_MAX,
          parent_block_hash: '0x',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          tx_index: 10,
          contract_call: {
            contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            function_name: 'test-contract-fn',
            function_signature:
              '(define-public (test-contract-fn (amount uint) (desc string-ascii)))',
            function_args: [
              {
                hex: '0x010000000000000000000000000001e240',
                name: 'amount',
                repr: 'u123456',
                type: 'uint',
              },
              {
                hex: '0x0d0000000568656c6c6f',
                name: 'desc',
                repr: '"hello"',
                type: 'string-ascii',
              },
            ],
          },
          event_count: 5,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        },
      ],
    };
    expect(JSON.parse(fetchAddrTx2.text)).toEqual(expectedResp5);

    const fetchAddrTx3 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr5}/transactions_with_transfers`
    );
    expect(fetchAddrTx3.status).toBe(200);
    expect(fetchAddrTx3.type).toBe('application/json');
    const expectedResp6 = {
      limit: 20,
      offset: 0,
      total: 1,
      results: [
        {
          ft_transfers: [],
          nft_transfers: [],
          stx_received: '0',
          stx_sent: '4321',
          stx_transfers: [
            {
              amount: '4321',
              recipient: 'ST2F8G7616B2F8PYG216BX9AJCHP7YRK7ND7M0ZN3',
              sender: 'ST3V11C6X2EBFN72RMS3B1NYQ1BX98F61GVYRDRXW',
            },
          ],
          tx: {
            anchor_mode: 'any',
            block_hash: '0x1234',
            block_height: 1,
            block_time: 39486,
            block_time_iso: '1970-01-01T10:58:06.000Z',
            burn_block_height: 100123123,
            burn_block_time: 39486,
            burn_block_time_iso: '1970-01-01T10:58:06.000Z',
            canonical: true,
            contract_call: {
              contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
              function_args: [
                {
                  hex: '0x010000000000000000000000000001e240',
                  name: 'amount',
                  repr: 'u123456',
                  type: 'uint',
                },
                {
                  hex: '0x0d0000000568656c6c6f',
                  name: 'desc',
                  repr: '"hello"',
                  type: 'string-ascii',
                },
              ],
              function_name: 'test-contract-fn',
              function_signature:
                '(define-public (test-contract-fn (amount uint) (desc string-ascii)))',
            },
            event_count: 5,
            events: [],
            execution_cost_read_count: 0,
            execution_cost_read_length: 0,
            execution_cost_runtime: 0,
            execution_cost_write_count: 0,
            execution_cost_write_length: 0,
            fee_rate: '10',
            is_unanchored: false,
            microblock_canonical: true,
            microblock_hash: '0x',
            microblock_sequence: 2147483647,
            nonce: 0,
            parent_block_hash: '0x',
            parent_burn_block_time: 1626122935,
            parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
            post_condition_mode: 'allow',
            post_conditions: [],
            sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            sponsor_address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
            sponsored: false,
            tx_id: '0x1232000000000000000000000000000000000000000000000000000000000000',
            tx_index: 10,
            tx_result: {
              hex: '0x0100000000000000000000000000000001',
              repr: 'u1',
            },
            tx_status: 'success',
            tx_type: 'contract_call',
          },
        },
      ],
    };
    expect(JSON.parse(fetchAddrTx3.text)).toEqual(expectedResp6);

    const fetchAddrTx4 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr5}/0x1232000000000000000000000000000000000000000000000000000000000000/with_transfers`
    );
    expect(fetchAddrTx4.status).toBe(200);
    expect(fetchAddrTx4.type).toBe('application/json');
    const expectedResp7 = {
      stx_received: '0',
      stx_sent: '4321',
      stx_transfers: [
        {
          amount: '4321',
          recipient: 'ST2F8G7616B2F8PYG216BX9AJCHP7YRK7ND7M0ZN3',
          sender: 'ST3V11C6X2EBFN72RMS3B1NYQ1BX98F61GVYRDRXW',
        },
      ],
      tx: {
        anchor_mode: 'any',
        block_hash: '0x1234',
        block_height: 1,
        block_time: 39486,
        block_time_iso: '1970-01-01T10:58:06.000Z',
        burn_block_height: 100123123,
        burn_block_time: 39486,
        burn_block_time_iso: '1970-01-01T10:58:06.000Z',
        canonical: true,
        contract_call: {
          contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
          function_args: [
            {
              hex: '0x010000000000000000000000000001e240',
              name: 'amount',
              repr: 'u123456',
              type: 'uint',
            },
            {
              hex: '0x0d0000000568656c6c6f',
              name: 'desc',
              repr: '"hello"',
              type: 'string-ascii',
            },
          ],
          function_name: 'test-contract-fn',
          function_signature:
            '(define-public (test-contract-fn (amount uint) (desc string-ascii)))',
        },
        event_count: 5,
        events: [],
        execution_cost_read_count: 0,
        execution_cost_read_length: 0,
        execution_cost_runtime: 0,
        execution_cost_write_count: 0,
        execution_cost_write_length: 0,
        fee_rate: '10',
        is_unanchored: false,
        microblock_canonical: true,
        microblock_hash: '0x',
        microblock_sequence: 2147483647,
        nonce: 0,
        parent_block_hash: '0x',
        parent_burn_block_time: 1626122935,
        parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
        post_condition_mode: 'allow',
        post_conditions: [],
        sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
        sponsor_address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
        sponsored: false,
        tx_id: '0x1232000000000000000000000000000000000000000000000000000000000000',
        tx_index: 10,
        tx_result: {
          hex: '0x0100000000000000000000000000000001',
          repr: 'u1',
        },
        tx_status: 'success',
        tx_type: 'contract_call',
      },
    };
    expect(JSON.parse(fetchAddrTx4.text)).toEqual(expectedResp7);

    const contractCallExpectedResults = {
      tx_id: '0x1232000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'contract_call',
      fee_rate: '10',
      is_unanchored: false,
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
      sponsor_address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      block_hash: '0x1234',
      block_height: 1,
      block_time: 39486,
      block_time_iso: '1970-01-01T10:58:06.000Z',
      burn_block_height: 100123123,
      burn_block_time: 39486,
      burn_block_time_iso: '1970-01-01T10:58:06.000Z',
      canonical: true,
      microblock_canonical: true,
      microblock_hash: '0x',
      microblock_sequence: I32_MAX,
      parent_block_hash: '0x',
      parent_burn_block_time: 1626122935,
      parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
      tx_index: 10,
      contract_call: {
        contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
        function_name: 'test-contract-fn',
        function_signature: '(define-public (test-contract-fn (amount uint) (desc string-ascii)))',
        function_args: [
          {
            hex: '0x010000000000000000000000000001e240',
            name: 'amount',
            repr: 'u123456',
            type: 'uint',
          },
          {
            hex: '0x0d0000000568656c6c6f',
            name: 'desc',
            repr: '"hello"',
            type: 'string-ascii',
          },
        ],
      },
      event_count: 5,
      events: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const blockTxsRows = await api.datastore.getBlockTxsRows(block.block_hash);
    expect(blockTxsRows.found).toBe(true);
    const blockTxsRowsResult = blockTxsRows.result as DbTxRaw[];
    const contractCallResult1 = blockTxsRowsResult.find(tx => tx.tx_id === contractCall.tx_id);
    expect({
      ...contractCallResult1,
      abi: JSON.parse(contractCallResult1?.abi ?? ''),
    }).toEqual({
      ...contractCall,
      ...{ abi: contractJsonAbi },
    });

    const searchResult8 = await supertest(api.server).get(
      `/extended/v1/search/0x1232000000000000000000000000000000000000000000000000000000000000?include_metadata=true`
    );
    expect(searchResult8.status).toBe(200);
    expect(searchResult8.type).toBe('application/json');
    expect(JSON.parse(searchResult8.text).result.metadata).toEqual(contractCallExpectedResults);

    const blockTxResult = await db.getTxsFromBlock({ hash: '0x1234' }, 20, 0);
    assert(blockTxResult.found);
    const contractCallResult2 = blockTxResult.result.results.find(
      tx => tx.tx_id === contractCall.tx_id
    );
    expect({
      ...contractCallResult2,
      abi: JSON.parse(contractCallResult2?.abi ?? ''),
    }).toEqual({
      ...contractCall,
      ...{ abi: contractJsonAbi },
    });
  });

  test('address - sponsor nonces', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 1594647995,
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
      tx_count: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };
    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: BigInt(556) }],
      fee: 200,
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      nonce: 0,
      sponsored: true,
      anchorMode: AnchorMode.Any,
    });
    const sponsoredTx = await sponsorTransaction({
      transaction: txBuilder,
      sponsorPrivateKey: '381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301',
      fee: 300,
      sponsorNonce: 2,
    });
    const serialized = Buffer.from(sponsoredTx.serialize());
    const tx = decodeTransaction(serialized);
    const DbTxRaw = createDbTxFromCoreMsg({
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
      raw_tx: '0x',
      parsed_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: dbBlock.index_block_hash,
      parent_index_block_hash: dbBlock.parent_index_block_hash,
      parent_block_hash: dbBlock.parent_block_hash,
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      block_hash: dbBlock.block_hash,
      block_time: dbBlock.burn_block_time,
      block_height: dbBlock.block_height,
      burn_block_height: dbBlock.burn_block_height,
      burn_block_time: dbBlock.burn_block_time,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    });
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
    const smartContract: DbSmartContract = {
      tx_id: DbTxRaw.tx_id,
      canonical: true,
      clarity_version: null,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: dbBlock.block_height,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    };
    await db.update({
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: DbTxRaw,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [smartContract],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    });

    const senderAddress = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';
    const sponsor_address = 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0';

    //sender nonce
    const expectedResp = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: 0,
      last_mempool_tx_nonce: null,
      possible_next_nonce: 1,
    };
    const sender_nonces = await supertest(api.server).get(
      `/extended/v1/address/${senderAddress}/nonces`
    );
    expect(sender_nonces.status).toBe(200);
    expect(sender_nonces.type).toBe('application/json');
    expect(JSON.parse(sender_nonces.text)).toEqual(expectedResp);

    //sponsor_nonce
    const expectedResp2 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: 2,
      last_mempool_tx_nonce: null,
      possible_next_nonce: 3,
    };
    const sponsor_nonces = await supertest(api.server).get(
      `/extended/v1/address/${sponsor_address}/nonces`
    );
    expect(sponsor_nonces.status).toBe(200);
    expect(sponsor_nonces.type).toBe('application/json');
    expect(JSON.parse(sponsor_nonces.text)).toEqual(expectedResp2);

    const mempoolTx: DbMempoolTxRaw = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 1,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: true,
      sponsor_address: sponsor_address,
      sender_address: senderAddress,
      sponsor_nonce: 3,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    //mempool sender nonce
    const expectedResp3 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: 0,
      last_mempool_tx_nonce: 1,
      possible_next_nonce: 2,
    };
    const mempool_sender_nonces = await supertest(api.server).get(
      `/extended/v1/address/${senderAddress}/nonces`
    );
    expect(mempool_sender_nonces.status).toBe(200);
    expect(mempool_sender_nonces.type).toBe('application/json');
    expect(JSON.parse(mempool_sender_nonces.text)).toEqual(expectedResp3);

    //mempool sponsor_nonce
    const expectedResp4 = {
      detected_missing_nonces: [],
      detected_mempool_nonces: [],
      last_executed_tx_nonce: 2,
      last_mempool_tx_nonce: 3,
      possible_next_nonce: 4,
    };
    const mempool_sponsor_nonces = await supertest(api.server).get(
      `/extended/v1/address/${sponsor_address}/nonces`
    );
    expect(mempool_sponsor_nonces.status).toBe(200);
    expect(mempool_sponsor_nonces.type).toBe('application/json');
    expect(JSON.parse(mempool_sponsor_nonces.text)).toEqual(expectedResp4);

    /**
     * Sponsor detected missing nonce
     */

    const mempoolTx1: DbMempoolTxRaw = {
      tx_id: '0x52123456',
      anchor_mode: 3,
      nonce: 1,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: true,
      sponsor_address: sponsor_address,
      sender_address: senderAddress,
      sponsor_nonce: 6,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1] });

    const expectedResp5 = {
      detected_missing_nonces: [5, 4],
      detected_mempool_nonces: [3],
      last_executed_tx_nonce: 2,
      last_mempool_tx_nonce: 6,
      possible_next_nonce: 7,
    };
    const detected_missing_nonce = await supertest(api.server).get(
      `/extended/v1/address/${sponsor_address}/nonces`
    );
    expect(detected_missing_nonce.status).toBe(200);
    expect(detected_missing_nonce.type).toBe('application/json');
    expect(JSON.parse(detected_missing_nonce.text)).toEqual(expectedResp5);
  });

  test('exclusive address endpoints params', async () => {
    const addressEndpoints = [
      '/stx',
      '/balances',
      '/transactions',
      '/transactions_with_transfers',
      '/assets',
      '/stx_inbound',
    ];

    //check for mutually exclusive unachored and and until_block
    for (const path of addressEndpoints) {
      const response = await supertest(api.server).get(
        `/extended/v1/address/STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6${path}?until_block=5&unanchored=true`
      );
      expect(response.status).toBe(400);
    }
  });

  test('/transactions materialized view separates anchored and unanchored counts correctly', async () => {
    const contractId = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.megapont-ape-club-nft';

    // Base block
    const block1 = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x01',
      index_block_hash: '0x01',
    })
      .addTx()
      .addTxSmartContract({ contract_id: contractId })
      .addTxContractLogEvent({ contract_identifier: contractId })
      .build();
    await db.update(block1);

    // Create 50 contract txs to fill up the materialized view at block_height=2
    const blockBuilder2 = new TestBlockBuilder({
      block_height: 2,
      block_hash: '0x02',
      index_block_hash: '0x02',
      parent_block_hash: '0x01',
      parent_index_block_hash: '0x01',
    });
    for (let i = 0; i < 50; i++) {
      blockBuilder2.addTx({
        tx_id: '0x1234' + i.toString().padStart(4, '0'),
        index_block_hash: '0x02',
        smart_contract_contract_id: contractId,
      });
    }
    const block2 = blockBuilder2.build();
    await db.update(block2);

    // Now create 10 contract txs in the next microblock.
    const mbData: DataStoreMicroblockUpdateData = {
      microblocks: [
        {
          microblock_hash: '0xff01',
          microblock_sequence: 0,
          microblock_parent_hash: block2.block.block_hash,
          parent_index_block_hash: block2.block.index_block_hash,
          parent_burn_block_height: 123,
          parent_burn_block_hash: '0xaa',
          parent_burn_block_time: 1626122935,
        },
      ],
      txs: [],
    };
    for (let i = 0; i < 10; i++) {
      mbData.txs.push({
        tx: {
          tx_id: '0x1235' + i.toString().padStart(4, '0'),
          tx_index: 0,
          anchor_mode: 3,
          nonce: 0,
          raw_tx: '0x',
          type_id: DbTxTypeId.TokenTransfer,
          status: 1,
          raw_result: '0x0100000000000000000000000000000001', // u1
          canonical: true,
          post_conditions: '0x01f5',
          fee_rate: 1234n,
          sponsored: false,
          sender_address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          sponsor_address: undefined,
          origin_hash_mode: 1,
          token_transfer_amount: 50n,
          token_transfer_memo: bufferToHex(Buffer.from('hi')),
          token_transfer_recipient_address: contractId,
          event_count: 1,
          parent_index_block_hash: block2.block.index_block_hash,
          parent_block_hash: block2.block.block_hash,
          microblock_canonical: true,
          microblock_sequence: mbData.microblocks[0].microblock_sequence,
          microblock_hash: mbData.microblocks[0].microblock_hash,
          parent_burn_block_time: mbData.microblocks[0].parent_burn_block_time,
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          smart_contract_contract_id: contractId,
          index_block_hash: '',
          block_hash: '',
          block_time: -1,
          burn_block_height: -1,
          burn_block_time: -1,
          block_height: -1,
        },
        stxLockEvents: [],
        stxEvents: [],
        ftEvents: [],
        nftEvents: [],
        contractLogEvents: [],
        smartContracts: [],
        names: [],
        namespaces: [],
        pox2Events: [],
        pox3Events: [],
        pox4Events: [],
      });
    }
    await db.updateMicroblocks(mbData);

    // Anchored results first page should be 50 (50 at block_height=2)
    const anchoredResult = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions?limit=50&unanchored=false`
    );
    expect(anchoredResult.status).toBe(200);
    expect(anchoredResult.type).toBe('application/json');
    expect(JSON.parse(anchoredResult.text).total).toEqual(50); // 50 txs up to block_height=2
    expect(JSON.parse(anchoredResult.text).results.length).toEqual(50);

    // Unanchored results first page should also be 50 (40 at block_height=2, 10 at unanchored block_height=3)
    const unanchoredResult = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions?limit=50&unanchored=true`
    );
    expect(unanchoredResult.status).toBe(200);
    expect(unanchoredResult.type).toBe('application/json');
    expect(JSON.parse(unanchoredResult.text).total).toEqual(60); // 60 txs up to unanchored block_height=3
    expect(JSON.parse(unanchoredResult.text).results.length).toEqual(50);
  });

  test('/transactions endpoint handles re-orgs correctly', async () => {
    const contractId = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.megapont-ape-club-nft';

    // Base block
    const block1 = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x01',
      index_block_hash: '0x01',
    })
      .addTx()
      .addTxSmartContract({ contract_id: contractId })
      .addTxContractLogEvent({ contract_identifier: contractId })
      .build();
    await db.update(block1);

    // Canonical block with non-canonical tx
    const block2 = new TestBlockBuilder({
      block_height: 2,
      block_hash: '0x02',
      index_block_hash: '0x02',
      parent_block_hash: '0x01',
      parent_index_block_hash: '0x01',
    })
      .addTx({
        tx_id: '0x123123',
        smart_contract_contract_id: contractId,
        canonical: false, // <--
      })
      .build();
    await db.update(block2);

    // Canonical block with canonical tx
    const block3 = new TestBlockBuilder({
      block_height: 3,
      block_hash: '0x03',
      index_block_hash: '0x03',
      parent_block_hash: '0x02',
      parent_index_block_hash: '0x02',
    })
      .addTx({
        tx_id: '0x123123', // Same tx_id
        smart_contract_contract_id: contractId,
      })
      .build();
    await db.update(block3);

    // Transaction is reported with correct block_height
    const result1 = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions`
    );
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');
    const json1 = JSON.parse(result1.text);
    expect(json1.total).toEqual(1);
    expect(json1.results.length).toEqual(1);
    expect(json1.results[0].tx_id).toEqual('0x123123');
    expect(json1.results[0].block_height).toEqual(3);

    // Non-canonical block with tx
    const block4 = new TestBlockBuilder({
      block_height: 4,
      block_hash: '0x04',
      index_block_hash: '0x04',
      parent_block_hash: '0x03',
      parent_index_block_hash: '0x03',
      canonical: false,
    })
      .addTx({ tx_id: '0x11a1', smart_contract_contract_id: contractId, canonical: false })
      .build();
    await db.update(block4);

    // Transaction not reported in results
    const result2 = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions`
    );
    expect(result2.status).toBe(200);
    expect(result2.type).toBe('application/json');
    const json2 = JSON.parse(result2.text);
    expect(json2.total).toEqual(1);
    expect(json2.results.length).toEqual(1);

    // New canonical block restores previous non-canonical block
    const block5 = new TestBlockBuilder({
      block_height: 5,
      block_hash: '0x05',
      index_block_hash: '0x05',
      parent_block_hash: '0x04',
      parent_index_block_hash: '0x04',
    })
      .addTx({ tx_id: '0x1112' })
      .build();
    await db.update(block5);

    // Transaction is now reported in results
    const result3 = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions`
    );
    expect(result3.status).toBe(200);
    expect(result3.type).toBe('application/json');
    const json3 = JSON.parse(result3.text);
    expect(json3.total).toEqual(2);
    expect(json3.results.length).toEqual(2);
    expect(json3.results[0].tx_id).toEqual('0x11a1');

    // Microblock with non-canonical tx
    const microblock1 = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0xbb01',
        parent_index_block_hash: '0x05',
        microblock_sequence: 0,
      })
      .addTx({
        tx_id: '0x11a2',
        smart_contract_contract_id: contractId,
        microblock_canonical: false,
        index_block_hash: '0x06',
      })
      .build();
    await db.updateMicroblocks(microblock1);

    // TODO: invalid test, the above function `db.updateMicroblocks` does not use the `microblock_canonical: false` property
    /*
    // Transaction not reported in results
    const result4 = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions?unanchored=true`
    );
    expect(result4.status).toBe(200);
    expect(result4.type).toBe('application/json');
    const json4 = JSON.parse(result4.text);
    expect(json4.total).toEqual(2);
    expect(json4.results.length).toEqual(2);
    */

    // Confirm with anchor block
    const block6 = new TestBlockBuilder({
      block_height: 6,
      block_hash: '0x06',
      index_block_hash: '0x06',
      parent_block_hash: '0x05',
      parent_index_block_hash: '0x05',
      parent_microblock_hash: '0xbb01', // Point to latest microblock
      parent_microblock_sequence: 0,
    })
      .addTx()
      .build();
    await db.update(block6);

    // Transaction is now reported in results
    const result5 = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions`
    );
    expect(result5.status).toBe(200);
    expect(result5.type).toBe('application/json');
    const json5 = JSON.parse(result5.text);
    expect(json5.total).toEqual(3);
    expect(json5.results.length).toEqual(3);
    expect(json5.results[0].tx_id).toEqual('0x11a2');

    // New anchor block with included tx.
    const block7 = new TestBlockBuilder({
      block_height: 7,
      block_hash: '0x07',
      index_block_hash: '0x07',
      parent_block_hash: '0x06',
      parent_index_block_hash: '0x06',
    })
      .addTx({
        tx_id: '0xffa1',
        smart_contract_contract_id: contractId,
        index_block_hash: '0x07',
      })
      .build();
    await db.update(block7);

    // New non-canonical anchor block **also with block height = 7**
    // Includes the same transaction with the same `tx_id` but on a different `index_block_hash`.
    const block7_b = new TestBlockBuilder({
      block_height: 7,
      block_hash: '0x07',
      index_block_hash: '0x07bb',
      parent_block_hash: '0x06',
      parent_index_block_hash: '0x06',
      canonical: false, // Block marked as non-canonical.
    })
      .addTx({
        tx_id: '0xffa1',
        smart_contract_contract_id: contractId,
        index_block_hash: '0x07bb',
        canonical: false,
      })
      .build();
    await db.update(block7_b);

    // Transaction is reported in results.
    const result6 = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions`
    );
    expect(result6.status).toBe(200);
    expect(result6.type).toBe('application/json');
    const json6 = JSON.parse(result6.text);
    expect(json6.total).toEqual(4);
    expect(json6.results.length).toEqual(4);
    expect(json6.results[0].tx_id).toEqual('0xffa1');
  });
});
