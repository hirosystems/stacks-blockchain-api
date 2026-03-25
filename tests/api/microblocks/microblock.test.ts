import supertest from 'supertest';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbStxEvent,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbMempoolTxRaw,
  DbMicroblockPartial,
  DbSmartContractEvent,
  DbSmartContract,
} from '../../../src/datastore/common.ts';
import { startApiServer } from '../../../src/api/init.ts';
import { httpPostRequest, I32_MAX } from '../../../src/helpers.ts';
import {
  ContractCallTransaction,
  MempoolTransaction,
  Transaction,
} from '../../../src/api/schemas/entities/transactions.ts';
import {
  AddressStxInboundListResponse,
  AddressTransactionsListResponse,
  AddressTransactionsWithTransfersListResponse,
  MempoolTransactionListResponse,
  MicroblockListResponse,
  TransactionResults,
} from '../../../src/api/schemas/responses/responses.ts';
import { Microblock } from '../../../src/api/schemas/entities/microblock.ts';
import { AddressStxBalance } from '../../../src/api/schemas/entities/addresses.ts';
import { useWithCleanup } from '../test-helpers.ts';
import { startEventServer } from '../../../src/event-stream/event-server.ts';
import * as fs from 'fs';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { getRawEventRequests } from '../../../src/event-replay/event-requests.ts';
import { PgSqlClient, bufferToHex, logger } from '@stacks/api-toolkit';
import { createClarityValueArray, migrate } from '../../test-helpers.ts';
import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import { bufferCVFromString, serializeCV, stringAsciiCV, uintCV } from '@stacks/transactions';

