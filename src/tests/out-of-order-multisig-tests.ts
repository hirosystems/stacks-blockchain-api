import * as supertest from 'supertest';
import { PgSqlClient } from '@hirosystems/api-toolkit';
import { ChainID } from '@stacks/common';
import { ApiServer, startApiServer } from '../api/init';
import { PgWriteStore } from '../datastore/pg-write-store';
import { importEventsFromTsv } from '../event-replay/event-replay';
import { migrate } from '../test-utils/test-helpers';
import { Transaction } from '../api/schemas/entities/transactions';
import { TransactionResults } from '../api/schemas/responses/responses';
import { AddressTransaction } from '../api/schemas/entities/addresses';

describe('Out-of-order-multisig tx tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  const oooMultiSigTxId = '0xdbc0172e2230a3e9d937762754e407574872f1bc3fdbaf74eb73413433d4ad59';
  const oooMultiSigSenderAddress = 'SN581ZYV1BAKNXQV95HWS53SB4N3ZVSEPNNCM8ZV';

  beforeAll(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: true,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

    // set chainId env, because TSV import reads it manually
    process.env['STACKS_CHAIN_ID'] = ChainID.Testnet.toString();
  });

  afterAll(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('api with empty cycles', async () => {
    const cycles0 = await supertest(api.server).get(`/extended/v2/pox/cycles`);
    expect(cycles0.status).toBe(200);
    expect(JSON.parse(cycles0.text)).toStrictEqual({
      limit: 20,
      offset: 0,
      results: [],
      total: 0,
    });
  });

  test('tsv replay with out-of-order-multisig tx', async () => {
    await importEventsFromTsv(
      'src/tests/tsv/regtest-env-pox-4-out-of-order-multisig-tx.tsv',
      'archival',
      true,
      true
    );
  });

  test('ooo-multisig tx well formed', async () => {
    const { body: tx }: { body: Transaction } = await supertest(api.server).get(
      `/extended/v1/tx/${oooMultiSigTxId}`
    );
    expect(tx.tx_id).toBe(oooMultiSigTxId);
    expect(tx.sender_address).toBe(oooMultiSigSenderAddress);
    expect(tx.tx_type).toBe('token_transfer');
    expect(tx.tx_status).toBe('success');
  });

  test('lookup tx by sender address', async () => {
    const { body }: { body: TransactionResults } = await supertest(api.server).get(
      `/extended/v1/tx?from_address=${oooMultiSigSenderAddress}`
    );
    expect(body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ tx_id: oooMultiSigTxId })])
    );
  });

  test('lookup address txs', async () => {
    const { body }: { body: { results: AddressTransaction[] } } = await supertest(api.server).get(
      `/extended/v2/addresses/${oooMultiSigSenderAddress}/transactions`
    );
    expect(body.results[0].tx).toEqual(expect.objectContaining({ tx_id: oooMultiSigTxId }));
  });
});
