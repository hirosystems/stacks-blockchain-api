---
Title: Open API Spec
---

# OpenAPI Spec

The Stacks API was designed using the [OpenAPI specification](https://swagger.io/specification/), making it compatible with a variety of developer tools.

The [OpenAPI specification file for Stacks](https://github.com/hirosystems/stacks-blockchain-api/blob/master/docs/openapi.yaml) is used to generate the TypeScript client library. You can use the specification file to generate client libraries for other programming languages using the [openapi-generator tool](https://github.com/OpenAPITools/openapi-generator)

## TypeScript client library

A Typescript client library is available for use of the Stacks API. The client library enables type-safe REST and WebSocket communication with the Stacks API endpoints.

The client is made up of three components:

1. Generated HTTP API client
2. Typescript definitions for [Clarity values](https://docs.stacks.co/docs/write-smart-contracts/values)
3. WebSocket client

The following sections demonstrate common usages of the TypeScript API client.

### HTTP API client sample

The Typescript client library requires you to specify the underlying HTTP request library to handle HTTP communication. The example below uses the universal fetch API [`cross-fetch`](https://github.com/lquixada/cross-fetch):

```js
import fetch from 'cross-fetch';
import { Configuration, AccountsApi } from '@stacks/blockchain-api-client';
(async () => {
  const apiConfig = new Configuration({
    fetchApi: fetch,
    // for mainnet, replace `testnet` with `mainnet`
    basePath: 'https://stacks-node-api.testnet.stacks.co', // defaults to http://localhost:3999
  });
  // initiate the /accounts API with the basepath and fetch library
  const accountsApi = new AccountsApi(apiConfig);
  // get transactions for a specific account
  const txs = await accountsApi.getAccountTransactions({
    principal: 'ST000000000000000000002AMW42H',
  });
  console.log(txs);
})().catch(console.error);
```

### TypeScript sample

The following sample shows how generated [TypeScript models](https://github.com/hirosystems/stacks-blockchain-api/tree/master/client/src/generated/models) can be used for type-safety:

```ts
import fetch from 'cross-fetch';
import {
  Configuration,
  AccountsApi,
  AccountsApiInterface,
  AddressBalanceResponse,
  AddressBalanceResponseStx,
} from '@stacks/blockchain-api-client';
(async () => {
  const apiConfig: Configuration = new Configuration({
    fetchApi: fetch,
    // for mainnet, replace `testnet` with `mainnet`
    basePath: 'https://stacks-node-api.testnet.stacks.co', // defaults to http://localhost:3999
  });
  const principal: string = 'ST000000000000000000002AMW42H';
  // initiate the /accounts API with the basepath and fetch library
  const accountsApi: AccountsApiInterface = new AccountsApi(apiConfig);
  // get balance for a specific account
  const balance: AddressBalanceResponse = await accountsApi.getAccountBalance({
    principal,
  });
  // get STX balance details
  const stxAmount: AddressBalanceResponseStx = balance.stx;
  console.log(stxAmount);
})().catch(console.error);
```

### WebSocket sample

The WebSocket components enable you to subscribe to specific updates, providing a near real-time display of updates on transactions and accounts.

```js
import { connectWebSocketClient } from '@stacks/blockchain-api-client';
const client = await connectWebSocketClient('ws://stacks-node-api.blockstack.org/');
const sub = await client.subscribeAddressTransactions(contractCall.txId, event => {
  console.log(event);
});
await sub.unsubscribe();
```
