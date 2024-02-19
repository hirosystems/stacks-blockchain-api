import * as supertest from 'supertest';
import {
  bufferCVFromString,
  ChainID,
  stringAsciiCV,
  uintCV,
  serializeCV,
} from '@stacks/transactions';
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
} from '../datastore/common';
import { startApiServer } from '../api/init';
import { httpPostRequest, I32_MAX } from '../helpers';
import {
  AddressStxBalanceResponse,
  AddressStxInboundListResponse,
  AddressTransactionsListResponse,
  AddressTransactionsWithTransfersListResponse,
  ContractCallTransaction,
  MempoolTransaction,
  MempoolTransactionListResponse,
  Microblock,
  MicroblockListResponse,
  Transaction,
  TransactionResults,
} from '@stacks/stacks-blockchain-api-types';
import { useWithCleanup } from './test-helpers';
import { startEventServer } from '../event-stream/event-server';
import * as fs from 'fs';
import { createClarityValueArray } from '../stacks-encoding-helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { getRawEventRequests } from '../event-replay/event-requests';
import { logger } from '../logger';
import { PgSqlClient, bufferToHex } from '@hirosystems/api-toolkit';
import { migrate } from '../test-utils/test-helpers';

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
          'src/tests/event-replay-logs/mainnet-out-of-order-microblock.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: ChainID.Mainnet,
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
        expect(mbResult1.status).toBe(404);
        const mbHash2 = '0xab9112694f13f7b04996d4b4554af5b5890271fa4e0c9099e67353b42dcf9989';
        const mbResult2 = await supertest(api.server).get(`/extended/v1/microblock/${mbHash2}`);
        expect(mbResult2.status).toBe(404);
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
          'src/tests/event-replay-logs/mainnet-reorg-scenario1.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: ChainID.Mainnet,
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
        expect(txBody.canonical).toBe(true);
        expect(txBody.microblock_canonical).toBe(true);
        expect(txBody.tx_id).toBe(lostTx);
        expect(txBody.tx_status).toBe('success');
        expect(txBody.events).toHaveLength(1);
        expect(txBody.block_hash).toBe(canonicalBlockHash);
        expect(txBody.block_height).toBe(canonicalBlockHeight);
        expect(txBody.microblock_hash).toBe(canonicalMicroblockHash);
        expect(txBody.microblock_sequence).toBe(canonicalMicroblockSequence);
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
          'src/tests/event-replay-logs/mainnet-reorg-scenario2.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: ChainID.Mainnet,
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
        expect(txBody.canonical).toBe(true);
        expect(txBody.microblock_canonical).toBe(true);
        expect(txBody.tx_id).toBe(lostTx);
        expect(txBody.tx_status).toBe('success');
        expect(txBody.events).toHaveLength(1);
        expect(txBody.block_hash).toBe(canonicalBlockHash);
        expect(txBody.block_height).toBe(canonicalBlockHeight);
        expect(txBody.microblock_hash).toBe(canonicalMicroblockHash);
        expect(txBody.microblock_sequence).toBe(canonicalMicroblockSequence);
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
          chainId: ChainID.Testnet,
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
        expect(chainTip1.block_hash).toBe(block1.block_hash);
        expect(chainTip1.block_height).toBe(block1.block_height);
        expect(chainTip1.index_block_hash).toBe(block1.index_block_hash);
        expect(chainTip1.microblock_hash).toBeUndefined();
        expect(chainTip1.microblock_sequence).toBeUndefined();

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
          nonce: 0,
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
          burn_block_time: -1,

          // These properties can be determined with a db query, they are set while the db is inserting them.
          block_height: -1,
        };
        const mbTx2: DbTxRaw = {
          tx_id: '0x03',
          tx_index: 1,
          anchor_mode: 3,
          nonce: 0,
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

          // These properties can be determined with a db query, they are set while the db is inserting them.
          block_height: -1,
        };

        const mempoolTx1: DbMempoolTxRaw = {
          ...mbTx1,
          pruned: false,
          receipt_time: 123456789,
        };
        const mempoolTx2: DbMempoolTxRaw = {
          ...mbTx2,
          pruned: false,
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
        expect(chainTip2.block_hash).toBe(block1.block_hash);
        expect(chainTip2.block_height).toBe(block1.block_height);
        expect(chainTip2.index_block_hash).toBe(block1.index_block_hash);
        expect(chainTip2.microblock_hash).toBe(mb1.microblock_hash);
        expect(chainTip2.microblock_sequence).toBe(mb1.microblock_sequence);

        const txListResult1 = await supertest(api.server).get(`/extended/v1/tx`);
        const { body: txListBody1 }: { body: TransactionResults } = txListResult1;
        expect(txListBody1.results).toHaveLength(1);
        expect(txListBody1.results[0].tx_id).toBe(tx1.tx_id);

        const txListResult2 = await supertest(api.server).get(`/extended/v1/tx?unanchored`);
        const { body: txListBody2 }: { body: TransactionResults } = txListResult2;
        expect(txListBody2.results).toHaveLength(3);
        expect(txListBody2.results[0].tx_id).toBe(mbTx2.tx_id);
        expect(txListBody2.results[0].is_unanchored).toBe(true);

        const txListResult3 = await supertest(api.server).get(
          `/extended/v1/microblock/unanchored/txs`
        );
        const { body: txListBody3 }: { body: TransactionResults } = txListResult3;
        expect(txListBody3.results).toHaveLength(2);
        expect(txListBody3.results[0].tx_id).toBe(mbTx2.tx_id);
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
        expect(contractCallResults.contract_call).toEqual(expectedContractCallResp);

        const mempoolResult1 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
        const { body: mempoolBody1 }: { body: MempoolTransactionListResponse } = mempoolResult1;
        expect(mempoolBody1.results).toHaveLength(2);
        expect(mempoolBody1.results[0].tx_id).toBe(mempoolTx1.tx_id);
        expect(mempoolBody1.results[0].tx_status).toBe('pending');

        const mempoolResult2 = await supertest(api.server).get(
          `/extended/v1/tx/mempool?unanchored`
        );
        const { body: mempoolBody2 }: { body: MempoolTransactionListResponse } = mempoolResult2;
        expect(mempoolBody2.results).toHaveLength(0);

        const txResult1 = await supertest(api.server).get(`/extended/v1/tx/${mbTx1.tx_id}`);
        const { body: txBody1 }: { body: MempoolTransaction } = txResult1;
        expect(txBody1.tx_id).toBe(mbTx1.tx_id);
        expect(txBody1.tx_status).toBe('pending');

        const txResult2 = await supertest(api.server).get(
          `/extended/v1/tx/${mbTx1.tx_id}?unanchored`
        );
        const { body: txBody2 }: { body: Transaction } = txResult2;
        expect(txBody2.tx_id).toBe(mbTx1.tx_id);
        expect(txBody2.tx_status).toBe('success');
        expect(txBody2.events).toHaveLength(1);
        expect(txBody2.block_height).toBe(block1.block_height + 1);
        expect(txBody2.parent_block_hash).toBe(block1.block_hash);
        expect(txBody2.microblock_hash).toBe(mb1.microblock_hash);
        expect(txBody2.microblock_sequence).toBe(mb1.microblock_sequence);
        expect(txBody2.block_hash).toBe('0x');
        expect(txBody2.is_unanchored).toBe(true);

        const mbListResult1 = await supertest(api.server).get(`/extended/v1/microblock`);
        const { body: mbListBody1 }: { body: MicroblockListResponse } = mbListResult1;
        expect(mbListBody1.results).toHaveLength(1);
        expect(mbListBody1.results[0].microblock_hash).toBe(mb1.microblock_hash);
        expect(mbListBody1.results[0].txs).toHaveLength(2);
        expect(mbListBody1.results[0].txs[0]).toBe(mbTx2.tx_id);

        const mbResult1 = await supertest(api.server).get(
          `/extended/v1/microblock/${mb1.microblock_hash}`
        );
        const { body: mbBody1 }: { body: Microblock } = mbResult1;
        expect(mbBody1.microblock_hash).toBe(mb1.microblock_hash);
        expect(mbBody1.txs).toHaveLength(2);
        expect(mbBody1.txs[0]).toBe(mbTx2.tx_id);

        const addrTxsTransfers1 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions_with_transfers`
        );
        const {
          body: addrTxsTransfersBody1,
        }: { body: AddressTransactionsWithTransfersListResponse } = addrTxsTransfers1;
        expect(addrTxsTransfersBody1.results).toHaveLength(0);

        const addrTxsTransfers2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions_with_transfers?unanchored`
        );
        const {
          body: addrTxsTransfersBody2,
        }: { body: AddressTransactionsWithTransfersListResponse } = addrTxsTransfers2;
        expect(addrTxsTransfersBody2.results).toHaveLength(2);
        expect(addrTxsTransfersBody2.results[1].tx.tx_id).toBe(mbTx1.tx_id);
        expect(addrTxsTransfersBody2.results[1].stx_received).toBe(mbTxStxEvent1.amount.toString());

        const addrTxs1 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions`
        );
        const { body: addrTxsBody1 }: { body: AddressTransactionsListResponse } = addrTxs1;
        expect(addrTxsBody1.results).toHaveLength(0);

        const addrTxs2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/transactions?unanchored`
        );
        const { body: addrTxsBody2 }: { body: AddressTransactionsListResponse } = addrTxs2;
        expect(addrTxsBody2.results).toHaveLength(2);
        expect(addrTxsBody2.results[0].tx_id).toBe(mbTx2.tx_id);

        const addrBalance1 = await supertest(api.server).get(`/extended/v1/address/${addr2}/stx`);
        const { body: addrBalanceBody1 }: { body: AddressStxBalanceResponse } = addrBalance1;
        expect(addrBalanceBody1.balance).toBe('0');
        expect(addrBalanceBody1.total_received).toBe('0');

        const addrBalance2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/stx?unanchored`
        );
        const { body: addrBalanceBody2 }: { body: AddressStxBalanceResponse } = addrBalance2;
        expect(addrBalanceBody2.balance).toBe(mbTxStxEvent1.amount.toString());
        expect(addrBalanceBody2.total_received).toBe(mbTxStxEvent1.amount.toString());

        const addrStxInbound1 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/stx_inbound`
        );
        const { body: addrStxInboundBody1 }: { body: AddressStxInboundListResponse } =
          addrStxInbound1;
        expect(addrStxInboundBody1.results).toHaveLength(0);

        const addrStxInbound2 = await supertest(api.server).get(
          `/extended/v1/address/${addr2}/stx_inbound?unanchored`
        );
        const { body: addrStxInboundBody2 }: { body: AddressStxInboundListResponse } =
          addrStxInbound2;
        expect(addrStxInboundBody2.results).toHaveLength(1);
        expect(addrStxInboundBody2.results[0].tx_id).toBe(mbTx1.tx_id);
        expect(addrStxInboundBody2.results[0].amount).toBe(mbTxStxEvent1.amount.toString());
      }
    );
  });
});
