## @stacks/blockchain-api-client (&lt;=7.x.x) → (8.x.x)

## Breaking Changes

This library is now generated with [openapi-typescript](https://openapi-ts.dev/openapi-fetch/) rather than [swagger-codegen](https://github.com/swagger-api/swagger-codegen). Several types which previously presented as the `any` type are now fixed, and the `@stacks/stacks-blockchain-api-types` package is no longer needed.


This repo no longer includes a schema for the Stacks Blockchain RPC interface. An alternative client library for the RPC interface can be found at https://github.com/hirosystems/stacks.js/pull/1737.

#### Configuration & Middleware

```ts
// old:
import { TransactionsApi, Configuration } from '@stacks/blockchain-api-client';
const client = new TransactionsApi(new Configuration({
  basePath: 'https://api.mainnet.hiro.so',
  middleware: [{
    pre({url, init}) {
      init.headers = new Headers(init.headers);
      init.headers.set('x-custom-header', 'custom-value');
      return Promise.resolve({ url, init });
    }
  }]
}));


// new:
import { createClient } from '@stacks/blockchain-api-client';
const client = createClient({
  baseUrl: 'https://api.mainnet.hiro.so'
});
client.use({
  onRequest({request}) {
    request.headers.set('x-custom-header', 'custom-value');
    return request;
  }
});
```

#### Performing Requests

```ts
// old:
const blockTxs = await client.getTransactionsByBlock({
  heightOrHash: 2000,
  limit: 20,
  offset: 100
});
console.log('Block transactions:', blockTxs);

// new:
const { data: blockTxs } = await client.GET('/extended/v2/blocks/{height_or_hash}/transactions', { 
  params: { 
    path: { height_or_hash: 2000 }, 
    query: { limit: 20, offset: 100 },
  }
});
console.log('Block transactions:', blockTxs);
```

#### Referencing Types

```ts
// old:
import { MempoolTransactionStatsResponse } from '@stacks/blockchain-api-client';
let response: MempoolTransactionStatsResponse;
response = await client.getMempoolTransactionStats();

// new:
import { OperationResponse } from '@stacks/blockchain-api-client';
let response: OperationResponse['/extended/v1/tx/mempool/stats'];
response = (await client.GET('/extended/v1/tx/mempool/stats')).data;
```
