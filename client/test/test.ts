import fetch from 'cross-fetch';
import { Configuration, BlocksApi, SmartContractsApi } from '../src/index';

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
})().catch(console.error);
