# @stacks/blockchain-api-client
[![NPM Package](https://img.shields.io/npm/v/@stacks/blockchain-api-client.svg?style=flat-square)](https://www.npmjs.org/package/@stacks/blockchain-api-client)

A JS Client for the Stacks Blockchain API

## Features

This package provides the ability to:

- Execute REST API requests against the Stacks Blockchain API
- Subscribe to WebSockets or Socket.io for real-time Stacks updates (see [Available Updates](#Available-Updates))
- Full type safety for WebSocket and API requests and responses

## Documentation

The documentation for the client library is published as [github pages](https://hirosystems.github.io/stacks-blockchain-api/client/).

## Installation

You can install this package using NPM:

```shell
npm install --save @stacks/blockchain-api-client
```

## Usage

Here is example code that subscribes to updates for a specific Stacks address:

### Websockets

```js
import { connectWebSocketClient } from '@stacks/blockchain-api-client';

// for testnet, replace with wss://api.testnet.hiro.so/
const client = await connectWebSocketClient('wss://api.mainnet.hiro.so/');

const sub = await client.subscribeAddressTransactions('ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA', event =>
  console.log(event);
);

await sub.unsubscribe();
```

### Socket.io

```js
import { io } from "socket.io-client";
import * as stacks from '@stacks/blockchain-api-client';

// for testnet, replace with https://api.testnet.hiro.so/
const socketUrl = "https://api.mainnet.hiro.so/";

const socket = io(socketUrl, {
  transports: [ "websocket" ]
});
const sc = new stacks.StacksApiSocketClient(socket);

sc.subscribeAddressTransactions('ST3GQB6WGCWKDNFNPSQRV8DY93JN06XPZ2ZE9EVMA');
```

## Available Updates

### Block Updates

Sent every time a new Stacks block is mined.

Example message:
```json
{
  "canonical": true,
  "height": 3275,
  "hash": "0xe77ba8cf6bb7c0e4f64adc83356289ed467d31a22354907b4bb814590058430f",
  "parent_block_hash": "0x75ab21ef25cbff2caa14c27d830ed7886a4d1522e1b6f9e5dc3b59ccf73ed49f",
  "burn_block_time": 1594233639,
  "burn_block_time_iso": "2020-08-27T16:41:26.000Z",
  "burn_block_hash": "0xb154c008df2101023a6d0d54986b3964cee58119eed14f5bed98e15678e18fe2",
  "burn_block_height": 654439,
  "miner_txid": "0xd7d56070277ccd87b42acf0c91f915dd181f9db4cf878a4e95518bc397c240cc",
  "parent_microblock_hash": "0x590a1bb1d7bcbeafce0a9fc8f8a69e369486192d14687fe95fbe4dc1c71d49df",
  "parent_microblock_sequence": 2,
  "txs": [
    "0x4262db117659d1ca9406970c8f44ffd3d8f11f8e18c591d2e3960f4070107754",
    "0x383632cd3b5464dffb684082750fcfaddd1f52625bbb9f884ed8f45d2b1f0547",
    "0xc99fe597e44b8bd15a50eec660c6e679a7144a5a8553d214b9d5f1406d278c22"
  ],
  "microblocks_accepted": [
    "0xce0b1a4099d3fc7d5885cc7a3baa952b6d999f9709d0683b98b843597208231c",
    "0x4c0529b6448a5885991c5021bd869cc97f1692c128a98b382729dc962203c326",
    "0x64968846291dfea1015228a9d4bbd60aac81378cd6774b810b08e59e6b0e7494"
  ],
  "microblocks_streamed": [
    "0xb5650ef855f7d90fc146942e85cf9fac3a8c47ec408aca02f3cf9ed7c82f6cc6",
    "0xeeb9aa5741d84aa0bc5de4f2fbdeae57ae29694479475d45a67ae7bd7e2c98f3",
    "0x4f4c368d5f06fdf6065c5bafd9cb37391fddc9c279cfc57be35e4bf8ee932cbd",
    "0xde2fc8d99872c827f144c752c002d29f9315dfc09472a09572ac7447ae623dea"
  ],
  "execution_cost_read_count": 2477,
  "execution_cost_read_length": 1659409,
  "execution_cost_runtime": 2520952000,
  "execution_cost_write_count": 608,
  "execution_cost_write_length": 80170
}
```
Subscribe via WebSockets:
```js
client.subscribeBlocks(event => {});
```
Subscribe via Socket.io:
```js
sc.subscribeBlocks();
```

### Microblock Updates

Sent every time a new Stacks microblock is streamed.

Example message:
```json
{
  "canonical": true,
  "microblock_canonical": true,
  "microblock_hash": "0xa31ee2244ceee0d042c0b129a91df2433c4ffd3b94e7e4e5dfa3a15927684a6f",
  "microblock_sequence": 0,
  "microblock_parent_hash": "0x5d053c206a7bcc5dcfe8bb8a61d8699fc068179f388eb2aec62786b7318c36c4",
  "block_height": 38224,
  "parent_block_height": 38223,
  "parent_block_hash": "0x5d053c206a7bcc5dcfe8bb8a61d8699fc068179f388eb2aec62786b7318c36c4",
  "block_hash": "",
  "txs": [
    "0xe4b46358b7864c9db31e15e7db4f74042a2e1748db920b93480ed56463ac1c48",
    "0x1de11ca776fc4a713465bc5974790cd3cdab7d8ad89fa474c10a4160cf89efdc",
    "0x16b3a99d6d100562964f6f0f0ae02d47121386495c4fd903e4e9f72548ae0b35",
    "0xc99f802dfffee9190e4b8ee5c128295f4eec51974d7cabdec0ba49c35b17bca5",
    "0xeffa0b1d1e5b96dc1de1ff49b390752f35cbe49eddf5a6c7ff1ee80ea2b73886",
    "0x93f927bdf15056f65ff3b0c6041287c9cfd070e4bddadedeb1aa1627d837022a",
    "0xdbd62060daf483a7fdac2d76c3a88091690ff1f26827e2627c0894e5f73dcf0a",
    "0x0d89a6edb51f96eec1dfbbaf1abc66861c96c75a6962545c0783d78773563a4b"
  ],
  "parent_burn_block_height": 710158,
  "parent_burn_block_hash": "0x00000000000000000007b6fa2dcd91e0c69d488f9742d7e5261286aefce29ee0",
  "parent_burn_block_time": 1637167098,
  "parent_burn_block_time_iso": "2021-11-17T16:38:18.000Z"
}
```
Subscribe via WebSockets:
```js
client.subscribeMicroblocks(event => {});
```
Subscribe via Socket.io:
```js
sc.subscribeMicroblocks();
```

### Mempool Updates

Sent every time a new transaction is submitted to the mempool. Transactions of different types and structures may be received.

Example message:
```json
{
  "tx_id": "0x698096b646d17297836542beecfe8d6a30454b2ce5ce4e9b0e5d243b05dce998",
  "nonce": 66,
  "fee_rate": "554000",
  "sender_address": "SPBDCE0KCWY56SX6XE7MB6DVVETABYM2WRDK6PCB",
  "sponsored": false,
  "post_condition_mode": "allow",
  "post_conditions": [],
  "anchor_mode": "any",
  "tx_status": "pending",
  "receipt_time": 1637172201,
  "receipt_time_iso": "2021-11-17T18:03:21.000Z",
  "tx_type": "contract_call",
  "contract_call": {
    "contract_id": "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-swap-v2-1",
    "function_name": "swap-x-for-y",
    "function_signature": "",
    "function_args": [
      {
        "hex": "0x0616982f3ec112a5f5928a5c96a914bd733793b896a50e61726b6164696b6f2d746f6b656e",
        "repr": "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token",
        "name": "token-x-trait",
        "type": "trait_reference"
      },
      {
        "hex": "0x0616982f3ec112a5f5928a5c96a914bd733793b896a50a757364612d746f6b656e",
        "repr": "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token",
        "name": "token-y-trait",
        "type": "trait_reference"
      },
      {
        "hex": "0x010000000000000000000000003b023380",
        "repr": "u990000000",
        "name": "dx",
        "type": "uint"
      },
      {
        "hex": "0x0100000000000000000000000062ea4a9f",
        "repr": "u1659521695",
        "name": "min-dy",
        "type": "uint"
      }
    ]
  }
}
```
Subscribe via WebSockets:
```js
client.subscribeMempool(event => {});
```
Subscribe via Socket.io:
```js
sc.subscribeMempool();
```

### Transaction Updates

Sent every time a single transaction (subscribed by transaction ID) is updated. Transactions of different types and structures may be received.

Example message if subscribed to updates for a transaction with ID  `0xd78988664aaa9a1b751cd58c55b253914f790e95ca6f3d402a866559e1cbe0b3` after it was submitted to the mempool:
```json
{
  "tx_id": "0xd78988664aaa9a1b751cd58c55b253914f790e95ca6f3d402a866559e1cbe0b3",
  "nonce": 18,
  "fee_rate": "74400",
  "sender_address": "SP36ADRBVM8J00ZWR5QXC8V65WTJNCD1BF4EJ93ZZ",
  "sponsored": false,
  "post_condition_mode": "deny",
  "post_conditions": [
    {
      "type": "stx",
      "condition_code": "sent_less_than_or_equal_to",
      "amount": "50000000",
      "principal": {
        "type_id": "principal_standard",
        "address": "SP36ADRBVM8J00ZWR5QXC8V65WTJNCD1BF4EJ93ZZ"
      }
    }
  ],
  "anchor_mode": "any",
  "is_unanchored": false,
  "block_hash": "0x4f957ac52af57196eea8ae6ca9e848fc7772da72365d9ed4d3452afddc7a3cf2",
  "parent_block_hash": "0x4b7ea97418fd44fbc4af278424fbde67fbfb253398628f78319671d1eab48a47",
  "block_height": 38231,
  "burn_block_time": 1637173532,
  "burn_block_time_iso": "2021-11-17T18:25:32.000Z",
  "parent_burn_block_time": 1637173325,
  "parent_burn_block_time_iso": "2021-11-17T18:22:05.000Z",
  "canonical": true,
  "tx_index": 27,
  "tx_status": "success",
  "tx_result": {
    "hex": "0x070100000000000000000000000000000009",
    "repr": "(ok u9)"
  },
  "microblock_hash": "",
  "microblock_sequence": 2147483647,
  "microblock_canonical": true,
  "event_count": 4,
  "events": [],
  "execution_cost_read_count": 13,
  "execution_cost_read_length": 4320,
  "execution_cost_runtime": 5609000,
  "execution_cost_write_count": 5,
  "execution_cost_write_length": 21,
  "tx_type": "contract_call",
  "contract_call": {
    "contract_id": "SPZW30K9VG6YCPYV4BX4V1FT0VJ66R1Q01W9DQ1W.nebula",
    "function_name": "claim",
    "function_signature": "(define-public (claim ))"
  }
},
```
Subscribe via WebSockets:
```js
client.subscribeTxUpdates('0xd78988664aaa9a1b751cd58c55b253914f790e95ca6f3d402a866559e1cbe0b3', event => {});
```
Subscribe via Socket.io:
```js
sc.subscribeTransaction('0xd78988664aaa9a1b751cd58c55b253914f790e95ca6f3d402a866559e1cbe0b3');
```

### Address Transaction Updates

Sent every time a transaction is sent or received by a specific Stacks address. Transactions of different types and structures may be received.

Example message if subscribed to updates for an address `SP3C5SSYVKPAWTR8Y63CVYBR65GD3MG7K80526D1Q`:
```json
{
  "tx": {
    "tx_id": "0x0c818b9af6356a2eb4d64ee1b2490193d97a82392c02e7264e006ae5979aa726",
    "nonce": 32,
    "fee_rate": "3000",
    "sender_address": "SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR",
    "sponsored": false,
    "post_condition_mode": "deny",
    "post_conditions": [
      {
        "type": "stx",
        "condition_code": "sent_equal_to",
        "amount": "4375722",
        "principal": {
          "type_id": "principal_contract",
          "contract_name": "newyorkcitycoin-core-v1",
          "address": "SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5"
        }
      }
    ],
    "anchor_mode": "any",
    "is_unanchored": false,
    "block_hash": "0xe2a811451fed35331cf462a9107e3453fdebba1682dfad83cbbcdc603f644ed3",
    "parent_block_hash": "0x6d8653da23188d4d78ab9b6448229be68abe1bca001f8c574c094289107bce15",
    "block_height": 58775,
    "burn_block_time": 1651720813,
    "burn_block_time_iso": "2022-05-05T03:20:13.000Z",
    "parent_burn_block_time": 1651720368,
    "parent_burn_block_time_iso": "2022-05-05T03:12:48.000Z",
    "canonical": true,
    "tx_index": 36,
    "tx_status": "success",
    "tx_result": {
      "hex": "0x0703",
      "repr": "(ok true)"
    },
    "microblock_hash": "",
    "microblock_sequence": 2147483647,
    "microblock_canonical": true,
    "event_count": 1,
    "events": [],
    "execution_cost_read_count": 15,
    "execution_cost_read_length": 31147,
    "execution_cost_runtime": 81975,
    "execution_cost_write_count": 2,
    "execution_cost_write_length": 123,
    "tx_type": "contract_call",
    "contract_call": {
      "contract_id": "SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-core-v1",
      "function_name": "claim-stacking-reward",
      "function_signature": "(define-public (claim-stacking-reward (targetCycle uint)))",
      "function_args": [
        {
          "hex": "0x0100000000000000000000000000000008",
          "repr": "u8",
          "name": "targetCycle",
          "type": "uint"
        }
      ]
    }
  },
  "stx_sent": "3000",
  "stx_received": "4375722",
  "stx_transfers": [
    {
      "amount": "4375722",
      "sender": "SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-core-v1",
      "recipient": "SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR"
    }
  ],
  "ft_transfers": [],
  "nft_transfers": []
}
```
Subscribe via WebSockets:
```js
client.subscribeAddressTransactions('SP3C5SSYVKPAWTR8Y63CVYBR65GD3MG7K80526D1Q', event => {});
```
Subscribe via Socket.io:
```js
sc.subscribeAddressTransactions('SP3C5SSYVKPAWTR8Y63CVYBR65GD3MG7K80526D1Q');
```

### Address Balance Updates

Sent every time a specific address sends or receives a transaction that changes its balance.

Example message:
```json
{
  "balance": "53349741093",
  "total_sent": "6432000000",
  "total_received": "60358503333",
  "total_fees_sent": "576762240",
  "total_miner_rewards_received": "0",
  "lock_tx_id": "",
  "locked": "0",
  "lock_height": 0,
  "burnchain_lock_height": 0,
  "burnchain_unlock_height": 0,
  "token_offering_locked": {
    "total_locked": "0",
    "total_unlocked": "18286444440",
    "unlock_schedule": [
      {
        "amount": "2285805555",
        "block_height": 24837
      },
      {
        "amount": "2285805555",
        "block_height": 29157
      },
      {
        "amount": "2285805555",
        "block_height": 33477
      }
    ]
  }
}
```
Subscribe via WebSockets:
```js
client.subscribeAddressBalanceUpdates('SP3C5SSYVKPAWTR8Y63CVYBR65GD3MG7K80526D1Q', event => {});
```
Subscribe via Socket.io:
```js
sc.subscribeAddressStxBalance('SP3C5SSYVKPAWTR8Y63CVYBR65GD3MG7K80526D1Q');
```

### NFT event updates

Sent every time an NFT event occurs. You can subscribe to all events or events scoped to a single
collection or a single asset.

```json
{
  "asset_event_type": "transfer",
  "asset_identifier": "SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD.project-indigo-act1::Project-Indigo-Act1",
  "value": {
    "hex": "0x0100000000000000000000000000000095",
    "repr": "u149"
  },
  "tx_id": "0xfb4bfc274007825dfd2d8f6c3f429407016779e9954775f82129108282d4c4ce",
  "tx_index": 0,
  "sender": null,
  "recipient": "SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR",
  "block_height": 45231,
  "event_index": 0,
}
```
Subscribe via WebSockets:
```js
client.subscribeNftEventUpdates(event => {});
client.subscribeNftAssetEventUpdates(
  'SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD.project-indigo-act1::Project-Indigo-Act1',
  '0x0100000000000000000000000000000095',
  event => {}
);
client.subscribeNftCollectionEventUpdates(
  'SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD.project-indigo-act1::Project-Indigo-Act1',
  event => {}
);
```
Subscribe via Socket.io:
```js
sc.subscribeNftEventUpdates();
sc.subscribeNftAssetEventUpdates(
  'SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD.project-indigo-act1::Project-Indigo-Act1',
  '0x0100000000000000000000000000000095',
);
sc.subscribeNftCollectionEventUpdates(
  'SP176ZMV706NZGDDX8VSQRGMB7QN33BBDVZ6BMNHD.project-indigo-act1::Project-Indigo-Act1',
);
```

## Known Issues

- The TypeScript definitions for several objects involving type unions, including transactions, are incorrectly specified as only `object`.
