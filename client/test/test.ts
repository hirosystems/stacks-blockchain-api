import fetch from 'cross-fetch';
import { Configuration, BlocksApi, SmartContractsApi, AccountsApi } from '../src/index';

(async () => {
  const apiConfig = new Configuration({
    fetchApi: fetch, // `fetch` lib must be specified in Node.js environments
    basePath: 'https://stacks-node-api.blockstack.org', // defaults to http://localhost:3999
  });

  const blockApi = new BlocksApi(apiConfig);
  const blocks = await blockApi.getBlockList({ offset: 0, limit: 10 });

  console.log(blocks.total);
  console.log(blocks.results);

  const smartContractsApi = new SmartContractsApi(apiConfig);
  const readOnly = await smartContractsApi.callReadOnlyFunction({
    stacksAddress: 'ST12EY99GS4YKP0CP2CFW6SEPWQ2CGVRWK5GHKDRV',
    contractName: 'flip-coin-jackpot',
    functionName: 'get-optional-winner-at',
    readOnlyFunctionArgs: {
      sender: 'ST12EY99GS4YKP0CP2CFW6SEPWQ2CGVRWK5GHKDRV',
      arguments: ['0x0100000000000000000000000000000001'],
    },
  });
  console.log(readOnly);

  const mapEntry = await smartContractsApi.getContractDataMapEntry({
    stacksAddress: 'ST000000000000000000002AMW42H',
    contractName: 'pox',
    mapName: 'reward-cycle-total-stacked',
    key: '0x0c000000010c7265776172642d6379636c650100000000000000000000000000000001',
  });
  console.log(mapEntry);

  const accountsApi = new AccountsApi(apiConfig);
  const txs = await accountsApi.getAccountTransactions({
    principal: 'ST000000000000000000002AMW42H',
  });
  console.log(txs);
})().catch(console.error);
