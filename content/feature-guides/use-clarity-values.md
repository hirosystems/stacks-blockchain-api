---
Title: Use Clarity Values
---


# Using Clarity Values

Some endpoints, like the [read-only function contract call](https://docs.hiro.so/api#operation/call_read_only_function), require input to a serialized [Clarity value](https://docs.stacks.co/docs/write-smart-contracts/values). Other endpoints return serialized values that need to be deserialized.

The example shown below illustrates Clarity value usage in combination with the API.

The `@stacks/transactions` library supports typed contract calls and makes [response value utilization much simpler](https://docs.stacks.co/docs/write-smart-contracts/values#utilizing-clarity-values-from-transaction-responses)

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
    basePath: 'https://stacks-node-api.testnet.stacks.co', // defaults to http://localhost:3999
  });

  const contractsApi: SmartContractsApiInterface = new SmartContractsApi(apiConfig);

  const principal: string = 'ST000000000000000000002AMW42H';

  // use most recent from: https://stacks-node-api.<mainnet/testnet>.stacks.co/v2/pox
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
