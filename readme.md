# @blockstack/stacks-blockchain-api

[![Build Status](https://img.shields.io/endpoint.svg?url=https%3A%2F%2Factions-badge.atrox.dev%2Fblockstack%2Fstacks-blockchain-api%2Fbadge%3Fref%3Dmaster&style=flat)](https://actions-badge.atrox.dev/blockstack/stacks-blockchain-api/goto?ref=master)

[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/blockstack/stacks-blockchain-api)

## Quick start

A self-contained Docker image is provided which will start a Stacks 2.0 blockchain and API testnet.

Ensure Docker is installed, then run the command:

```
docker run -p 3999:3999 <docker image TBD>
```

Once the blockchain has synced with network, the API will be available at:
[http://localhost:3999](http://localhost:3999)

## Development quick start

First, ensure Docker is installed on your machine. 

Clone repo and install dependencies with `npm install`.

Run `npm run dev:integrated`.

This command will concurrently start the API server app and the service dependencies.

Check to see if the server started successfully by visiting http://localhost:3999/extended/v1/status

## Local Development

### Setup Services

Then run `npm run devenv:deploy` which uses docker-compose to deploy the service dependencies (e.g. PostgreSQL, Blockstack core node, etc).

### Running the server

To run the server in 'watch' mode (restart for every code change), run `npm run dev:watch`. You'll have a server on port 3999.
