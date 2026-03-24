/* eslint-disable @typescript-eslint/no-non-null-assertion */
import supertest from 'supertest';
import { RunFaucetResponse } from '../../../src/api/schemas/responses/responses.ts';
import { AddressStxBalance } from '../../../src/api/schemas/entities/addresses.ts';
import {
  Account,
  accountFromKey,
  standByForTxSuccess,
  fetchGet,
  KryptonContext,
  getKryptonContext,
  stopKryptonContext,
} from '../krypton-env.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

describe('STX Faucet', () => {
  const reqAccountKey = 'b1ee37d996b1cf95ff67996a38426cff398d3adfeccf8ae8b3651a530837dd5801';
  let reqAccount: Account;
  let reqTx: RunFaucetResponse;
  let ctx: KryptonContext;

  before(async () => {
    ctx = await getKryptonContext();
    reqAccount = accountFromKey(reqAccountKey);
  });

  after(async () => {
    await stopKryptonContext(ctx);
  });

  test('STX faucet http request succeeds', async () => {
    const response = await supertest(ctx.api.server).post(
      `/extended/v1/faucets/stx?address=${reqAccount.stxAddr}`
    );
    assert.equal(response.status, 200);
    reqTx = response.body;
    assert.equal(typeof reqTx.txId, 'string');
    assert.equal(typeof reqTx.txRaw, 'string');
    assert.equal(reqTx.success, true);
  });

  test('STX faucet http request post body', async () => {
    const response = await supertest(ctx.api.server)
      .post(`/extended/v1/faucets/stx`)
      .send({ address: reqAccount.stxAddr, stacking: true });
    assert.equal(response.status, 400);
    const reqTx: any = response.body;
    assert.equal(reqTx.success, false);
    assert.ok(reqTx.error.includes('POST body is no longer supported'));
    // check for helpful error message
    assert.ok(reqTx.error.includes(`address=${reqAccount.stxAddr}`));
  });

  test('STX faucet tx mined successfully', async () => {
    const tx = await standByForTxSuccess(reqTx.txId, ctx);
    assert.equal(tx.token_transfer_recipient_address, reqAccount.stxAddr);
  });

  test('STX faucet recipient balance', async () => {
    // Validate account has balance from API endpoint
    const addrBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${reqAccount.stxAddr}/stx`,
      ctx
    );
    assert.ok(BigInt(addrBalance.balance) > 0n);

    // Validate account has balance from RPC endpoint
    const coreBalance = await ctx.client.getAccount(reqAccount.stxAddr);
    assert.ok(BigInt(coreBalance.balance) > 0n);
  });
});
