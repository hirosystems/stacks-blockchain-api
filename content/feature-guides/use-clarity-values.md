---
Title: Use Clarity Values
---


# Using Clarity Values

Some endpoints, like the [read-only function contract call](https://docs.hiro.so/api/call-read-only-function), require input to be a serialized [Clarity value](https://docs.hiro.so/stacks-blockchain-api/feature-guides/transactions#clarity-value-types). Other endpoints return serialized values that need to be deserialized.

The example shown below illustrates Clarity value usage in combination with the API.

The `@stacks/transactions` library supports typed contract calls and makes response value utilization much simpler.

```ts
import {
  Configuration,
  SmartContractsApiInterface,
  SmartContractsApi,
  ReadOnlyFunctionSuccessResponse,
} from '@stacks/blockchain-api-client';
import { uintCV, UIntCV, cvToHex, hexToCV, ClarityType } from '@stacks/transactions';

(async () => {
  const apiConfig: Configuration = new Configuration({
    fetchApi: fetch,
    // for mainnet, replace `testnet` with `mainnet`
    basePath: 'https://api.testnet.hiro.so', // defaults to http://localhost:3999
  });

  const contractsApi: SmartContractsApiInterface = new SmartContractsApi(apiConfig);

  const principal: string = 'ST000000000000000000002AMW42H';

  // use most recent from: https://api.<mainnet/testnet>.hiro.so/v2/pox
  const rewardCycle: UIntCV = uintCV(22);

  // call a read-only function
  const fnCall: ReadOnlyFunctionSuccessResponse = await contractsApi.callReadOnlyFunction({
    contractAddress: principal,
    contractName: 'pox',
    functionName: 'is-pox-active',
    readOnlyFunctionArgs: {
      sender: principal,
      arguments: [cvToHex(rewardCycle)],
    },
  });

  console.log({
    status: fnCall.okay,
    result: fnCall.result,
    representation: hexToCV(fnCall.result).type === ClarityType.BoolTrue,
  });
})().catch(console.error);
```
