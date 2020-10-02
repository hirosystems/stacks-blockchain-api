import * as process from 'process';
import { getStxFaucetNetwork } from '../api/routes/faucets';

describe('stx faucet', () => {
  test('faucet node env var override', () => {
    const faucetDefault = getStxFaucetNetwork();
    expect(faucetDefault.coreApiUrl).toBe('http://127.0.0.1:20443');

    process.env.STACKS_FAUCET_NODE_HOST = '1.2.3.4';
    process.env.STACKS_FAUCET_NODE_PORT = '12345';

    try {
      const faucetOverride = getStxFaucetNetwork();
      expect(faucetOverride.coreApiUrl).toBe('http://1.2.3.4:12345');
    } finally {
      delete process.env.STACKS_FAUCET_NODE_HOST;
      delete process.env.STACKS_FAUCET_NODE_PORT;
    }
  });
});
