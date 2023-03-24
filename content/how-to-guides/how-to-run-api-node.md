---
title: How to run API node
---

This procedure demonstrates how to run a local API node using Docker images. There are several components that must be
configured and run in a specific order for the local API node to work.

For this procedure, the order in which the services are brought up is very important. In order to start the API node
successfully, you need to bring up the services in the following order:

1. `postgres`
2. `stacks-blockchain-api`
3. `stacks-blockchain`

When bringing down the API node, you should bring the services down in the exact reverse order in which they were
brought up, to avoid losing data.

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
- [psql](http://postgresguide.com/utilities/psql.html) (_installed locally_)
- [jq](https://stedolan.github.io/jq/download/)

### Firewall configuration

In order for the API node services to work correctly, you must configure any network firewall rules to allow traffic on
the ports discussed in this section. The details of network and firewall configuration are highly specific to your
machine and network, so a detailed example isn't provided.

The following ports must open on the host machine:

Ingress:

- postgres (open to `localhost` only):
  - `5432 TCP`
- stacks-blockchain-api
  - `3999 TCP`
- stacks-blockchain (open to `0.0.0.0/0`):
  - `20443 TCP`
  - `20444 TCP`

Egress:

- `8332`
- `8333`
- `20443-20444`

These egress ports are for syncing the `stacks-blockchain` and Bitcoin headers. If they're not open, the sync will fail.

## Step 1: Initial setup

In order to run the API node, you must download the Docker images and create a directory structure to hold the
persistent data from the services. Download and configure the Docker images with the following commands:

```sh
docker pull blockstack/stacks-blockchain-api && docker pull blockstack/stacks-blockchain && docker pull postgres:alpine
docker network create stacks-blockchain > /dev/null 2>&1
```

Create a directory structure for the service data with the following command:

```sh
mkdir -p ./stacks-node/{persistent-data/postgres,persistent-data/stacks-blockchain,bns,config} && cd stacks-node
```

## Step 2: Running Postgres

The `postgres:alpine` Docker container can be run with default settings. You must set the password for the user to
`postgres` with the `POSTGRES_PASSWORD` environment variable. The following command starts the image:

```sh
docker run -d --rm \
  --name postgres \
  --net=stacks-blockchain \
  -e POSTGRES_PASSWORD=postgres \
  -v $(pwd)/persistent-data/postgres:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:alpine
```

You can verify the running Postgres instance on port `5432` with the command

```sh
docker ps --filter name=postgres
```

## Step 3: Running Stacks blockchain API

The [`stacks-blockchain-api`][] image requires several environment variables to be set. To reduce the complexity of the
run command, you should create a new `.env` file and add the following to it using a text editor:

```
NODE_ENV=production
GIT_TAG=master
PG_HOST=postgres
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=postgres
PG_DATABASE=postgres
STACKS_CHAIN_ID=0x00000001
V2_POX_MIN_AMOUNT_USTX=90000000260
STACKS_CORE_EVENT_PORT=3700
STACKS_CORE_EVENT_HOST=0.0.0.0
STACKS_BLOCKCHAIN_API_PORT=3999
STACKS_BLOCKCHAIN_API_HOST=0.0.0.0
STACKS_BLOCKCHAIN_API_DB=pg
STACKS_CORE_RPC_HOST=stacks-blockchain
STACKS_CORE_RPC_PORT=20443
BNS_IMPORT_DIR=/bns-data
```

:::info

This guide configures the API to import BNS data with the `BNS_IMPORT_DIR` variable. To turn off this import, comment
the line out by placing a `#` at the beginning of the line. If you leave the BNS import enabled, it may take several
minutes for the container to start while it imports the data.

:::

The `PG_HOST` and `STACKS_CORE_RPC_HOST` variables define the container names for `postgres` and `stacks-blockchain`.
You may wish to alter those values if you have named those containers differently than this guide.

Start the [`stacks-blockchain-api`][] image with the following command:

```sh
docker run -d --rm \
  --name stacks-blockchain-api \
  --net=stacks-blockchain \
  --env-file $(pwd)/.env \
  -v $(pwd)/bns:/bns-data \
  -p 3700:3700 \
  -p 3999:3999 \
  blockstack/stacks-blockchain-api
```

You can verify the running `stacks-blockchain-api` container with the command:

```sh
docker ps --filter name=stacks-blockchain-api
```

## Step 4: Running Stacks blockchain

A usable API instance needs to have data from a running [stacks-blockchain](https://github.com/stacks-network/stacks-blockchain) instance.

Because we're focusing on running the API with Docker, it also makes things easier if we run the stacks-blockchain-api instance similarly.

With that in mind, you will need to have the following in your Config.toml - this config block will send blockchain events to the API instance that was started earlier:

```toml
[[events_observer]]
endpoint = "<fqdn>:3700"
retry_count = 255
events_keys = ["*"]
```

Here is an example `Config.toml` that you can use. Create this file as ./config/Config.toml:

```toml
[node]
working_dir = "/root/stacks-node/data"
rpc_bind = "0.0.0.0:20443"
p2p_bind = "0.0.0.0:20444"
bootstrap_node = "02196f005965cebe6ddc3901b7b1cc1aa7a88f305bb8c5893456b8f9a605923893@seed.mainnet.hiro.so:20444"
wait_time_for_microblocks = 10000

[[events_observer]]
endpoint = "stacks-blockchain-api:3700"
retry_count = 255
events_keys = ["*"]

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

The `[[events_observer]]` block configures the instance to send blockchain events to the API container that you
started previously.

Start the `stacks-blockchain` container with the following command:

```sh
docker run -d --rm \
  --name stacks-blockchain \
  --net=stacks-blockchain \
  -v $(pwd)/persistent-data/stacks-blockchain:/root/stacks-node/data \
  -v $(pwd)/config:/src/stacks-node \
  -p 20443:20443 \
  -p 20444:20444 \
  blockstack/stacks-blockchain \
/bin/stacks-node start --config /src/stacks-node/Config.toml
```

You can verify the stacks-blockchain instance running on the ports 20443-20444:

```sh
$ docker ps --filter name=stacks-blockchain$
CONTAINER ID   IMAGE                          COMMAND                  CREATED          STATUS          PORTS                                                                   NAMES
199e37a324f1   blockstack/stacks-blockchain   "/bin/stacks-node st…"   1 minute ago   Up 1 minute   0.0.0.0:20443-20444->20443-20444/tcp, :::20443-20444->20443-20444/tcp   stacks-blockchain
```

## Step 5: Verifying the services

You can now verify that each of the services is running and talking to the others.

To verify the database is ready:

1. Connect to the Postgres instance with the command `psql -h localhost -U postgres`. Use the password from the
   `POSTGRES_PASSWORD` environment variable you set when running the container.
2. List current databases with the command `\l`
3. Disconnect from the database with the command `\q`

To verify the `stacks-blockchain` tip height is progressing use the following command:

```sh
curl -sL localhost:20443/v2/info | jq
```

If the instance is running you should receive terminal output similar to the following:

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

Verify the `stacks-blockchain-api` is receiving data from the `stacks-blockchain` with the following command:

```sh
curl -sL localhost:3999/v2/info | jq
```

If the instance is configured correctly, you should receive terminal output similar to the following:

```json
{
  "peer_version": 402653184,
  "pox_consensus": "e472cadc17dcf3bc1afafc6aa595899e55f25b72",
  "burn_block_height": 666144,
  "stable_pox_consensus": "6a6fb0aa75a8acd4919f56c9c4c81ce5bc42cac1",
  "stable_burn_block_height": 666137,
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

Once the API is running, you can use it to [interact with other API endpoints][`stacks-blockchain-api`].

## Stopping the API node

As discussed previously, if you want to bring down your API node, you must stop the services in the reverse order that
you started them. Performing the shutdown in this order ensures that you don't lose any data while shutting down
the node.

Use the following commands to stop the local API node:

```sh
docker stop stacks-blockchain
docker stop stacks-blockchain-api
docker stop postgres
```

## Additional reading

- [Running an API instance with Docker][] in the `stacks-blockchain-api` repository
- [Running an API instance from source][] in the `stacks-blockchain-api` repository

[running an api instance with docker]: https://github.com/hirosystems/stacks-blockchain-api/blob/master/running_an_api.md
[running an api instance from source]: https://github.com/hirosystems/stacks-blockchain-api/blob/master/running_api_from_source.md
[`stacks-blockchain`]: https://github.com/blockstack/stacks-blockchain
[`stacks-blockchain-api`]: https://github.com/hirosystems/stacks-blockchain-api
