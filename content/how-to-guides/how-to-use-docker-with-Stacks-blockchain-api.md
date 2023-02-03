---
Title: How-to use Docker with Stacks Blockchain API
---

# How-to use Docker with Stacks Blockchain API

A self-contained Docker image is provided, which will start a Stacks 2.05 blockchain and API instance.

# Installing Docker

To install Docker so you can use it with a Stacks Blockchain API:

1. Ensure Docker is installed, then run the command:

`docker run -p 3999:3999 hirosystems/stacks-blockchain-api-standalone`

2. Similarly, you can start a a "mocknet" instance, which will run a local node, isolated from the testnet/mainnet by running the following command:

`docker run -p 3999:3999 -e STACKS_NETWORK=mocknet hirosystems/stacks-blockchain-api-standalone`

3. Once the blockchain has synced with network, the API will be available at the following location: http://localhost:3999
