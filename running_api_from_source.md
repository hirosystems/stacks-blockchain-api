# Running a stacks-blockchain API instance from source

In this document, we'll go over how to run a [stacks-blockchain-api](https://github.com/hirosystems/stacks-blockchain-api) instance.  
There are several components involved here to have a working setup, and we'll go over each.  
Please note that the following guide is targeted for Debian based systems - that in mind, most of the commands will work on other Unix systems with some small adjustments.

- [Running a stacks-blockchain API instance from source](#running-a-stacks-blockchain-api-instance-from-source)
  - [Requirements](#requirements)
    - [Initial Setup](#initial-setup)
  - [Install Requirements](#install-requirements)
  - [postgres](#postgres)
    - [postgres permissions](#postgres-permissions)
    - [stopping postgres](#stopping-postgres)
  - [stacks-blockchain-api](#stacks-blockchain-api)
    - [building stacks-blockchain-api](#building-stacks-blockchain-api)
    - [starting stacks-blockchain-api](#starting-stacks-blockchain-api)
    - [stopping stacks-blockchain-api](#stopping-stacks-blockchain-api)
  - [stacks-blockchain](#stacks-blockchain)
    - [stacks-blockchain binaries](#stacks-blockchain-binaries)
    - [starting stacks-blockchain](#starting-stacks-blockchain)
    - [stopping stacks-blockchain](#stopping-stacks-blockchain)
  - [Verify Everything is running correctly](#verify-everything-is-running-correctly)
    - [Postgres](#postgres-1)
    - [stacks-blockchain testing](#stacks-blockchain-testing)
    - [stacks-blockchain-api testing](#stacks-blockchain-api-testing)

## Requirements

1. `bash` or some other Unix-like shell (i.e. `zsh`)
2. `sudo` or root level access to the system

### Initial Setup

Since we'll need to create some files/dirs for persistent data,  
we'll first create a base directory structure and set some permissions:

```bash
$ sudo mkdir -p /stacks-node/{persistent-data/stacks-blockchain,config,binaries}
$ sudo chown -R $(whoami) /stacks-node 
$ cd /stacks-node
```

## Install Requirements

```bash
$ PG_VERSION=14 \
  && NODE_VERSION=16 \
  && sudo apt-get update \
  && sudo apt-get install -y \
    gnupg2 \
    git \
    lsb-release \
    curl \
    jq \
    openjdk-11-jre-headless \
    build-essential \
    zip \
  && curl -sL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add - \
  && echo "deb http://apt.postgresql.org/pub/repos/apt/ `lsb_release -cs`-pgdg main" | sudo tee -a /etc/apt/sources.list.d/pgsql.list \
  && curl -sL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo bash - \
  && sudo apt-get update \
  && sudo apt-get install -y \
    postgresql-${PG_VERSION} \
    postgresql-client-${PG_VERSION} \
    nodejs
```

## postgres

### postgres permissions

We'll need to set a basic role, database to store data, and a password for the role.  
Clearly, this password is **insecure** so modify `password` to something stronger before creating the role.  

```bash
$ cat <<EOF> /tmp/file.sql
create role stacks login password 'password';
create database stacks_db;
grant all on database stacks_db to stacks;
EOF
$ sudo su - postgres -c "psql -f /tmp/file.sql" && rm -f /tmp/file.sql
$ echo "local   all             stacks                                  md5" | sudo tee -a /etc/postgresql/14/main/pg_hba.conf
$ sudo systemctl restart postgresql
```

### stopping postgres

```bash
$ sudo systemctl stop postgresql
```

## stacks-blockchain-api

### building stacks-blockchain-api

```bash
$ git clone https://github.com/hirosystems/stacks-blockchain-api /stacks-node/stacks-blockchain-api && cd /stacks-node/stacks-blockchain-api \
  && echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env \
  && npm install \
  && npm run build \
  && npm prune --production
```

### starting stacks-blockchain-api

The stacks blockchain api requires several Environment Variables to be set in order to run properly.  
To reduce complexity, we're going to create a `.env` file that we'll use for these env vars.  

Create a new file: `/stacks-node/stacks-blockchain-api/.env` with the following content:

```bash
$ cat <<EOF> /stacks-node/stacks-blockchain-api/.env
NODE_ENV=production
GIT_TAG=master
PG_HOST=localhost
PG_PORT=5432
PG_USER=stacks
PG_PASSWORD=password
PG_DATABASE=stacks_db
STACKS_CHAIN_ID=0x00000001
V2_POX_MIN_AMOUNT_USTX=90000000260
STACKS_CORE_EVENT_PORT=3700
STACKS_CORE_EVENT_HOST=0.0.0.0
STACKS_BLOCKCHAIN_API_PORT=3999
STACKS_BLOCKCHAIN_API_HOST=0.0.0.0
STACKS_CORE_RPC_HOST=localhost
STACKS_CORE_RPC_PORT=20443
EOF
$ cd /stacks-node/stacks-blockchain-api && nohup node ./lib/index.js &
```

### stopping stacks-blockchain-api

```bash
$ ps -ef | grep "lib/index.js" | grep -v grep
user   17788   827 39 18:14 pts/0    00:07:55 node ./lib/index.js
$ sudo kill $(ps -ef | grep "lib/index.js" | grep -v grep | awk {'print $2'})
```

## stacks-blockchain

In order to have a **usable** API instance, it needs to have data from a running [stacks-blockchain](https://github.com/blockstack/stacks-blockchain) instance.

You will need to have the following in your `Config.toml` - this config block will send blockchain events to the API instance that was previously started:

```toml
[[events_observer]]
endpoint = "<fqdn>:3700"
retry_count = 255
events_keys = ["*"]
```

Here is an example `Config.toml` that you can use - create this file as `/stacks-node/config/Config.toml`:
```bash
$ cat <<EOF> /stacks-node/config/Config.toml
[node]
working_dir = "/stacks-node/persistent-data/stacks-blockchain"
rpc_bind = "0.0.0.0:20443"
p2p_bind = "0.0.0.0:20444"
bootstrap_node = "02196f005965cebe6ddc3901b7b1cc1aa7a88f305bb8c5893456b8f9a605923893@seed.mainnet.hiro.so:20444"
wait_time_for_microblocks = 10000

[[events_observer]]
endpoint = "localhost:3700"
retry_count = 255
events_keys = ["*"]

[burnchain]
chain = "bitcoin"
mode = "mainnet"
peer_host = "bitcoind.stacks.co"
username = "blockstack"
password = "blockstacksystem"
rpc_port = 8332
peer_port = 8333
EOF
```

### stacks-blockchain binaries

1. Download latest release binary from https://github.com/blockstack/stacks-blockchain/releases/latest
  - Linux archive for [latest release](https://github.com/blockstack/stacks-blockchain/releases/latest): `curl -L https://github.com/blockstack/stacks-blockchain/releases/download/$(curl --silent https://api.github.com/repos/blockstack/stacks-blockchain/releases/latest | jq .name -r | cut -f2 -d " ")/linux-x64.zip -o /tmp/linux-x64.zip`
2. Extract the zip archive: `unzip /tmp/linux-x64.zip -d /stacks-node/binaries/`

### starting stacks-blockchain

```bash
$ cd /stacks-node && nohup /stacks-node/binaries/stacks-node start --config /stacks-node/config/Config.toml &
```

### stopping stacks-blockchain

```bash
$ ps -ef | grep "/stacks-node/binaries/stacks-node" | grep -v grep
user   17835 17834 99 18:17 pts/0    00:20:23 /stacks-node/binaries/stacks-node start --config /stacks-node/config/Config.toml
$ sudo kill $(ps -ef | grep "/stacks-node/binaries/stacks-node" | grep -v grep | awk {'print $2'})
```

## Verify Everything is running correctly

### Postgres

To verify the database is ready:

1. Connect to the DB instance: `psql -h localhost -U stacks stacks_db`
   - use the password from the [Postgres Permissions Step](#postgres-permissions)
2. List current databases: `\l`
3. Verify data is being written to the database: `select * from blocks limit 1;`
4. Disconnect from the DB : `\q`

### stacks-blockchain testing

```bash
$ curl localhost:20443/v2/info | jq
{
  "peer_version": 402653184,
  "pox_consensus": "e99b880a26405d3cda724f4c2b815ca0e7b681a8",
  "burn_block_height": 666201,
  "stable_pox_consensus": "8be2fc9f9156b31af688b9e3c484dc7a26cefc4f",
  "stable_burn_block_height": 666194,
  "server_version": "stacks-node 2.0.11.0.0 (master:bf4a577+, release build, linux [x86_64])",
  "network_id": 1,
  "parent_network_id": 3652501241,
  "stacks_tip_height": 92,
  "stacks_tip": "a251bfa158c7887c575798b79c8df57190690e023af245e45513110399c0cb5f",
  "stacks_tip_consensus_hash": "ae29e81af9e7febfd4af6b53a3e515660a84150c",
  "genesis_chainstate_hash": "74237aa39aa50a83de11a4f53e9d3bb7d43461d1de9873f402e5453ae60bc59b",
  "unanchored_tip": "9fb08dd696d4e05bd042998dba8dd204ee64e11266cd4fba95b3a7bdaa709400",
  "unanchored_seq": 0,
  "exit_at_block_height": null
}
```

### stacks-blockchain-api testing

```bash
$ curl localhost:3999/v2/info | jq
{
  "peer_version": 402653184,
  "pox_consensus": "e99b880a26405d3cda724f4c2b815ca0e7b681a8",
  "burn_block_height": 666201,
  "stable_pox_consensus": "8be2fc9f9156b31af688b9e3c484dc7a26cefc4f",
  "stable_burn_block_height": 666194,
  "server_version": "stacks-node 2.0.11.0.0 (master:bf4a577+, release build, linux [x86_64])",
  "network_id": 1,
  "parent_network_id": 3652501241,
  "stacks_tip_height": 93,
  "stacks_tip": "74223951b9dddfe82b1b116c852f0a14ff9432270d680042a5ef11cb0533b935",
  "stacks_tip_consensus_hash": "2d521daf879f2e00f745c47000b856e1d41b15d4",
  "genesis_chainstate_hash": "74237aa39aa50a83de11a4f53e9d3bb7d43461d1de9873f402e5453ae60bc59b",
  "unanchored_tip": "9fb08dd696d4e05bd042998dba8dd204ee64e11266cd4fba95b3a7bdaa709400",
  "unanchored_seq": 0,
  "exit_at_block_height": null
}
```
