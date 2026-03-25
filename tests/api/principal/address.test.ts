import supertest from 'supertest';
import assert from 'node:assert/strict';
import { createClarityValueArray } from '../../test-helpers.ts';
import codec from '@stacks/codec';
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
} from '../../../src/datastore/common.ts';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { I32_MAX } from '../../../src/helpers.ts';
import { TestBlockBuilder, testMempoolTx, TestMicroblockStreamBuilder } from '../test-builders.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { createDbTxFromCoreMsg } from '../../../src/datastore/helpers.ts';
import { PgSqlClient, bufferToHex } from '@stacks/api-toolkit';
import { migrate } from '../../test-helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import {
  serializeCV,
  uintCV,
  stringAsciiCV,
  makeContractCall,
  ClarityType,
  sponsorTransaction,
  ClarityAbi,
} from '@stacks/transactions';
import { STACKS_TESTNET } from '@stacks/network';

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
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
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
      tx_total_size: 1,
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
    assert.equal(fetch1.status, 200);
    assert.equal(fetch1.type, 'application/json');
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
            vm_error: null,
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
            vm_error: null,
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
            vm_error: null,
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
    assert.deepEqual(fetch1Json, expected1);

    // Test v2 endpoints
    const v2Fetch1 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions`
    );
    assert.equal(v2Fetch1.status, 200);
    assert.equal(v2Fetch1.type, 'application/json');
    const v2Fetch1Json = JSON.parse(v2Fetch1.text);
    assert.equal(v2Fetch1Json.total, 7);
    assert.deepEqual(v2Fetch1Json.results[0].tx, expected1.results[0].tx);
    assert.equal(v2Fetch1Json.results[0].stx_sent, '1339');
    assert.equal(v2Fetch1Json.results[0].stx_received, '0');
    assert.deepEqual(v2Fetch1Json.results[0].events.stx, {
      transfer: 3,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[0].events.ft, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[0].events.nft, {
      transfer: 2,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[1].tx, expected1.results[1].tx);
    assert.equal(v2Fetch1Json.results[1].stx_sent, '1484');
    assert.equal(v2Fetch1Json.results[1].stx_received, '0');
    assert.deepEqual(v2Fetch1Json.results[1].events.stx, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[1].events.ft, {
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[1].events.nft, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[2].tx, expected1.results[2].tx);
    assert.equal(v2Fetch1Json.results[2].stx_sent, '1334');
    assert.equal(v2Fetch1Json.results[2].stx_received, '0');
    assert.deepEqual(v2Fetch1Json.results[2].events.stx, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[2].events.ft, {
      transfer: 2,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[2].events.nft, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.equal(v2Fetch1Json.results[4].stx_sent, '0');
    assert.equal(v2Fetch1Json.results[4].stx_received, '0');
    assert.deepEqual(v2Fetch1Json.results[4].events.stx, {
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[4].events.ft, {
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[4].events.nft, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.equal(v2Fetch1Json.results[5].stx_sent, '0');
    assert.equal(v2Fetch1Json.results[5].stx_received, '0');
    assert.deepEqual(v2Fetch1Json.results[5].events.stx, {
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[5].events.ft, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[5].events.nft, {
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    assert.equal(v2Fetch1Json.results[6].stx_sent, '0');
    assert.equal(v2Fetch1Json.results[6].stx_received, '0');
    assert.deepEqual(v2Fetch1Json.results[6].events.stx, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[6].events.ft, {
      transfer: 0,
      mint: 0,
      burn: 0,
    });
    assert.deepEqual(v2Fetch1Json.results[6].events.nft, {
      transfer: 0,
      mint: 0,
      burn: 0,
    });

    // fetch with offset
    const v2Fetch1offset = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions?offset=1`
    );
    assert.equal(v2Fetch1offset.status, 200);
    assert.equal(v2Fetch1offset.type, 'application/json');
    const v2Fetch1offsetJson = JSON.parse(v2Fetch1offset.text);
    assert.equal(v2Fetch1offsetJson.total, 7);
    // Verify offset actually skips the first result
    assert.equal(v2Fetch1offsetJson.results.length, 6);
    assert.equal(v2Fetch1offsetJson.results[0].tx.tx_id, v2Fetch1Json.results[1].tx.tx_id);

    const v2Fetch2 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions/${v2Fetch1Json.results[0].tx.tx_id}/events?limit=3`
    );
    assert.equal(v2Fetch2.status, 200);
    assert.equal(v2Fetch2.type, 'application/json');
    assert.deepEqual(JSON.parse(v2Fetch2.text), {
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
    assert.equal(v2Fetch3.status, 200);
    assert.equal(v2Fetch3.type, 'application/json');
    assert.deepEqual(JSON.parse(v2Fetch3.text), {
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
    assert.equal(v2Fetch4.status, 200);
    assert.equal(v2Fetch4.type, 'application/json');
    assert.equal(v2Fetch4.body.total, 1);
    assert.deepEqual(v2Fetch4.body.results[0].events.ft, {
      transfer: 1,
      mint: 0,
      burn: 0,
    });
    assert.equal(v2Fetch4.body.results[0].stx_sent, '0');
    assert.equal(v2Fetch4.body.results[0].stx_received, '0');

    const v2Fetch4Events = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr5}/transactions/${addr3FtEvent.tx_id}/events`
    );
    assert.equal(v2Fetch4Events.status, 200);
    assert.equal(v2Fetch4Events.type, 'application/json');
    assert.equal(v2Fetch4Events.body.total, 1);
    assert.deepEqual(v2Fetch4Events.body.results[0], {
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
    assert.equal(fetchSingleTxInformation.status, 200);
    assert.equal(fetchSingleTxInformation.type, 'application/json');
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
        vm_error: null,
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
    assert.deepEqual(JSON.parse(fetchSingleTxInformation.text), expectedSingleTxInformation);

    // testing for multiple tx_ids given a single stx addr
    const fetch2 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr4}/transactions_with_transfers?limit=2`
    );
    assert.equal(fetch2.status, 200);
    assert.equal(fetch2.type, 'application/json');
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
            vm_error: null,
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
            vm_error: null,
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
    assert.deepEqual(JSON.parse(fetch2.text), expected2);

    // Cursor fetch
    const cursorFetch1 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions?limit=2`
    );
    const cursorFetch1Json = JSON.parse(cursorFetch1.text);
    assert.notEqual(cursorFetch1Json.cursor, undefined);
    assert.equal(cursorFetch1Json.limit, 2);
    assert.equal(cursorFetch1Json.offset, 0);
    assert.equal(cursorFetch1Json.total, 7);
    assert.equal(cursorFetch1Json.results.length, 2);
    assert.deepEqual(cursorFetch1Json.results[0].tx, v2Fetch1Json.results[0].tx);
    assert.deepEqual(cursorFetch1Json.results[1].tx, v2Fetch1Json.results[1].tx);
    assert.equal(cursorFetch1Json.next_cursor, null);
    assert.notEqual(cursorFetch1Json.prev_cursor, undefined);

    // First cursor should be equivalent to the original fetch
    const cursorFetch2 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions?cursor=${cursorFetch1Json.cursor}&limit=2`
    );
    const cursorFetch2Json = JSON.parse(cursorFetch2.text);
    assert.equal(cursorFetch2Json.cursor, cursorFetch1Json.cursor);
    assert.equal(cursorFetch2Json.limit, 2);
    assert.equal(cursorFetch2Json.offset, 0);
    assert.equal(cursorFetch2Json.total, 7);
    assert.equal(cursorFetch2Json.results.length, 2);
    assert.deepEqual(cursorFetch2Json.results[0].tx, v2Fetch1Json.results[0].tx);
    assert.deepEqual(cursorFetch2Json.results[1].tx, v2Fetch1Json.results[1].tx);
    assert.equal(cursorFetch2Json.next_cursor, null);
    assert.notEqual(cursorFetch2Json.prev_cursor, null);

    // Go back one page
    const cursorFetch3 = await supertest(api.server).get(
      `/extended/v2/addresses/${testAddr2}/transactions?cursor=${cursorFetch2Json.prev_cursor}&limit=2`
    );
    const cursorFetch3Json = JSON.parse(cursorFetch3.text);
    assert.equal(cursorFetch3Json.cursor, cursorFetch2Json.prev_cursor);
    assert.equal(cursorFetch3Json.limit, 2);
    assert.equal(cursorFetch3Json.offset, 0);
    assert.equal(cursorFetch3Json.total, 7);
    assert.equal(cursorFetch3Json.results.length, 2);
    assert.deepEqual(cursorFetch3Json.results[0].tx, v2Fetch1Json.results[2].tx);
    assert.deepEqual(cursorFetch3Json.results[1].tx, v2Fetch1Json.results[3].tx);
    assert.equal(cursorFetch3Json.next_cursor, cursorFetch2Json.cursor);
    assert.notEqual(cursorFetch3Json.prev_cursor, null);
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
    assert.equal(nonceResults1.status, 200);
    assert.equal(nonceResults1.type, 'application/json');
    assert.deepEqual(nonceResults1.body, expectedNonceResults1);

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
    assert.equal(nonceResults2.status, 200);
    assert.equal(nonceResults2.type, 'application/json');
    assert.deepEqual(nonceResults2.body, expectedNonceResults2);

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
    assert.equal(nonceResults3.status, 200);
    assert.equal(nonceResults3.type, 'application/json');
    assert.deepEqual(nonceResults3.body, expectedNonceResults3);

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
    assert.equal(nonceResults4.status, 200);
    assert.equal(nonceResults4.type, 'application/json');
    assert.deepEqual(nonceResults4.body, expectedNonceResults4);

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
    assert.equal(nonceResultsNoTxs1.status, 200);
    assert.equal(nonceResultsNoTxs1.type, 'application/json');
    assert.deepEqual(nonceResultsNoTxs1.body, expectedNonceResultsNoTxs1);

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
    assert.equal(nonceResultsNoTxs2.status, 200);
    assert.equal(nonceResultsNoTxs2.type, 'application/json');
    assert.deepEqual(nonceResultsNoTxs2.body, expectedNonceResultsNoTxs2);

    // Bad requests
    const nonceResults5 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_hash=xcvbnmn`
    );
    assert.equal(nonceResults5.status, 400);

    const nonceResults6 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_height=xcvbnmn`
    );
    assert.equal(nonceResults6.status, 400);

    const nonceResults7 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_height=xcvbnmn&block_hash=xcvbnmn`
    );
    assert.equal(nonceResults7.status, 400);

    const nonceResults8 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr1}/nonces?block_height=999999999`
    );
    assert.equal(nonceResults8.status, 404);
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
      tx_total_size: 1,
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
    assert.equal(fetchAddrBalance1.status, 200);
    assert.equal(fetchAddrBalance1.type, 'application/json');
    assert.equal(
      fetchAddrBalance1.headers['warning'],
      '299 - "Deprecated: See https://docs.hiro.so/stacks/api for more information"'
    );
    const expectedResp1 = {
      stx: {
        balance: '88679',
        estimated_balance: '88679',
        pending_balance_inbound: '0',
        pending_balance_outbound: '0',
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
    assert.deepEqual(JSON.parse(fetchAddrBalance1.text), expectedResp1);

    const fetchAddrBalance1AtBlock = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/balances?until_block=1`
    );
    assert.equal(fetchAddrBalance1AtBlock.status, 200);
    assert.equal(fetchAddrBalance1AtBlock.type, 'application/json');

    const fetchAddrBalance2 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/balances`
    );
    assert.equal(fetchAddrBalance2.status, 200);
    assert.equal(fetchAddrBalance2.type, 'application/json');
    const expectedResp2 = {
      stx: {
        balance: '91',
        estimated_balance: '91',
        pending_balance_inbound: '0',
        pending_balance_outbound: '0',
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
    assert.deepEqual(JSON.parse(fetchAddrBalance2.text), expectedResp2);

    const fetchAddrV2BalanceStx = await supertest(api.server).get(
      `/extended/v2/addresses/${testContractAddr}/balances/stx`
    );
    assert.equal(fetchAddrV2BalanceStx.status, 200);
    assert.equal(fetchAddrV2BalanceStx.type, 'application/json');
    assert.deepEqual(fetchAddrV2BalanceStx.body, {
      balance: '131',
      total_miner_rewards_received: '0',
      lock_tx_id: '',
      locked: '0',
      lock_height: 0,
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
    });

    const fetchAddrV2BalanceStxWithMempool = await supertest(api.server).get(
      `/extended/v2/addresses/${testContractAddr}/balances/stx?include_mempool=true`
    );
    assert.equal(fetchAddrV2BalanceStxWithMempool.status, 200);
    assert.equal(fetchAddrV2BalanceStxWithMempool.type, 'application/json');
    assert.deepEqual(fetchAddrV2BalanceStxWithMempool.body, {
      balance: '131',
      estimated_balance: '131',
      pending_balance_inbound: '0',
      pending_balance_outbound: '0',
      total_miner_rewards_received: '0',
      lock_tx_id: '',
      locked: '0',
      lock_height: 0,
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
    });

    const fetchAddrV2BalanceFts = await supertest(api.server).get(
      `/extended/v2/addresses/${testContractAddr}/balances/ft`
    );
    assert.equal(fetchAddrV2BalanceFts.status, 200);
    assert.equal(fetchAddrV2BalanceFts.type, 'application/json');
    assert.deepEqual(fetchAddrV2BalanceFts.body, {
      limit: 100,
      offset: 0,
      total: 2,
      results: [
        { token: 'bux', balance: '375' },
        { token: 'gox', balance: '585' },
      ],
    });

    const fetchAddrV2BalanceFtsPaginated = await supertest(api.server).get(
      `/extended/v2/addresses/${testContractAddr}/balances/ft?limit=1&offset=1`
    );
    assert.equal(fetchAddrV2BalanceFtsPaginated.status, 200);
    assert.equal(fetchAddrV2BalanceFtsPaginated.type, 'application/json');
    assert.deepEqual(fetchAddrV2BalanceFtsPaginated.body, {
      limit: 1,
      offset: 1,
      total: 2,
      results: [{ token: 'gox', balance: '585' }],
    });

    const fetchAddrV2BalanceFt1 = await supertest(api.server).get(
      `/extended/v2/addresses/${testContractAddr}/balances/ft/bux`
    );
    assert.equal(fetchAddrV2BalanceFt1.status, 200);
    assert.equal(fetchAddrV2BalanceFt1.type, 'application/json');
    assert.deepEqual(fetchAddrV2BalanceFt1.body, { balance: '375' });

    const fetchAddrV2BalanceFt2 = await supertest(api.server).get(
      `/extended/v2/addresses/${testContractAddr}/balances/ft/gox`
    );
    assert.equal(fetchAddrV2BalanceFt2.status, 200);
    assert.equal(fetchAddrV2BalanceFt2.type, 'application/json');
    assert.deepEqual(fetchAddrV2BalanceFt2.body, { balance: '585' });

    const fetchAddrV2BalanceFt3 = await supertest(api.server).get(
      `/extended/v2/addresses/${testContractAddr}/balances/ft/none`
    );
    assert.equal(fetchAddrV2BalanceFt3.status, 200);
    assert.equal(fetchAddrV2BalanceFt3.type, 'application/json');
    assert.deepEqual(fetchAddrV2BalanceFt3.body, { balance: '0' });

    const tokenLocked: DbTokenOfferingLocked = {
      address: testContractAddr,
      value: BigInt(4139391122),
      block: 1,
    };

    await db.updateBatchTokenOfferingLocked(client, [tokenLocked]);
    const fetchAddrStxBalance1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/stx`
    );
    assert.equal(fetchAddrStxBalance1.status, 200);
    assert.equal(fetchAddrStxBalance1.type, 'application/json');
    const expectedStxResp1 = {
      balance: '91',
      estimated_balance: '91',
      pending_balance_inbound: '0',
      pending_balance_outbound: '0',
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
    assert.deepEqual(JSON.parse(fetchAddrStxBalance1.text), expectedStxResp1);

    //test for sponsored transaction
    const fetchAddrStxBalanceSponsored = await supertest(api.server).get(
      `/extended/v1/address/${testAddr7}/stx`
    );
    assert.equal(fetchAddrStxBalance1.status, 200);
    assert.equal(fetchAddrStxBalance1.type, 'application/json');
    const expectedStxResp1Sponsored = {
      balance: '3766',
      estimated_balance: '3766',
      pending_balance_inbound: '0',
      pending_balance_outbound: '0',
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
    assert.deepEqual(JSON.parse(fetchAddrStxBalanceSponsored.text), expectedStxResp1Sponsored);

    const fetchAddrAssets1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/assets?limit=8&offset=2`
    );
    assert.equal(fetchAddrAssets1.status, 200);
    assert.equal(fetchAddrAssets1.type, 'application/json');
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
    assert.deepEqual(JSON.parse(fetchAddrAssets1.text), expectedResp3);

    const fetchAddrTx1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/transactions`
    );
    assert.equal(fetchAddrTx1.status, 200);
    assert.equal(fetchAddrTx1.type, 'application/json');
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
          vm_error: null,
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
          vm_error: null,
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
          vm_error: null,
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
          vm_error: null,
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
          vm_error: null,
        },
      ],
    };
    assert.deepEqual(JSON.parse(fetchAddrTx1.text), expectedResp4);

    const fetchAddrTx2 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr5}/transactions`
    );
    assert.equal(fetchAddrTx2.status, 200);
    assert.equal(fetchAddrTx2.type, 'application/json');
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
          vm_error: null,
        },
      ],
    };
    assert.deepEqual(JSON.parse(fetchAddrTx2.text), expectedResp5);

    const fetchAddrTx3 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr5}/transactions_with_transfers`
    );
    assert.equal(fetchAddrTx3.status, 200);
    assert.equal(fetchAddrTx3.type, 'application/json');
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
            vm_error: null,
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
    assert.deepEqual(JSON.parse(fetchAddrTx3.text), expectedResp6);

    const fetchAddrTx4 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr5}/0x1232000000000000000000000000000000000000000000000000000000000000/with_transfers`
    );
    assert.equal(fetchAddrTx4.status, 200);
    assert.equal(fetchAddrTx4.type, 'application/json');
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
        vm_error: null,
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
    assert.deepEqual(JSON.parse(fetchAddrTx4.text), expectedResp7);

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
      vm_error: null,
    };

    const blockTxsRows = await api.datastore.getBlockTxsRows(block.block_hash);
    assert.equal(blockTxsRows.found, true);
    const blockTxsRowsResult = blockTxsRows.result as DbTxRaw[];
    const contractCallResult1 = blockTxsRowsResult.find(tx => tx.tx_id === contractCall.tx_id);
    assert.deepEqual(
      {
        ...contractCallResult1,
        abi: JSON.parse(contractCallResult1?.abi ?? ''),
      },
      {
        ...contractCall,
        ...{ abi: contractJsonAbi, vm_error: null },
      }
    );

    const searchResult8 = await supertest(api.server).get(
      `/extended/v1/search/0x1232000000000000000000000000000000000000000000000000000000000000?include_metadata=true`
    );
    assert.equal(searchResult8.status, 200);
    assert.equal(searchResult8.type, 'application/json');
    assert.deepEqual(JSON.parse(searchResult8.text).result.metadata, contractCallExpectedResults);

    const blockTxResult = await db.getTxsFromBlock({ hash: '0x1234' }, 20, 0);
    assert(blockTxResult.found);
    const contractCallResult2 = blockTxResult.result.results.find(
      tx => tx.tx_id === contractCall.tx_id
    );
    assert.deepEqual(
      {
        ...contractCallResult2,
        abi: JSON.parse(contractCallResult2?.abi ?? ''),
      },
      {
        ...contractCall,
        ...{ abi: contractJsonAbi, vm_error: null },
      }
    );
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
      tx_total_size: 1,
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
    });
    const sponsoredTx = await sponsorTransaction({
      transaction: txBuilder,
      sponsorPrivateKey: '381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301',
      fee: 300,
      sponsorNonce: 2,
    });
    const serialized = Buffer.from(sponsoredTx.serialize());
    const tx = codec.decodeTransaction(serialized);
    const DbTxRaw = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_interface: null,
        microblock_hash: null,
        microblock_parent_hash: null,
        microblock_sequence: null,
        vm_error: null,
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
    assert.equal(sender_nonces.status, 200);
    assert.equal(sender_nonces.type, 'application/json');
    assert.deepEqual(JSON.parse(sender_nonces.text), expectedResp);

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
    assert.equal(sponsor_nonces.status, 200);
    assert.equal(sponsor_nonces.type, 'application/json');
    assert.deepEqual(JSON.parse(sponsor_nonces.text), expectedResp2);

    const mempoolTx: DbMempoolTxRaw = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 1,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      replaced_by_tx_id: undefined,
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
    assert.equal(mempool_sender_nonces.status, 200);
    assert.equal(mempool_sender_nonces.type, 'application/json');
    assert.deepEqual(JSON.parse(mempool_sender_nonces.text), expectedResp3);

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
    assert.equal(mempool_sponsor_nonces.status, 200);
    assert.equal(mempool_sponsor_nonces.type, 'application/json');
    assert.deepEqual(JSON.parse(mempool_sponsor_nonces.text), expectedResp4);

    /**
     * Sponsor detected missing nonce
     */

    const mempoolTx1: DbMempoolTxRaw = {
      tx_id: '0x52123456',
      anchor_mode: 3,
      nonce: 6,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      replaced_by_tx_id: undefined,
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
    assert.equal(detected_missing_nonce.status, 200);
    assert.equal(detected_missing_nonce.type, 'application/json');
    assert.deepEqual(JSON.parse(detected_missing_nonce.text), expectedResp5);
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
      assert.equal(response.status, 400);
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
    assert.equal(anchoredResult.status, 200);
    assert.equal(anchoredResult.type, 'application/json');
    assert.deepEqual(JSON.parse(anchoredResult.text).total, 50); // 50 txs up to block_height=2
    assert.deepEqual(JSON.parse(anchoredResult.text).results.length, 50);

    // Unanchored results first page should also be 50 (40 at block_height=2, 10 at unanchored block_height=3)
    const unanchoredResult = await supertest(api.server).get(
      `/extended/v1/address/${contractId}/transactions?limit=50&unanchored=true`
    );
    assert.equal(unanchoredResult.status, 200);
    assert.equal(unanchoredResult.type, 'application/json');
    assert.deepEqual(JSON.parse(unanchoredResult.text).total, 60); // 60 txs up to unanchored block_height=3
    assert.deepEqual(JSON.parse(unanchoredResult.text).results.length, 50);
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
    assert.equal(result1.status, 200);
    assert.equal(result1.type, 'application/json');
    const json1 = JSON.parse(result1.text);
    assert.deepEqual(json1.total, 1);
    assert.deepEqual(json1.results.length, 1);
    assert.deepEqual(json1.results[0].tx_id, '0x123123');
    assert.deepEqual(json1.results[0].block_height, 3);

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
    assert.equal(result2.status, 200);
    assert.equal(result2.type, 'application/json');
    const json2 = JSON.parse(result2.text);
    assert.deepEqual(json2.total, 1);
    assert.deepEqual(json2.results.length, 1);

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
    assert.equal(result3.status, 200);
    assert.equal(result3.type, 'application/json');
    const json3 = JSON.parse(result3.text);
    assert.deepEqual(json3.total, 2);
    assert.deepEqual(json3.results.length, 2);
    assert.deepEqual(json3.results[0].tx_id, '0x11a1');

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
    assert.equal(result4.status, 200);
    assert.equal(result4.type, 'application/json');
    const json4 = JSON.parse(result4.text);
    assert.deepEqual(json4.total, 2);
    assert.deepEqual(json4.results.length, 2);
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
    assert.equal(result5.status, 200);
    assert.equal(result5.type, 'application/json');
    const json5 = JSON.parse(result5.text);
    assert.deepEqual(json5.total, 3);
    assert.deepEqual(json5.results.length, 3);
    assert.deepEqual(json5.results[0].tx_id, '0x11a2');

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
    assert.equal(result6.status, 200);
    assert.equal(result6.type, 'application/json');
    const json6 = JSON.parse(result6.text);
    assert.deepEqual(json6.total, 4);
    assert.deepEqual(json6.results.length, 4);
    assert.deepEqual(json6.results[0].tx_id, '0xffa1');
  });
});
