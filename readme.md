# @blockstack/stacks-blockchain-api

[![stacks-blockchain-api](https://github.com/blockstack/stacks-blockchain-api/actions/workflows/stacks-blockchain-api.yml/badge.svg?branch=master)](https://github.com/blockstack/stacks-blockchain-api/actions/workflows/stacks-blockchain-api.yml)

[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/blockstack/stacks-blockchain-api)

## Quick start

A self-contained Docker image is provided which starts a Stacks 2.0 blockchain and API instance.

Ensure Docker is installed, then run the command:

```shell
docker run -p 3999:3999 blockstack/stacks-blockchain-api-standalone
```

Similarly, a "mocknet" instance can be started. This runs a local node, isolated from the testnet/mainnet:

```shell
docker run -p 3999:3999 blockstack/stacks-blockchain-api-standalone mocknet
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

Then run `npm run devenv:deploy` which uses docker-compose to deploy the service dependencies (e.g. PostgreSQL, Stacks core node, etc).

### Running the server

To run the server in 'watch' mode (restart for every code change), run `npm run dev:watch`. You'll have a server on port 3999.

# Architecture

![API architecture!](api-architecture.png)

See [overview.md](overview.md) for architecture details.

# Deployment

### Offline mode

In Offline mode app runs without a stacks-node or postgres connection. In this mode, only the given rosetta endpoints are supported:
https://www.rosetta-api.org/docs/node_deployment.html#offline-mode-endpoints .

For running offline mode set an environment variable `STACKS_API_OFFLINE_MODE=1`

### Read-only mode

During Read-only mode, the API runs without an internal event server that listens to events from a stacks-node.
The API only reads data from the connected postgres database when building endpoint responses.
In order to keep serving updated blockchain data, this mode requires the presence of another API instance that keeps writing stacks-node events to the same database.

This mode is very useful when building an environment that load-balances incoming HTTP requests between multiple API instances that can be scaled up and down very quickly.
Read-only instances support websockets and socket.io clients.

For read-only mode, set the environment variable `STACKS_READ_ONLY_MODE=1`.

### Event Replay

The stacks-node is only able to emit events live as they happen. This poses a problem in the scenario where the stacks-blockchain-api needs to
be upgraded and its database cannot be migrated to a new schema. One way to handle this upgrade is to wipe the stacks-blockchain-api's database
and stacks-node working directory, and re-sync from scratch.

Alternatively, an event-replay feature is available where the API records the HTTP POST requests from the stacks-node event emitter, then streams
these events back to itself. Essentially simulating a wipe & full re-sync, but much quicker -- typically around 10 minutes.

The feature can be used via program args. For example, if there are breaking changes in the API's sql schema, like adding a new column which requires
event's to be re-played, the following steps could be ran:

1. Export event data to disk with the `export-events` command:

   ```shell
   node ./lib/index.js export-events --file /tmp/stacks-node-events.tsv
   ```
2. Update to the new stacks-blockchain-api version.
3. Perform the event playback using the `import-events` command:

   ```shell
   node ./lib/index.js import-events --file /tmp/stacks-node-events.tsv
   ```

Alternatively, instead of performing the `export-events` command in step 1, an environmental variable can be set which enables events to be streamed to a file
as they are received, while the application is running normally. To enable this feature, set the `STACKS_EXPORT_EVENTS_FILE` env var to the file path where
events should be appended. Example:
```
STACKS_EXPORT_EVENTS_FILE=/tmp/stacks-node-events.tsv
```
