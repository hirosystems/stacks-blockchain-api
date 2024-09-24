/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as supertest from 'supertest';
import {
  Account,
  accountFromKey,
  fetchGet,
  standByForTxSuccess,
  testEnv,
} from '../utils/test-helpers';
import { RunFaucetResponse } from '../../src/api/schemas/responses/responses';
import { AddressStxBalance } from '../../src/api/schemas/entities/addresses';

describe('STX Faucet', () => {
  const reqAccountKey = 'b1ee37d996b1cf95ff67996a38426cff398d3adfeccf8ae8b3651a530837dd5801';
  let reqAccount: Account;
  let reqTx: RunFaucetResponse;

  beforeAll(() => {
    reqAccount = accountFromKey(reqAccountKey);
  });

  test('STX faucet http request succeeds', async () => {
    const response = await supertest(testEnv.api.server).post(
      `/extended/v1/faucets/stx?address=${reqAccount.stxAddr}`
    );
    expect(response.status).toBe(200);
    reqTx = response.body;
    expect(typeof reqTx.txId).toBe('string');
    expect(typeof reqTx.txRaw).toBe('string');
    expect(reqTx.success).toBe(true);
  });

  test('STX faucet http request post body', async () => {
    const response = await supertest(testEnv.api.server)
      .post(`/extended/v1/faucets/stx`)
      .send({ address: reqAccount.stxAddr, stacking: true });
    expect(response.status).toBe(400);
    const reqTx: any = response.body;
    expect(reqTx.success).toBe(false);
    expect(reqTx.error).toContain('POST body is no longer supported');
    // check for helpful error message
    expect(reqTx.error).toContain(`address=${reqAccount.stxAddr}`);
  });

  test('STX faucet tx mined successfully', async () => {
    const tx = await standByForTxSuccess(reqTx.txId);
    expect(tx.token_transfer_recipient_address).toBe(reqAccount.stxAddr);
  });

  test('STX faucet recipient balance', async () => {
    // Validate account has balance from API endpoint
    const addrBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${reqAccount.stxAddr}/stx`
    );
    expect(BigInt(addrBalance.balance)).toBeGreaterThan(0n);

    // Validate account has balance from RPC endpoint
    const coreBalance = await testEnv.client.getAccount(reqAccount.stxAddr);
    expect(BigInt(coreBalance.balance)).toBeGreaterThan(0n);
  });
});
