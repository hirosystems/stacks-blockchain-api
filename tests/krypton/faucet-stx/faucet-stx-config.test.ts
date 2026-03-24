import { getStxFaucetNetwork } from '../../../src/helpers.ts';
import { ENV } from '../../../src/env.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('stx faucet', () => {
  test('faucet node env var override', () => {
    const faucetDefaults = getStxFaucetNetwork();
    assert.equal(faucetDefaults.coreApiUrl, 'http://127.0.0.1:20443');

    ENV.STACKS_FAUCET_NODE_HOST = '1.2.3.4';
    ENV.STACKS_FAUCET_NODE_PORT = 12345;

    try {
      const faucetOverride = getStxFaucetNetwork();
      assert.equal(faucetOverride.coreApiUrl, 'http://1.2.3.4:12345');
    } finally {
      ENV.STACKS_FAUCET_NODE_HOST = undefined;
      ENV.STACKS_FAUCET_NODE_PORT = undefined;
    }
  });
});
