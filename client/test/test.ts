import fetch from 'cross-fetch';
import { Configuration, BlocksApi, SmartContractsApi, AccountsApi } from '../src/index';

(async () => {
  const apiConfig = new Configuration({
    fetchApi: fetch, // `fetch` lib must be specified in Node.js environments
    basePath: 'https://api.mainnet.hiro.so', // defaults to http://localhost:3999
  });

  const blockApi = new BlocksApi(apiConfig);
  const blocks = await blockApi.getBlockList({ offset: 0, limit: 10 });

  const smartContractsApi = new SmartContractsApi(apiConfig);

  const mapEntry = await smartContractsApi.getContractDataMapEntry({
    contractAddress: 'ST000000000000000000002AMW42H',
    contractName: 'pox',
    mapName: 'reward-cycle-total-stacked',
    key: '0x0c000000010c7265776172642d6379636c650100000000000000000000000000000001',
  });

  const accountsApi = new AccountsApi(apiConfig);
  const txs = await accountsApi.getAccountTransactions({
    principal: 'ST000000000000000000002AMW42H',
  });
})().catch(e => {
  console.error(e);
  process.exit(1);
});