describe('microblock tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
  });

  afterEach(async () => {
    await db?.close();
    await migrate('down');
  });

  test('microblock out of order events', async () => {
    // test that the event observer can ingest events with out of order microblocks
    await useWithCleanup(
      () => {
        const origLevel = logger.level;
        logger.level = 'error';
        return [, () => (logger.level = origLevel)] as const;
      },
      () => {
        const readStream = fs.createReadStream(
          'tests/api/microblocks/event-replay-logs/mainnet-out-of-order-microblock.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, rawEventsIterator, eventServer, api) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
          }
        }
        // test that the out-of-order microblocks were not stored
        const mbHash1 = '0xb714e75a7dae26fee0e77788317a0c84e513d1d8647a376b21b1c864e55c135a';
        const mbResult1 = await supertest(api.server).get(`/extended/v1/microblock/${mbHash1}`);
        assert.equal(mbResult1.status, 404);
        const mbHash2 = '0xab9112694f13f7b04996d4b4554af5b5890271fa4e0c9099e67353b42dcf9989';
        const mbResult2 = await supertest(api.server).get(`/extended/v1/microblock/${mbHash2}`);
        assert.equal(mbResult2.status, 404);
      }
    );
  });

  test('microblock re-org scenario 1', async () => {
    const lostTx = '0x03484817283a83a0b0c23e84c2659f39c9a06d81a63329464d979ec2af476596';
    const canonicalBlockHash = '0x4d27059a847f3c3f6dbbd43343d11981b67409a2710597c6cb1814945cfc4d48';
    const canonicalBlockHeight = 45;
    const canonicalMicroblockHash =
      '0xa58e1ede6f244c92c51e8c5cb32be6c7dcf40e13c4ce4bfe87484f33422876e0';
    const canonicalMicroblockSequence = 0;
    await useWithCleanup(
      () => {
        const origLevel = logger.level;
        logger.level = 'error';
        return [, () => (logger.level = origLevel)] as const;
      },
      () => {
        const readStream = fs.createReadStream(
          'tests/api/microblocks/event-replay-logs/mainnet-reorg-scenario1.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, rawEventsIterator, eventServer, api) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
          }
        }
        const txResult2 = await supertest(api.server).get(`/extended/v1/tx/${lostTx}`);
        const { body: txBody }: { body: Transaction } = txResult2;
        assert.equal(txBody.canonical, true);
        assert.equal(txBody.microblock_canonical, true);
        assert.equal(txBody.tx_id, lostTx);
        assert.equal(txBody.tx_status, 'success');
        assert.equal(txBody.events.length, 1);
        assert.equal(txBody.block_hash, canonicalBlockHash);
        assert.equal(txBody.block_height, canonicalBlockHeight);
        assert.equal(txBody.microblock_hash, canonicalMicroblockHash);
        assert.equal(txBody.microblock_sequence, canonicalMicroblockSequence);
      }
    );
  });

  test('microblock re-org scenario 2', async () => {
    const lostTx = '0x87916a01f0c31d246649eb2631a57b135cc94d26cd802f3b6a24723f2f21c74a';
    const canonicalBlockHash = '0x8f77bd15d37346543c64340e79b891b48628e36fcde9ae27d4e5e3f3992b5c8b';
    const canonicalBlockHeight = 2;
    const canonicalMicroblockHash =
      '0x96896fb0a2a190593c7bc34ff5711c147ef024a034f38af57ca508e907815df7';
    const canonicalMicroblockSequence = 0;
    await useWithCleanup(
      () => {
        const origLevel = logger.level;
        logger.level = 'error';
        return [, () => (logger.level = origLevel)] as const;
      },
      () => {
        const readStream = fs.createReadStream(
          'tests/api/microblocks/event-replay-logs/mainnet-reorg-scenario2.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: STACKS_MAINNET.chainId,
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, rawEventsIterator, eventServer, api) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
          }
        }
        const txResult2 = await supertest(api.server).get(`/extended/v1/tx/${lostTx}`);
        const { body: txBody }: { body: Transaction } = txResult2;
        assert.equal(txBody.canonical, true);
        assert.equal(txBody.microblock_canonical, true);
        assert.equal(txBody.tx_id, lostTx);
        assert.equal(txBody.tx_status, 'success');
        assert.equal(txBody.events.length, 1);
        assert.equal(txBody.block_hash, canonicalBlockHash);
        assert.equal(txBody.block_height, canonicalBlockHeight);
        assert.equal(txBody.microblock_hash, canonicalMicroblockHash);
        assert.equal(txBody.microblock_sequence, canonicalMicroblockSequence);
      }
    );
  });

  test('contiguous microblock stream fully confirmed in anchor block', async () => {
    await useWithCleanup(
      () => {
        const origLevel = logger.level;
        logger.level = 'error';
        return [, () => (logger.level = origLevel)] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: STACKS_TESTNET.chainId,
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, api) => {
        const addr1 = 'ST28D4Q6RCQSJ6F7TEYWQDS4N1RXYEP9YBWMYSB97';
        const addr2 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
        const contractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';

        const block1: DbBlock = {
          block_hash: '0x11',
          index_block_hash: '0xaa',
          parent_index_block_hash: '0x00',
          parent_block_hash: '0x00',
          parent_microblock_hash: '',
          block_height: 1,
          tenure_height: 1,
          block_time: 1234,
          burn_block_time: 1234,
          burn_block_hash: '0x1234',
          burn_block_height: 123,
          miner_txid: '0x4321',
          canonical: true,
          parent_microblock_sequence: 0,
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

        const tx1: DbTxRaw = {
          tx_id: '0x01',
          tx_index: 0,
          anchor_mode: 3,
          nonce: 0,
          raw_tx: '0x131313',
          index_block_hash: block1.index_block_hash,
          block_hash: block1.block_hash,
          block_height: block1.block_height,
          block_time: block1.burn_block_time,
          burn_block_height: block1.burn_block_height,
          burn_block_time: block1.burn_block_time,
          parent_burn_block_time: 1626122935,
          type_id: DbTxTypeId.Coinbase,
          status: 1,
          raw_result: '0x0100000000000000000000000000000001', // u1
          canonical: true,
          post_conditions: '0x01f5',
          fee_rate: 1234n,
          sponsored: false,
          sponsor_address: undefined,
          sender_address: addr1,
          origin_hash_mode: 1,
          coinbase_payload: bufferToHex(Buffer.from('hi')),
          event_count: 1,
          parent_index_block_hash: block1.parent_index_block_hash,
          parent_block_hash: block1.parent_block_hash,
          microblock_canonical: true,
          microblock_sequence: I32_MAX,
          microblock_hash: '0x00',
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          vm_error: null,
        };
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
          tx_id: tx1.tx_id,
          tx_index: 0,
          block_height: block1.block_height,
          canonical: true,
          event_type: DbEventTypeId.SmartContractLog,
          contract_identifier: contractAddr,
          topic: 'some-topic',
          value: bufferToHex(Buffer.from(serializeCV(bufferCVFromString('some val')))),
        };
        const smartContract1: DbSmartContract = {
          tx_id: tx1.tx_id,
          canonical: true,
          block_height: block1.block_height,
          clarity_version: null,
          contract_id: contractAddr,
          source_code: '(some-contract-src)',
          abi: JSON.stringify(contractJsonAbi),
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
              pox2Events: [],
              pox3Events: [],
              pox4Events: [],
            },
          ],
        });

        const chainTip1 = await db.getChainTip(db.sql);
        assert.equal(chainTip1.block_hash, block1.block_hash);
        assert.equal(chainTip1.block_height, block1.block_height);
        assert.equal(chainTip1.index_block_hash, block1.index_block_hash);
        assert.equal(chainTip1.microblock_hash, undefined);
        assert.equal(chainTip1.microblock_sequence, undefined);

        const mb1: DbMicroblockPartial = {
          microblock_hash: '0xff01',
          microblock_sequence: 0,
          microblock_parent_hash: block1.block_hash,
          parent_index_block_hash: block1.index_block_hash,
          parent_burn_block_height: 123,
          parent_burn_block_hash: '0xaa',
          parent_burn_block_time: 1626122935,
        };

        const mbTx1: DbTxRaw = {
          tx_id: '0x02',
          tx_index: 0,
          anchor_mode: 3,
          nonce: 1,
          raw_tx: '0x141414',
          type_id: DbTxTypeId.TokenTransfer,
          status: 1,
          raw_result: '0x0100000000000000000000000000000001', // u1
          canonical: true,
          post_conditions: '0x01f5',
          fee_rate: 1234n,
          sponsored: false,
          sender_address: addr1,
          sponsor_address: undefined,
          origin_hash_mode: 1,
          token_transfer_amount: 50n,
          token_transfer_memo: bufferToHex(Buffer.from('hi')),
          token_transfer_recipient_address: addr2,
          event_count: 1,
          parent_index_block_hash: block1.index_block_hash,
          parent_block_hash: block1.block_hash,
          microblock_canonical: true,
          microblock_sequence: mb1.microblock_sequence,
          microblock_hash: mb1.microblock_hash,
          parent_burn_block_time: mb1.parent_burn_block_time,
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,

          // These properties aren't known until the next anchor block that accepts this microblock.
          index_block_hash: '',
          block_hash: '',
          burn_block_height: -1,
          burn_block_time: -1,
          block_time: -1,

          // These properties can be determined with a db query, they are set while the db is inserting them.
          block_height: -1,
          vm_error: null,
        };
        const mbTx2: DbTxRaw = {
          tx_id: '0x03',
          tx_index: 1,
          anchor_mode: 3,
          nonce: 2,
          raw_tx: '0x141415',
          type_id: DbTxTypeId.ContractCall,
          status: 1,
          raw_result: '0x0100000000000000000000000000000001', // u1
          canonical: true,
          post_conditions: '0x01f5',
          fee_rate: 1234n,
          sponsored: false,
          sender_address: addr1,
          sponsor_address: undefined,
          origin_hash_mode: 1,
          token_transfer_amount: 50n,
          token_transfer_memo: bufferToHex(Buffer.from('hi')),
          token_transfer_recipient_address: addr2,
          event_count: 1,
          parent_index_block_hash: block1.index_block_hash,
          parent_block_hash: block1.block_hash,
          microblock_canonical: true,
          microblock_sequence: mb1.microblock_sequence,
          microblock_hash: mb1.microblock_hash,
          parent_burn_block_time: mb1.parent_burn_block_time,
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          contract_call_contract_id: contractAddr,
          contract_call_function_name: 'test-contract-fn',
          contract_call_function_args: bufferToHex(
            createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
          ),
          abi: JSON.stringify(contractJsonAbi),

          // These properties aren't known until the next anchor block that accepts this microblock.
          index_block_hash: '',
          block_hash: '',
          burn_block_time: -1,
          burn_block_height: -1,
          block_time: -1,

          // These properties can be determined with a db query, they are set while the db is inserting them.
          block_height: -1,
          vm_error: null,
        };

        const mempoolTx1: DbMempoolTxRaw = {
          ...mbTx1,
          pruned: false,
          replaced_by_tx_id: undefined,
          receipt_time: 123456789,
        };
        const mempoolTx2: DbMempoolTxRaw = {
          ...mbTx2,
          pruned: false,
          replaced_by_tx_id: undefined,
          receipt_time: 123456789,
        };
        await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1, mempoolTx2] });

        const mbTxStxEvent1: DbStxEvent = {
          canonical: true,
          event_type: DbEventTypeId.StxAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: 0,
          tx_id: mbTx1.tx_id,
          tx_index: mbTx1.tx_index,
          block_height: mbTx1.block_height,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          amount: mbTx1.token_transfer_amount!,
          recipient: mbTx1.token_transfer_recipient_address,
          sender: mbTx1.sender_address,
        };
        await db.updateMicroblocks({
          microblocks: [mb1],
          txs: [
            {
              tx: mbTx1,
              stxLockEvents: [],
              stxEvents: [mbTxStxEvent1],
              ftEvents: [],
              nftEvents: [],
              contractLogEvents: [],
              smartContracts: [],
              names: [],
              namespaces: [],
              pox2Events: [],
              pox3Events: [],
              pox4Events: [],
            },
            {
              tx: mbTx2,
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
            },
          ],
        });

        const chainTip2 = await db.getChainTip(db.sql);
        assert.equal(chainTip2.block_hash, block1.block_hash);
        assert.equal(chainTip2.block_height, block1.block_height);
        assert.equal(chainTip2.index_block_hash, block1.index_block_hash);
        assert.equal(chainTip2.microblock_hash, mb1.microblock_hash);
        assert.equal(chainTip2.microblock_sequence, mb1.microblock_sequence);

        const txListResult1 = await supertest(api.server).get(`/extended/v1/tx`);
        const { body: txListBody1 }: { body: TransactionResults } = txListResult1;
        assert.equal(txListBody1.results.length, 1);
        assert.equal(txListBody1.results[0].tx_id, tx1.tx_id);

        const txListResult2 = await supertest(api.server).get(`/extended/v1/tx?unanchored=true`);
        const { body: txListBody2 }: { body: TransactionResults } = txListResult2;
        assert.equal(txListBody2.results.length, 3);
        assert.equal(txListBody2.results[0].tx_id, mbTx2.tx_id);
        assert.equal(txListBody2.results[0].is_unanchored, true);

        const txListResult3 = await supertest(api.server).get(
          `/extended/v1/microblock/unanchored/txs`
        );
        const { body: txListBody3 }: { body: TransactionResults } = txListResult3;
        assert.equal(txListBody3.results.length, 2);
        assert.equal(txListBody3.results[0].tx_id, mbTx2.tx_id);
        const expectedContractCallResp = {
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
        };
        const contractCallResults = txListBody3.results[0] as ContractCallTransaction;
        assert.deepEqual(contractCallResults.contract_call, expectedContractCallResp);

        const mempoolResult1 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
        const { body: mempoolBody1 }: { body: MempoolTransactionListResponse } = mempoolResult1;
        assert.equal(mempoolBody1.results.length, 2);
        assert.equal(mempoolBody1.results[0].tx_id, mempoolTx1.tx_id);
        assert.equal(mempoolBody1.results[0].tx_status, 'pending');

        const mempoolResult2 = await supertest(api.server).get(
          `/extended/v1/tx/mempool?unanchored=true`
        );
        const { body: mempoolBody2 }: { body: MempoolTransactionListResponse } = mempoolResult2;
        assert.equal(mempoolBody2.results.length, 0);

        const txResult1 = await supertest(api.server).get(`/extended/v1/tx/${mbTx1.tx_id}`);
        const { body: txBody1 }: { body: MempoolTransaction } = txResult1;
        assert.equal(txBody1.tx_id, mbTx1.tx_id);
        assert.equal(txBody1.tx_status, 'pending');

        const txResult2 = await supertest(api.server).get(
          `/extended/v1/tx/${mbTx1.tx_id}?unanchored=true`
        );
        const { body: txBody2 }: { body: Transaction } = txResult2;
        assert.equal(txBody2.tx_id, mbTx1.tx_id);
        assert.equal(txBody2.tx_status, 'success');
        assert.equal(txBody2.events.length, 1);
        assert.equal(txBody2.block_height, block1.block_height + 1);
        assert.equal(txBody2.parent_block_hash, block1.block_hash);
        assert.equal(txBody2.microblock_hash, mb1.microblock_hash);
        assert.equal(txBody2.microblock_sequence, mb1.microblock_sequence);
        assert.equal(txBody2.block_hash, '0x');
        assert.equal(txBody2.is_unanchored, true);

        const mbListResult1 = await supertest(api.server).get(`/extended/v1/microblock`);
        const { body: mbListBody1 }: { body: MicroblockListResponse } = mbListResult1;
        assert.equal(mbListBody1.results.length, 1);
        assert.equal(mbListBody1.results[0].microblock_hash, mb1.microblock_hash);
        assert.equal(mbListBody1.results[0].txs.length, 2);
        assert.equal(mbListBody1.results[0].txs[0], mbTx2.tx_id);

        const mbResult1 = await supertest(api.server).get(
          `/extended/v1/microblock/${mb1.microblock_hash}`
        );
        const { body: mbBody1 }: { body: Microblock } = mbResult1;
        assert.equal(mbBody1.microblock_hash, mb1.microblock_hash);
        assert.equal(mbBody1.txs.length, 2);
        assert.equal(mbBody1.txs[0], mbTx2.tx_id);

        const addrTxsTransfers1 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions_with_transfers`
        );
        const {
          body: addrTxsTransfersBody1,
        }: { body: AddressTransactionsWithTransfersListResponse } = addrTxsTransfers1;
        assert.equal(addrTxsTransfersBody1.results.length, 0);

        const addrTxsTransfers2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions_with_transfers?unanchored=true`
        );
        const {
          body: addrTxsTransfersBody2,
        }: { body: AddressTransactionsWithTransfersListResponse } = addrTxsTransfers2;
        assert.equal(addrTxsTransfersBody2.results.length, 2);
        assert.equal(addrTxsTransfersBody2.results[1].tx.tx_id, mbTx1.tx_id);
        assert.equal(
          addrTxsTransfersBody2.results[1].stx_received,
          mbTxStxEvent1.amount.toString()
        );

        const addrTxs1 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions`
        );
        const { body: addrTxsBody1 }: { body: AddressTransactionsListResponse } = addrTxs1;
        assert.equal(addrTxsBody1.results.length, 0);

        const addrTxs2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions?unanchored=true`
        );
        const { body: addrTxsBody2 }: { body: AddressTransactionsListResponse } = addrTxs2;
        assert.equal(addrTxsBody2.results.length, 2);
        assert.equal(addrTxsBody2.results[0].tx_id, mbTx2.tx_id);

        const addrBalance1 = await supertest(api.server).get(`/extended/v1/address/${addr2}/stx`);
        const { body: addrBalanceBody1 }: { body: AddressStxBalance } = addrBalance1;
        assert.equal(addrBalanceBody1.balance, '0');
        assert.equal(addrBalanceBody1.total_received, '0');

        const addrBalance2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/stx?unanchored=true`
        );
        const { body: addrBalanceBody2 }: { body: AddressStxBalance } = addrBalance2;
        assert.equal(addrBalanceBody2.balance, mbTxStxEvent1.amount.toString());
        assert.equal(addrBalanceBody2.total_received, mbTxStxEvent1.amount.toString());

        const addrStxInbound1 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/stx_inbound`
        );
        const { body: addrStxInboundBody1 }: { body: AddressStxInboundListResponse } =
          addrStxInbound1;
        assert.equal(addrStxInboundBody1.results.length, 0);

        const addrStxInbound2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/stx_inbound?unanchored=true`
        );
        const { body: addrStxInboundBody2 }: { body: AddressStxInboundListResponse } =
          addrStxInbound2;
        assert.equal(addrStxInboundBody2.results.length, 1);
        assert.equal(addrStxInboundBody2.results[0].tx_id, mbTx1.tx_id);
        assert.equal(addrStxInboundBody2.results[0].amount, mbTxStxEvent1.amount.toString());
      }
    );
  });
});
