import { loadDotEnv, timeout } from '../helpers';
import { getRpcClient } from '../btc-faucet';

// ts-unused-exports:disable-next-line
export default async () => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  const client = getRpcClient();
  const start = Date.now();
  do {
    try {
      const btcChainInfo = await client.getblockchaininfo();
      console.log(`btcd ready: ${JSON.stringify(btcChainInfo)}`);
      break;
    } catch (error: any) {
      console.log(`btcd rpc loading: ${error.message}`);
      await timeout(350);
    }
  } while (Date.now() - start < 60000);
  console.log('Jest - setup done');
};
