---
Title: Overview
---

# Overview

The Stacks blockchain API allows you to query the Stacks blockchain and interact with smart contracts. It was built to maintain paginated, materialized views of the Stacks Blockchain.

The Stacks Blockchain API is hosted by Hiro. Using it requires you to trust the hosted server, but this API also provides a faster development experience. You may wish to consider running your own API instance to create a fully trustless architecture for your app.

## Architecture

![API architecture!](images/api-architecture.png)

* The `stacks-node` has it's own minimal set of http endpoints referred to as `RPC endpoints`
  * The `stacks-blockchain-api` allows clients to access these endpoints by proxying them through to a load-balanced pool of `stacks-nodes`.
  * See: https://github.com/blockstack/stacks-blockchain/blob/master/docs/rpc-endpoints.md -- some common ones:
    * `POST /v2/transactions` - broadcast a tx.
    * `GET /v2/pox` - get current PoX-relevant information.
    * `POST /v2/contracts/call-read/<contract>/<function>` - evaluates and returns the result of calling a Clarity function.
    * `POST /v2/fees/transaction` - evaluates a given transaction and returns tx fee estimation data.
    * `GET /v2/accounts/<address>` - used to get the current `nonce` required for creating transactions.


* The endpoints implemented by `stacks-blockchain-api` provide data that the `stacks-node` can't due to various constraints.
  * Typically this is either data that the `stacks-node` doesn't persist, or data that it cannot efficiently serve to many clients.
    For example, the `stacks-node` can return the current STX balance of an account, but it can't return a history of account transactions.
  * The API also implements the Rosetta spec created by Coinbase -- "an open standard designed to simplify blockchain deployment and interaction."
    * See: https://www.rosetta-api.org/
  * The API also implements the BNS (Blockchain Naming System) endpoints.
    * See https://docs.stacks.co/build-apps/references/bns
  * See `/src/api/routes` for the Express.js routes.


* The API creates an "event observer" http server which listens for events from a `stacks-node` "event emitter"
  * These events are http POST requests that contain things like blocks, transactions, byproducts of executed transactions.
    * Transaction "byproducts" are things like asset transfers, smart-contract log data, execution cost data.
  * The API processes and stores these as relational data in postgres.
  * See `/src/event-stream` for the "event observer" code.


* All http endpoints and responses are defined in OpenAPI and JSON Schema.
  * See `/docs/openapi.yaml`
  * These are used to auto generate the docs at https://hirosystems.github.io/stacks-blockchain-api/
  * The JSON Schemas are converted into Typescript interfaces, which are used internally by the db controller module to transform SQL query results into the correct object shapes.
  * ALSO the OpenAPI + JSONSchemas are used to generate a standalone `@stacks/blockchain-api-client`.


* The easiest/quickest way to develop in this repo is using the vscode debugger. It uses docker-compose to setup a `stacks-node` and postgres instance.
  * Alternatively, you can run `npm run dev:integrated` which does the same thing but without a debugger.


