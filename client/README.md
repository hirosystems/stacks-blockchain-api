# @stacks/blockchain-api-client
[![NPM Package](https://img.shields.io/npm/v/@stacks/blockchain-api-client.svg?style=flat-square)](https://www.npmjs.org/package/@stacks/blockchain-api-client)
[![Build Status](https://github.com/blockstack/stacks-blockchain-api/workflows/Build/badge.svg)](https://github.com/blockstack/stacks-blockchain-api/actions)

A JS Client for the Stacks Blockchain API. This includes a JSON RPC WebSocket client to subscribe to real-time updates, with full type safety.

![image](https://user-images.githubusercontent.com/1447546/89547223-b8aa0980-d7c2-11ea-9aea-658a9dc96a67.png)

![image](https://user-images.githubusercontent.com/1447546/89547299-d0818d80-d7c2-11ea-8a2c-80dc75bb3f04.png)

## Installation

You can install this package using NPM:

```shell
npm install --save-dev @blockstack/ws-rpc-client
```

## Usage

Here is an example code that connects with the WebSocket server and subscribes to updates for a specific Stacks address:

```js
import { connect as connectWebSocketClient } from '@blockstack/ws-rpc-client';

const client = await connectWebSocketClient('ws://stacks-node-api-latest.argon.blockstack.xyz/');

const sub = await client.subscribeAddressTransactions('ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA', event =>
  console.log(event);
  /*
    {
      address: 'ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA',
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'success',
      tx_type: 'token_transfer',
    }
  */
);

await sub.unsubscribe();
```

## Documentation
You can find full references [here](https://blockstack.github.io/stacks-blockchain-api/client/index.html).

## Known Issues

* The TypeScript definitions for several objects involving type unions, including transactions, are incorrectly specified as only `object`.
