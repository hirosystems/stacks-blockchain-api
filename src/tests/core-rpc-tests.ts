import { StacksCoreRpcClient } from '../core-rpc/client';

describe('core RPC tests', () => {
  let client: StacksCoreRpcClient;

  beforeEach(() => {
    client = new StacksCoreRpcClient();
  });

  test('get info', async () => {
    const info = await client.getInfo();
    expect(info.peer_version).toBeTruthy();
  });

  test('get account nonce', async () => {
    const nonce = await client.getAccountNonce('ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH');
    expect(nonce).toBe(0);
  });

  test('get account balance', async () => {
    const balance = await client.getAccountBalance('ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH');
    expect(balance).toBe(BigInt(10000000000000000));
  });
});
