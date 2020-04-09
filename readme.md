# @blockstack/stacks-blockchain-sidecar

[![Build Status](https://img.shields.io/endpoint.svg?url=https%3A%2F%2Factions-badge.atrox.dev%2Fblockstack%2Fstacks-blockchain-sidecar%2Fbadge%3Fref%3Dmaster&style=flat)](https://actions-badge.atrox.dev/blockstack/stacks-blockchain-sidecar/goto?ref=master)

## Local Development

### Setup PostgreSQL

First, install and run Postgres on your machine. Create a database called `stacks_core_sidecar`. You may wish to change some connection options in the `.env` file to suit your needs.

Then, run migrations with `npm run migrate up`.

### Running the server

Install dependencies with `npm install`. Generate API types with `npm run generate:types`.

Locally, clone and build [`@blockstack/stacks-transactions`](https://github.com/blockstack/stacks-transactions-js). In that repo, run `npm link`. In this repo, run `npm link @blockstack/stacks-transactions`.

To run the server in 'watch' mode (restart for every code change), run `npm run dev:watch`. You'll have a server on port 3999.
