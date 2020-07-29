import fetch from 'cross-fetch';
import { Configuration, BlocksApi } from './index';

(async () => {

  const apiConfig = new Configuration({ 
    fetchApi: fetch, // `fetch` lib must be specified in Node.js environments
    basePath: 'https://sidecar.staging.blockstack.xyz' // defaults to http://localhost:3999
  });

  const blockApi = new BlocksApi(apiConfig);
  const blocks = await blockApi.getBlockList({ offset: 0, limit: 10 });

  console.log(blocks.total);
  console.log(blocks.results);

})().catch(console.error)
