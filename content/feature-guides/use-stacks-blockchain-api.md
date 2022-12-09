---
Title: Use Stacks Blockchain API
---


# Use Stacks Blockchain API

The RESTful JSON API can be used without any authorization. The base path for the API is:

```for mainnet, replace `testnet` with `mainnet
https://stacks-node-api.testnet.stacks.co/```

For more information about the Stacks Blockchain API, please refer to the [Stacks API reference](https://docs.hiro.so/api?_gl=1*1nvx6u*_ga*NTQ3NDA3NTIuMTY2MDA3MTQ1MA..*_ga_NB2VBT0KY2*MTY2MzkxNTIzNS4yMi4xLjE2NjM5MTY1OTMuMC4wLjA.) page.

The API is comprised of two parts: the Stacks Blockchain API and the Stacks Node RPC API. The Node RPC API is exposed by every running node. Stacks Blockchain API, however, introduces additional capabilities (for example, retrieving all transactions), while also running proxies calls directly to Stacks Node RPC API.

## Stacks node RPC API

The stacks-node implementation exposes JSON RPC endpoints.

All `/v2/` routes are routed through a proxy to a Hiro-hosted Stacks Node. For a trustless architecture, you should make these requests to a self-hosted node.

## Stacks blockchain API

All `/extended/` routes are provided by the Stacks 2.0 Blockchain API directly, and extend the Stacks Node API capabilities to make integration much easier.

## Running an API server

While Hiro provides a hosted API server of the Stacks Blockchain API, anyone can spin up their own version. Please [follow the instructions in this guide](/get-started/running-api-node) to start a Docker container with the API service running.

Once started, the API is available on `localhost:3999`

[microblocks_api]: https://docs.hiro.so/api#tag/Microblocks
