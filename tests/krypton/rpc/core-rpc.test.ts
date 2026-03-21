import * as assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { getTestEnv, stopTestEnv, TestEnvContext } from '../test-env.js';

describe('core RPC tests', () => {
  let testEnv: TestEnvContext;

  before(async () => {
    testEnv = await getTestEnv();
  });

  after(async () => {
    await stopTestEnv(testEnv);
  });

  test('get info', async () => {
    const info = await testEnv.client.getInfo();
    assert.ok(info.peer_version);
  });

  test('get pox info', async () => {
    const poxInfo = await testEnv.client.getPox();
    assert.equal(poxInfo.contract_id, `ST000000000000000000002AMW42H.pox-4`);
  });

  test('get account nonce', async () => {
    const nonce = await testEnv.client.getAccountNonce('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6');
    assert.equal(nonce, 0);
  });

  test('get account balance', async () => {
    const balance = await testEnv.client.getAccountBalance(
      'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6'
    );
    assert.equal(balance, 10000000000000000n);
  });
});
