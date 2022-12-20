---
title: How to run testnet node
---

This procedure demonstrates how to run a local testnet node using Docker images.

:::note

This procedure focuses on Unix-like operating systems (Linux and MacOS). This procedure has not been tested on
Windows.

:::

## Prerequisites

Running a node has no specialized hardware requirements. Users have been successful in running nodes on Raspberry Pi
boards and other system-on-chip architectures. In order to complete this procedure, you must have the following software
installed on the node host machine:

- [Docker](https://docs.docker.com/get-docker/)
- [curl](https://curl.se/download.html)
- [jq](https://stedolan.github.io/jq/download/)

### Firewall configuration

In order for the API node services to work correctly, you must configure any network firewall rules to allow traffic on
the ports discussed in this section. The details of network and firewall configuration are highly specific to your
machine and network, so a detailed example isn't provided.

The following ports must open on the host machine:

Ingress:

- stacks-blockchain (open to `0.0.0.0/0`):
  - `20443 TCP`
  - `20444 TCP`

Egress:

- `18332`
- `18333`
- `20443-20444`

These egress ports are for syncing `stacks-blockchain` and Bitcoin headers. If they're not open, the sync will fail.

## Step 1: Initial setup

In order to run the testnet node, you must download the Docker images and create a directory structure to hold the
persistent data from the services. Download and configure the Docker images with the following commands:

```sh
docker pull blockstack/stacks-blockchain
```

Create a directory structure for the service data with the following command:

```sh
mkdir -p ./stacks-node/persistent-data/stacks-blockchain/testnet && cd stacks-node
```

## Step 2: Running Stacks blockchain

Start the `stacks-blockchain` container with the following command:

```sh
docker run -d --rm \
  --name stacks-blockchain \
  -v $(pwd)/persistent-data/stacks-blockchain/testnet:/root/stacks-node/data \
  -p 20443:20443 \
  -p 20444:20444 \
  blockstack/stacks-blockchain \
/bin/stacks-node xenon
```

You can verify that the container `stacks-blockchain` is running with the command:

```sh
docker ps --filter name=stacks-blockchain
```

## Step 3: Verifying the services

:::info

The initial header sync can take several minutes, until this is done the following commands will not work.

:::

To verify the `stacks-blockchain` burn chain header sync progress:

```sh
docker logs stacks-blockchain
```

The output should be similar to the following:

```
INFO [1626290705.886954] [src/burnchains/bitcoin/spv.rs:926] [main] Syncing Bitcoin headers: 1.2% (8000 out of 2034380)
INFO [1626290748.103291] [src/burnchains/bitcoin/spv.rs:926] [main] Syncing Bitcoin headers: 1.4% (10000 out of 2034380)
INFO [1626290776.956535] [src/burnchains/bitcoin/spv.rs:926] [main] Syncing Bitcoin headers: 1.7% (12000 out of 2034380)
```

To verify the `stacks-blockchain` tip height is progressing use the following command:

```sh
curl -sL localhost:20443/v2/info | jq
```

If the instance is running you should receive terminal output similar to the following:

```json
{
  "peer_version": 4207599105,
  "pox_consensus": "12f7fa85e5099755a00b7eaecded1aa27af61748",
  "burn_block_height": 2034380,
  "stable_pox_consensus": "5cc4e0403ff6a1a4bd17dae9600c7c13d0b10bdf",
  "stable_burn_block_height": 2034373,
  "server_version": "stacks-node 2.0.11.2.0-rc1 (develop:7b6d3ee+, release build, linux [x86_64])",
  "network_id": 2147483648,
  "parent_network_id": 118034699,
  "stacks_tip_height": 509,
  "stacks_tip": "e0ee952e9891709d196080ca638ad07e6146d4c362e6afe4bb46f42d5fe584e8",
  "stacks_tip_consensus_hash": "12f7fa85e5099755a00b7eaecded1aa27af61748",
  "genesis_chainstate_hash": "74237aa39aa50a83de11a4f53e9d3bb7d43461d1de9873f402e5453ae60bc59b",
  "unanchored_tip": "32bc86590f11504f17904ee7f5cb05bcf71a68a35f0bb3bc2d31aca726090842",
  "unanchored_seq": 0,
  "exit_at_block_height": null
}
```

## Stopping the testnet node

Use the following command to stop the local testnet node:

```sh
docker stop stacks-blockchain
```

## Additional reading

- [Running an API instance with Docker][]

[running a mainnet node with docker]: /get-started/running-mainnet-node
[running an api instance with docker]: /get-started/running-api-node
[`stacks-blockchain`]: https://github.com/blockstack/stacks-blockchain
