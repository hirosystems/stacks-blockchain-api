# @stacks/blockchain-api-client
[![NPM Package](https://img.shields.io/npm/v/@stacks/blockchain-api-client.svg?style=flat-square)](https://www.npmjs.org/package/@stacks/blockchain-api-client)
[![Build Status](https://github.com/blockstack/stacks-blockchain-api/workflows/stacks-blockchain-api/badge.svg)](https://github.com/blockstack/stacks-blockchain-api/actions)

A JS Client for the Stacks Blockchain API

## Features

This package provides the ability to:

- Execute REST API requests against the Stacks Blockchain API
- Subscribe to WebSockets for real-time Stacks updates (for addresses or transactions)
- Full type safety for WebSocket and API requests and responses

## Installation

You can install this package using NPM:

```shell
npm install --save-dev @stacks/blockchain-api-client
```

## Usage

Here is an example code that connects with the WebSocket server and subscribes to updates for a specific Stacks address:

```js
import { connectWebSocketClient } from '@stacks/blockchain-api-client';

// for mainnet, replace with ws://stacks-node-api.testnet.stacks.co/
const client = await connectWebSocketClient('wss://stacks-node-api.mainnet.stacks.co/');

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

- The TypeScript definitions for several objects involving type unions, including transactions, are incorrectly specified as only `object`.
