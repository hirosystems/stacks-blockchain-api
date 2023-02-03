---
Title: Run a Stacks Blockchain API instance with Docker
---

# Run a Stacks Blockchain API instance with Docker

On this page, you will learn how to run a [stacks-blockchain-api](https://github.com/hirosystems/stacks-blockchain-api) instance. There are several components involved here to have a working setup, and descriptions will be given for each of these components.  

This page will also focus on the **easy** path to get the services running, which is currently Docker.  

Please note that the following guide is meant for a Unix-like OS (Linux/MacOS). The commands *may* work on Windows but will likely need some adjustments.

- [Run a Stacks Blockchain API instance with Docker](#run-a-stacks-blockchain-api-instance-with-docker)
  - [Requirements](#requirements)
    - [Firewalling](#firewalling)
    - [Initial Setup](#initial-setup)
  - [Postgres](#postgres)
    - [Starting postgres](#starting-postgres)
    - [Stopping Postgres](#stopping-postgres)
  - [Stacks Blockchain API](#stacks-blockchain-api)
    - [Starting stacks-blockchain-api](#starting-stacks-blockchain-api)
    - [Stopping stacks-blockchain-api](#stopping-stacks-blockchain-api)
  - [Stacks Blockchain](#stacks-blockchain)
    - [Starting stacks-blockchain](#starting-stacks-blockchain)
    - [Stopping stacks-blockchain](#stopping-stacks-blockchain)
  - [Verify Everything is running correctly](#verify-everything-is-running-correctly)
    - [Postgres testing](#postgres-testing)
    - [stacks-blockchain testing](#stacks-blockchain-testing)
    - [stacks-blockchain-api testing](#stacks-blockchain-api-testing)

## Requirements

1. [Docker](https://docs.docker.com/engine/install/)
2. `bash` or some other Unix-like shell (i.e. `zsh`)
3. `curl` binary

**Note:** The order of operations here is important.

Essentially, to start the API successfully you will want to perform the following steps **in order**:

1. [start postgres](#starting-postgres)
2. [start stacks-blockchain-api](#starting-stacks-blockchain-api)
3. [start stacks-blockchain](#starting-stacks-blockchain)

Conversely, to bring down the API and *NOT* lose any data, perform the same steps **in Reverse**:

1. [stop stacks-blockchain](#stopping-stacks-blockchain)
2. [stop stacks-blockchain-api](#stopping-stacks-blockchain-api)
3. [stop postgres](#stopping-postgres)

### Firewalling

In order for the services to work correctly, the host will need some ports open.

**Default Ingress Ports**:

- postgres (*open to `localhost` only*):
  - `5432 TCP`
- stacks-blockchain (*open to `0.0.0.0/0`*):
  - `20443 TCP`
  - `20444 TCP`
- stacks-blockchain-api (*open to where you want to access the api from*):
  - `3999 TCP`

**Default Egress Ports**:

The only egress ports you will need (outside of what you need normally to install/update packages) are:

- `8332`
- `8333`
- `20443-20444`

These are the ports used to sync the stacks-blockchain and the bitcoin headers. If they are not open, the sync **will** fail.

### Initial Setup

Since you will need to create some files/dirs for persistent data, you must first create a base directory structure and download the docker images.

You should use the following command:

```bash
$ mkdir -p ./stacks-node/{persistent-data/postgres,persistent-data/stacks-blockchain,config}
$ docker pull blockstack/stacks-blockchain-api \
    && docker pull blockstack/stacks-blockchain \
    && docker pull postgres:alpine
$ docker network create stacks-blockchain > /dev/null 2>&1
$ cd ./stacks-node
```

## Postgres

The `postgres:alpine` image can be run with default settings, the only requirement is that a password Environment 
Variable is set for the `postgres` user: `POSTGRES_PASSWORD=postgres`

### Starting postgres

```bash
docker run -d --rm \
    --name postgres \
    --net=stacks-blockchain \
    -e POSTGRES_PASSWORD=postgres \
    -v $(pwd)/persistent-data/postgres:/var/lib/postgresql/data \
    -p 5432:5432 \
    postgres:alpine
```

There should now be a running postgres instance running on port `5432`:

```bash
$ docker ps --filter name=postgres
CONTAINER ID   IMAGE             COMMAND                  CREATED          STATUS          PORTS                                       NAMES
f835f3a8cfd4   postgres:alpine   "docker-entrypoint.s…"   1 minute ago   Up 1 minute   0.0.0.0:5432->5432/tcp, :::5432->5432/tcp   postgres
```

### Stopping Postgres

To stop the postgres service (this will also remove the container, but not the data), run the following command:

```bash
$ docker stop postgres
```

## Stacks Blockchain API

The Stacks Blockchain API requires you to set several environment variables in order to run properly.  
To reduce complexity, create a `.env` file that you will use for these environment variables.

Create a new file: `./.env` with the following content:

```none
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
STACKS_CORE_RPC_HOST=stacks-blockchain
STACKS_CORE_RPC_PORT=20443
API_DOCS_URL=https://docs.hiro.so/api
```

The other environment variables to pay attention to are:

- `PG_HOST`: Set this to your **postgres** instance. In this guide, we'll be using a container named `postgres`.
- `STACKS_CORE_RPC_HOST`: Set this to your **stacks blockchain** node. In this guide, we'll be using a container named `stacks-blockchain`.
- `API_DOCS_URL`: Set this to enable your docs API http://localhost:3999/doc.

### Starting stacks-blockchain-api

Run the following command to run Stacks Blockchain API:

```bash
docker run -d --rm \
    --name stacks-blockchain-api \
    --net=stacks-blockchain \
    --env-file $(pwd)/.env \
    -p 3700:3700 \
    -p 3999:3999 \
    blockstack/stacks-blockchain-api
```

You shoudl now have a running stacks-blockchain-api instance running on ports `3999` and `3700`:

```bash
e$ docker ps --filter name=stacks-blockchain-api
CONTAINER ID   IMAGE                              COMMAND                  CREATED          STATUS          PORTS                                                                                  NAMES
a86a26da6c5a   blockstack/stacks-blockchain-api   "docker-entrypoint.s…"   1 minute ago   Up 1 minute   0.0.0.0:3700->3700/tcp, :::3700->3700/tcp, 0.0.0.0:3999->3999/tcp, :::3999->3999/tcp   stacks-blockchain-api
```

 > **_NOTE:_**
 >
 > On initial sync, it will take several minutes for port `3999` to become available.

### Stopping stacks-blockchain-api

To stop the stacks-blockchain-api service (this will also remove the container), run the following command:

```bash
$ docker stop stacks-blockchain-api
```

## Stacks Blockchain

In order to have a **usable** API instance, you need to have data from a running [stacks-blockchain](https://github.com/blockstack/stacks-blockchain) instance.  

Because the focus is on running the API with Docker, it also makes things easier if you also run the stacks-blockchain instance the same way.  

With that in mind, you will need to have the following configuration in your `Config.toml`. This configuration block will send blockchain events to the API instance that was previously started:

```toml
[[events_observer]]
endpoint = "<fqdn>:3700"
retry_count = 255
events_keys = ["*"]
```

Here is an example `Config.toml` that you can use - create this file as `./config/mainnet/Config.toml`:

```toml
[node]
working_dir = "/root/stacks-node/data"
rpc_bind = "0.0.0.0:20443"
p2p_bind = "0.0.0.0:20444"
bootstrap_node = "02da7a464ac770ae8337a343670778b93410f2f3fef6bea98dd1c3e9224459d36b@seed-0.mainnet.stacks.co:20444,02afeae522aab5f8c99a00ddf75fbcb4a641e052dd48836408d9cf437344b63516@seed-1.mainnet.stacks.co:20444,03652212ea76be0ed4cd83a25c06e57819993029a7b9999f7d63c36340b34a4e62@seed-2.mainnet.stacks.co:20444"
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

### Starting stacks-blockchain

```bash
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

You should now see a running stacks-blockchain instance running on ports `20443-20444`:

```bash
$ docker ps --filter name=stacks-blockchain$
CONTAINER ID   IMAGE                          COMMAND                  CREATED          STATUS          PORTS                                                                   NAMES
199e37a324f1   blockstack/stacks-blockchain   "/bin/stacks-node st…"   1 minute ago   Up 1 minute   0.0.0.0:20443-20444->20443-20444/tcp, :::20443-20444->20443-20444/tcp   stacks-blockchain
```

### Stopping stacks-blockchain

To stop the stacks-blockchain service (this will also remove the container, but not the data), run the following command:

```bash
$ docker stop stacks-blockchain
```

## Verify Everything is running correctly

### Postgres testing

To verfiy the database is ready:

1. Connect to the DB instance:  `psql -h localhost -U postgres`
    - *this will require a locally installed postgresql client*
    - use the password from the [Environment Variable](#postgres) `POSTGRES_PASSWORD`
2. List current databases: `\l`
3. Disconnect from the DB : `\q`

### stacks-blockchain testing

Verify the stacks-blockchain tip height is progressing:

```bash
$ curl -sL localhost:20443/v2/info | jq
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

### stacks-blockchain-api testing

Verify the stacks-blockchain-api is receiving data from the stacks-blockchain:

```bash
$ curl -sL localhost:3999/v2/info | jq
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

Now that everything is running, you can [try some of these other API endpoints](https://hirosystems.github.io/stacks-blockchain-api/)
