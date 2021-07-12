import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import {
  DbBlock,
  DbTx,
  DbTxTypeId,
  DbStxEvent,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbMempoolTx,
  DbMicroblockPartial,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { I32_MAX } from '../helpers';
import {
  AddressStxBalanceResponse,
  AddressStxInboundListResponse,
  AddressTransactionsListResponse,
  AddressTransactionsWithTransfersListResponse,
  MempoolTransaction,
  MempoolTransactionListResponse,
  Microblock,
  MicroblockListResponse,
  Transaction,
  TransactionResults,
} from '@stacks/stacks-blockchain-api-types';

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
    const addr1 = 'ST28D4Q6RCQSJ6F7TEYWQDS4N1RXYEP9YBWMYSB97';
    const addr2 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

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
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: addr1,
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
      event_count: 1,
      parent_index_block_hash: '',
      parent_block_hash: '',
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
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
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
        },
      ],
    });

    const mb1: DbMicroblockPartial = {
      microblock_hash: '0xff01',
      microblock_sequence: 0,
      microblock_parent_hash: block1.block_hash,
      parent_index_block_hash: block1.index_block_hash,
      parent_burn_block_height: 123,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    };

    const mbTx1: DbTx = {
      tx_id: '0x02',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      type_id: DbTxTypeId.TokenTransfer,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: addr1,
      sponsor_address: undefined,
      origin_hash_mode: 1,
      token_transfer_amount: 50n,
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: addr2,
      event_count: 1,
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      microblock_canonical: true,
      microblock_sequence: mb1.microblock_sequence,
      microblock_hash: mb1.microblock_hash,
      parent_burn_block_time: mb1.parent_burn_block_time,

      // These properties aren't known until the next anchor block that accepts this microblock.
      index_block_hash: '',
      block_hash: '',
      burn_block_time: -1,

      // These properties can be determined with a db query, they are set while the db is inserting them.
      block_height: -1,
    };

    const mempoolTx1: DbMempoolTx = {
      ...mbTx1,
      pruned: false,
      receipt_time: 123456789,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1] });

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
        },
      ],
    });

    const txListResult1 = await supertest(api.server).get(`/extended/v1/tx`);
    const { body: txListBody1 }: { body: TransactionResults } = txListResult1;
    expect(txListBody1.results).toHaveLength(1);
    expect(txListBody1.results[0].tx_id).toBe(tx1.tx_id);

    const txListResult2 = await supertest(api.server).get(`/extended/v1/tx?unanchored`);
    const { body: txListBody2 }: { body: TransactionResults } = txListResult2;
    expect(txListBody2.results).toHaveLength(2);
    expect(txListBody2.results[0].tx_id).toBe(mbTx1.tx_id);

    const mempoolResult1 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    const { body: mempoolBody1 }: { body: MempoolTransactionListResponse } = mempoolResult1;
    expect(mempoolBody1.results).toHaveLength(1);
    expect(mempoolBody1.results[0].tx_id).toBe(mempoolTx1.tx_id);
    expect(mempoolBody1.results[0].tx_status).toBe('pending');

    const mempoolResult2 = await supertest(api.server).get(`/extended/v1/tx/mempool?unanchored`);
    const { body: mempoolBody2 }: { body: MempoolTransactionListResponse } = mempoolResult2;
    expect(mempoolBody2.results).toHaveLength(0);

    const txResult1 = await supertest(api.server).get(`/extended/v1/tx/${mbTx1.tx_id}`);
    const { body: txBody1 }: { body: MempoolTransaction } = txResult1;
    expect(txBody1.tx_id).toBe(mbTx1.tx_id);
    expect(txBody1.tx_status).toBe('pending');

    const txResult2 = await supertest(api.server).get(`/extended/v1/tx/${mbTx1.tx_id}?unanchored`);
    const { body: txBody2 }: { body: Transaction } = txResult2;
    expect(txBody2.tx_id).toBe(mbTx1.tx_id);
    expect(txBody2.tx_status).toBe('success');
    expect(txBody2.events).toHaveLength(1);
    expect(txBody2.block_height).toBe(block1.block_height + 1);
    expect(txBody2.parent_block_hash).toBe(block1.block_hash);
    expect(txBody2.microblock_hash).toBe(mb1.microblock_hash);
    expect(txBody2.microblock_sequence).toBe(mb1.microblock_sequence);
    expect(txBody2.block_hash).toBeFalsy();

    const mbListResult1 = await supertest(api.server).get(`/extended/v1/microblock`);
    const { body: mbListBody1 }: { body: MicroblockListResponse } = mbListResult1;
    expect(mbListBody1.results).toHaveLength(1);
    expect(mbListBody1.results[0].microblock_hash).toBe(mb1.microblock_hash);
    expect(mbListBody1.results[0].txs).toHaveLength(1);
    expect(mbListBody1.results[0].txs[0]).toBe(mbTx1.tx_id);

    const mbResult1 = await supertest(api.server).get(
      `/extended/v1/microblock/${mb1.microblock_hash}`
    );
    const { body: mbBody1 }: { body: Microblock } = mbResult1;
    expect(mbBody1.microblock_hash).toBe(mb1.microblock_hash);
    expect(mbBody1.txs).toHaveLength(1);
    expect(mbBody1.txs[0]).toBe(mbTx1.tx_id);

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
    expect(addrTxsTransfersBody2.results).toHaveLength(1);
    expect(addrTxsTransfersBody2.results[0].tx.tx_id).toBe(mbTx1.tx_id);
    expect(addrTxsTransfersBody2.results[0].stx_received).toBe(mbTxStxEvent1.amount.toString());

    const addrTxs1 = await supertest(api.server).get(`/extended/v1/address/${addr2}/transactions`);
    const { body: addrTxsBody1 }: { body: AddressTransactionsListResponse } = addrTxs1;
    expect(addrTxsBody1.results).toHaveLength(0);

    const addrTxs2 = await supertest(api.server).get(
      `/extended/v1/address/${addr2}/transactions?unanchored`
    );
    const { body: addrTxsBody2 }: { body: AddressTransactionsListResponse } = addrTxs2;
    expect(addrTxsBody2.results).toHaveLength(1);
    expect(addrTxsBody2.results[0].tx_id).toBe(mbTx1.tx_id);

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
    const { body: addrStxInboundBody1 }: { body: AddressStxInboundListResponse } = addrStxInbound1;
    expect(addrStxInboundBody1.results).toHaveLength(0);

    const addrStxInbound2 = await supertest(api.server).get(
      `/extended/v1/address/${addr2}/stx_inbound?unanchored`
    );
    const { body: addrStxInboundBody2 }: { body: AddressStxInboundListResponse } = addrStxInbound2;
    expect(addrStxInboundBody2.results).toHaveLength(1);
    expect(addrStxInboundBody2.results[0].tx_id).toBe(mbTx1.tx_id);
    expect(addrStxInboundBody2.results[0].amount).toBe(mbTxStxEvent1.amount.toString());
  });

  afterEach(async () => {
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
