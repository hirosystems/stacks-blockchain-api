import { PgWriteStore } from '../datastore/pg-write-store';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { ApiServer, startApiServer } from '../api/init';
import { startEventServer } from '../event-stream/event-server';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { Server } from 'net';
import { ChainID } from '@stacks/transactions';

describe('core RPC tests', () => {
  let db: PgWriteStore;
  let eventServer: Server;
  let api: ApiServer;
  let client: StacksCoreRpcClient;

  beforeAll(async () => {
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests' });
    eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
    client = new StacksCoreRpcClient();
    await new StacksCoreRpcClient().waitForConnection(60000);
  });

  test('get info', async () => {
    const info = await client.getInfo();
    expect(info.peer_version).toBeTruthy();
  });

  test('get pox info', async () => {
    const poxInfo = await client.getPox();
    expect(poxInfo.contract_id).toBe(`ST000000000000000000002AMW42H.pox`);
  });

  test('get account nonce', async () => {
    const nonce = await client.getAccountNonce('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6');
    expect(nonce).toBe(0);
  });

  test('get account balance', async () => {
    const balance = await client.getAccountBalance('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6');
    expect(balance).toBe(10000000000000000n);
  });

  test('get estimated transfer fee', async () => {
    const fee = await client.getEstimatedTransferFee();
    expect(fee).toBeTruthy();
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
