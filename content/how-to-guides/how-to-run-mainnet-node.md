---
title: How to Run a Mainnet Node
---

This guide shows you how to run a local mainnet node using Docker images.

:::note

This guide focuses on Unix-like operating systems (Linux and MacOS). This has not been tested on
Windows.

:::

## Prerequisites

Running a node has no specialized hardware requirements. Users have been successful in running nodes on Raspberry Pi
boards and other system-on-chip architectures. However, in order to complete this guide, you do need the following software
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

- `8332`
- `8333`
- `20443-20444`

These egress ports are for syncing the `stacks-blockchain` and Bitcoin headers. If they're not open, the sync will fail.

## Step 1: Initial setup

In order to run the mainnet node, you must download the Docker images and create a directory structure to hold the
persistent data from the services. Download and configure the Docker images with the following commands:

```sh
docker pull blockstack/stacks-blockchain
```

Create a directory structure for the service data with the following command:

```sh
mkdir -p ./stacks-node/{persistent-data/stacks-blockchain/mainnet,config/mainnet} && cd stacks-node
```

## Step 2: Running Stacks blockchain

First, create the `./config/Config.toml` file and add the following content to the
file using a text editor:

```toml
[node]
working_dir = "/root/stacks-node/data"
rpc_bind = "0.0.0.0:20443"
p2p_bind = "0.0.0.0:20444"
bootstrap_node = "02196f005965cebe6ddc3901b7b1cc1aa7a88f305bb8c5893456b8f9a605923893@seed.mainnet.hiro.so:20444"
wait_time_for_microblocks = 10000

[burnchain]
chain = "bitcoin"
mode = "mainnet"
peer_host = "bitcoin.blockstack.com"
username = "blockstack"
password = "blockstacksystem"
rpc_port = 8332
peer_port = 8333

[connection_options]
read_only_call_limit_write_length = 0
read_only_call_limit_read_length = 100000
read_only_call_limit_write_count = 0
read_only_call_limit_read_count = 30
read_only_call_limit_runtime = 1000000000
```

Start the `stacks-blockchain` container with the following command:

```sh
docker run -d --rm \
  --name stacks-blockchain \
  -v $(pwd)/persistent-data/stacks-blockchain/mainnet:/root/stacks-node/data \
  -v $(pwd)/config/mainnet:/src/stacks-node \
  -p 20443:20443 \
  -p 20444:20444 \
  blockstack/stacks-blockchain \
/bin/stacks-node start --config /src/stacks-node/Config.toml
```

You can verify the running `stacks-blockchain` container with the command:

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
INFO [1626290705.886954] [src/burnchains/bitcoin/spv.rs:926] [main] Syncing Bitcoin headers: 1.2% (8000 out of 691034)
INFO [1626290748.103291] [src/burnchains/bitcoin/spv.rs:926] [main] Syncing Bitcoin headers: 1.4% (10000 out of 691034)
INFO [1626290776.956535] [src/burnchains/bitcoin/spv.rs:926] [main] Syncing Bitcoin headers: 1.7% (12000 out of 691034)
```

To verify that the `stacks-blockchain` tip height is progressing, use the following command:

```sh
curl -sL localhost:20443/v2/info | jq
```

If the instance is running, you should receive terminal output similar to the following:

```json
{
  "peer_version": 402653184,
  "pox_consensus": "89d752034e73ed10d3b97e6bcf3cff53367b4166",
  "burn_block_height": 666143,
  "stable_pox_consensus": "707f26d9d0d1b4c62881a093c99f9232bc74e744",
  "stable_burn_block_height": 666136,
  "server_version": "stacks-node 2.0.11.1.0-rc1 (master:67dccdf, release build, linux [x86_64])",
  "network_id": 1,
  "parent_network_id": 3652501241,
  "stacks_tip_height": 61,
  "stacks_tip": "e08b2fe3dce36fd6d015c2a839c8eb0885cbe29119c1e2a581f75bc5814bce6f",
  "stacks_tip_consensus_hash": "ad9f4cb6155a5b4f5dcb719d0f6bee043038bc63",
  "genesis_chainstate_hash": "74237aa39aa50a83de11a4f53e9d3bb7d43461d1de9873f402e5453ae60bc59b",
  "unanchored_tip": "74d172df8f8934b468c5b0af2efdefe938e9848772d69bcaeffcfe1d6c6ef041",
  "unanchored_seq": 0,
  "exit_at_block_height": null
}
```

## Stopping the mainnet node

Use the following commands to stop the local mainnet node:

```sh
docker stop stacks-blockchain
```

## Additional reading

- [Running an API instance with Docker][]

[running a testnet node with docker]: /get-started/running-testnet-node
[running an api instance with docker]: /get-started/running-api-node
[`stacks-blockchain`]: https://github.com/blockstack/stacks-blockchain
