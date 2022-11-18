import { Server } from 'net';
import { PgWriteStore } from '../datastore/pg-write-store';
import { startEventServer } from '../event-stream/event-server';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { ChainID } from '@stacks/transactions';

describe('core RPC tests', () => {
  let client: StacksCoreRpcClient;
  let db: PgWriteStore;
  let eventServer: Server;

  beforeAll(async () => {
    db = await PgWriteStore.connect({ usageName: 'tests' });
    eventServer = await startEventServer({
      datastore: db,
      chainId: ChainID.Testnet,
      httpLogLevel: 'silly',
    });
  });

  beforeEach(() => {
    client = new StacksCoreRpcClient();
  });

  test('get info', async () => {
    const info = await client.getInfo();
    expect(info.peer_version).toBeTruthy();
  });

  // TODO: fails with:
  //  Response 500: Internal Server Error fetching http://127.0.0.1:20443/v2/pox - Failed to query peer info
  //  https://github.com/blockstack/stacks-blockchain/issues/2600
  test.skip('get pox info', async () => {
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
    eventServer.close();
    await db.close();
  });
});
