import { StacksCoreRpcClient } from '../core-rpc/client';

describe('core RPC tests', () => {
  let client: StacksCoreRpcClient;

  beforeAll(async () => {
    client = new StacksCoreRpcClient();
    await new StacksCoreRpcClient().waitForConnection(60000);
  });

  test('get info', async () => {
    const info = await client.getInfo();
    expect(info.peer_version).toBeTruthy();
  });

  test('get pox info', async () => {
    const poxInfo = await client.getPox();
    expect(poxInfo.contract_id).toBe(`ST000000000000000000002AMW42H.pox-4`);
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
});
