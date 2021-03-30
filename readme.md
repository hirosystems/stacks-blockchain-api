# @blockstack/stacks-blockchain-api

[![Build Status](https://img.shields.io/endpoint.svg?url=https%3A%2F%2Factions-badge.atrox.dev%2Fblockstack%2Fstacks-blockchain-api%2Fbadge%3Fref%3Dmaster&style=flat)](https://actions-badge.atrox.dev/blockstack/stacks-blockchain-api/goto?ref=master)

[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/blockstack/stacks-blockchain-api)

## Quick start

A self-contained Docker image is provided which starts a Stacks 2.0 blockchain and API instance.

Ensure Docker is installed, then run the command:

```
docker run -p 3999:3999 blockstack/stacks-blockchain-api-standalone
```

Similarly, a "mocknet" instance can be started. This runs a local node, isolated from the testnet/mainnet:

```
docker run -p 3999:3999 blockstack/stacks-blockchain-api-standalone mocknet
```

Once the blockchain has synced with network, the API will be available at:
[http://localhost:3999](http://localhost:3999)

## Development quick start

Clone repo and install dependencies with `npm install`.

Run `npm run dev:integrated`.

This command will concurrently start the API server app and the service dependencies.

Check to see if the server started successfully by visiting http://localhost:3999/extended/v1/status

## Local Development

### Requirements

An API client is generated automatically with [OpenAPI Generator](https://github.com/OpenAPITools/openapi-generator). This has a dependency on [Java RE](https://www.java.com/en/download/).

### Setup Services

Then run `npm run devenv:deploy` which uses docker-compose to deploy the service dependencies (e.g. PostgreSQL, Blockstack core node, etc).

### Running the server

To run the server in 'watch' mode (restart for every code change), run `npm run dev:watch`. You'll have a server on port 3999.
