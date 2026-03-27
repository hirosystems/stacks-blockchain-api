import supertest from 'supertest';
import { PgSqlClient } from '@stacks/api-toolkit';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { importEventsFromTsv } from '../../../src/event-replay/event-replay.ts';
import { migrate } from '../../test-helpers.ts';
import { Transaction } from '../../../src/api/schemas/entities/transactions.ts';
import { TransactionResults } from '../../../src/api/schemas/responses/responses.ts';
import { AddressTransaction } from '../../../src/api/schemas/entities/addresses.ts';
import { ENV } from '../../../src/env.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { STACKS_TESTNET } from '@stacks/network';

describe('Out-of-order-multisig tx tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  const oooMultiSigTxId = '0xdbc0172e2230a3e9d937762754e407574872f1bc3fdbaf74eb73413433d4ad59';
  const oooMultiSigSenderAddress = 'SN581ZYV1BAKNXQV95HWS53SB4N3ZVSEPNNCM8ZV';

  before(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: true,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    // set chainId env, because TSV import reads it manually
    ENV.STACKS_CHAIN_ID = '0x80000000';
  });

  after(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('tsv replay with out-of-order-multisig tx', async () => {
    await importEventsFromTsv(
      'tests/api/event-server/tsv/regtest-env-pox-4-out-of-order-multisig-tx.tsv',
      'archival',
      true,
      true
    );
  });

  test('ooo-multisig tx well formed', async () => {
    const { body: tx }: { body: Transaction } = await supertest(api.server).get(
      `/extended/v1/tx/${oooMultiSigTxId}`
    );
    assert.equal(tx.tx_id, oooMultiSigTxId);
    assert.equal(tx.sender_address, oooMultiSigSenderAddress);
    assert.equal(tx.tx_type, 'token_transfer');
    assert.equal(tx.tx_status, 'success');
  });

  test('lookup tx by sender address', async () => {
    const { body }: { body: TransactionResults } = await supertest(api.server).get(
      `/extended/v1/tx?from_address=${oooMultiSigSenderAddress}`
    );
    assert.ok(body.results.some(result => result.tx_id === oooMultiSigTxId));
  });

  test('lookup address txs', async () => {
    const { body }: { body: { results: AddressTransaction[] } } = await supertest(api.server).get(
      `/extended/v2/addresses/${oooMultiSigSenderAddress}/transactions`
    );
    assert.equal(body.results[0].tx.tx_id, oooMultiSigTxId);
  });
});
