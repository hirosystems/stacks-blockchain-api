# Stacks Blockchain API

[![CI](https://github.com/hirosystems/stacks-blockchain-api/actions/workflows/ci.yml/badge.svg)](https://github.com/hirosystems/stacks-blockchain-api/actions/workflows/ci.yml)
[![GitHub Releases](https://img.shields.io/github/v/release/hirosystems/stacks-blockchain-api?display_name=release)](https://github.com/hirosystems/stacks-blockchain-api/releases/latest)
[![Docker Pulls](https://img.shields.io/docker/pulls/hirosystems/stacks-blockchain-api)](https://hub.docker.com/r/hirosystems/stacks-blockchain-api/)
[![NPM client package](https://img.shields.io/badge/npm-%40stacks%2Fblockchain--api--client-blue)](https://www.npmjs.org/package/@stacks/blockchain-api-client)

A Fastify-based REST API with real-time WebSocket and Socket.IO support for the [Stacks blockchain](https://www.stacks.co/). It indexes on-chain data from a [Stacks node](https://github.com/stacks-network/stacks-core) into PostgreSQL and exposes it through a rich set of RESTful endpoints, a full OpenAPI specification, and real-time event streams.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Run Modes](#run-modes)
- [Configuration](#configuration)
- [Development](#development)
- [Event Replay](#event-replay)
- [Deployment](#deployment)
- [Bugs and Feature Requests](#bugs-and-feature-requests)
- [Contributing](#contributing)
- [Community](#community)

## Features

- **Comprehensive REST API** — versioned endpoints covering blocks, transactions, principals, smart contracts, fungible and non-fungible tokens, staking / PoX, and burn chain data (see [API Reference](#api-reference)).
- **Real-time streaming** — subscribe to blocks, mempool transactions, address activity, STX balance changes, and NFT events via WebSocket (JSON-RPC) or Socket.IO
- **Client library** — type-safe TypeScript/JS client for REST and real-time APIs ([`@stacks/blockchain-api-client`](client/README.md))
- **OpenAPI specification** — auto-generated from route definitions; powers Redoc documentation, Postman collections, and the TypeScript client
- **Stacks node RPC proxy** — transparently proxies requests to the underlying Stacks node's `/v2/*` endpoints, with optional fee estimation
- **Multiple run modes** — default (read-write), read-only, and write-only modes for flexible scaling
- **Prometheus metrics** — built-in `/metrics` endpoint for monitoring
- **SNP integration** — Stacks Nakamoto Protocol event streaming via Redis
- **Faucets** — STX, BTC and sBTC testnet/regtest faucet endpoints for development

## Quick Start

### Local Development with Clarinet

The easiest way to run the API locally is with [Clarinet](https://github.com/hirosystems/clarinet), which spins up a full devnet environment (Bitcoin node, Stacks node, API, and PostgreSQL):

```shell
clarinet devnet start
```

See the [Clarinet documentation](https://docs.hiro.so/clarinet/getting-started) to get started.

### Production

Use the official Docker image for mainnet or testnet:

```shell
docker pull hirosystems/stacks-blockchain-api
```

The API cannot run standalone — it requires a running Stacks node and a PostgreSQL database. See [Deployment](#deployment) for details, or refer to the [Stacks node operator guide](https://docs.stacks.co/operate).

## API Reference

The full endpoint reference, with request and response schemas for every route, is published at [docs.hiro.so/en/apis/stacks-blockchain-api](https://docs.hiro.so/en/apis/stacks-blockchain-api). It is generated from the OpenAPI specification in this repository ([`openapi.yaml`](openapi.yaml)), which is itself generated from the Fastify route definitions at release time.


## Run Modes

The API supports three run modes, controlled by the `STACKS_API_MODE` environment variable:

### Default (read-write)

Runs the event server (ingests data from a Stacks node) and the API server. This is the standard mode for a single-instance deployment.

```shell
# STACKS_API_MODE is unset or set to any value other than readonly/writeonly
```

### Read-only

Runs only the API server. Reads data from PostgreSQL but does not ingest events. Requires a separate write-only instance populating the same database.

Useful for horizontally scaling API instances behind a load balancer. Read-only instances fully support WebSocket and Socket.IO subscriptions.

```shell
STACKS_API_MODE=readonly
```

### Write-only

Runs only the event server. Ingests Stacks node events into PostgreSQL but does not serve any API endpoints.

Useful when consuming blockchain data directly from the database without the overhead of an HTTP server.

```shell
STACKS_API_MODE=writeonly
```

## Configuration

Configuration is done via environment variables. A `.env` file in the project root is loaded automatically via [dotenv-flow](https://github.com/kerimdzhanov/dotenv-flow).

### Required

| Variable | Description |
|----------|-------------|
| `STACKS_CHAIN_ID` | Chain ID — `0x00000001` (mainnet) or `0x80000000` (testnet) |
| `STACKS_BLOCKCHAIN_API_HOST` | API server bind host |
| `STACKS_BLOCKCHAIN_API_PORT` | API server port (typically `3999`) |
| `STACKS_CORE_RPC_HOST` | Stacks node RPC host |
| `STACKS_CORE_RPC_PORT` | Stacks node RPC port |

### PostgreSQL

| Variable | Description | Default |
|----------|-------------|---------|
| `PG_CONNECTION_URI` | Full connection URI (overrides individual vars) | — |
| `PG_HOST` | Database host | — |
| `PG_PORT` | Database port | `5490` |
| `PG_USER` | Database user | — |
| `PG_PASSWORD` | Database password | — |
| `PG_DATABASE` | Database name | — |
| `PG_SCHEMA` | Database schema | — |
| `PG_SSL` | Enable SSL | `false` |
| `PG_CONNECTION_POOL_MAX` | Max pool size | `10` |
| `PG_IDLE_TIMEOUT` | Idle timeout (seconds) | `30` |
| `PG_MAX_LIFETIME` | Max connection lifetime (seconds) | `60` |

A `PG_PRIMARY_*` prefix is available for all PostgreSQL variables to configure a separate primary connection used for `LISTEN/NOTIFY`.

### Event Server

| Variable | Description | Default |
|----------|-------------|---------|
| `STACKS_CORE_EVENT_HOST` | Event server bind host | `127.0.0.1` |
| `STACKS_CORE_EVENT_PORT` | Event server port | `3700` |
| `STACKS_CORE_EVENT_BODY_LIMIT` | Max event body size (bytes) | `500000000` |

### RPC Proxy

| Variable | Description | Default |
|----------|-------------|---------|
| `STACKS_CORE_PROXY_HOST` | Proxy host (falls back to RPC host) | — |
| `STACKS_CORE_PROXY_PORT` | Proxy port (falls back to RPC port) | — |
| `STACKS_CORE_PROXY_BODY_LIMIT` | Proxy body limit (bytes) | `10000000` |
| `STACKS_CORE_FEE_ESTIMATOR_ENABLED` | Enable fee estimator proxy | `false` |

### Redis (optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_NOTIFIER_ENABLED` | Enable Redis-based index notifier | `false` |
| `REDIS_URL` | Redis URL | — |
| `SNP_EVENT_STREAMING` | Enable SNP Redis streaming | `false` |
| `SNP_REDIS_URL` | SNP Redis URL | — |

### Other

| Variable | Description | Default |
|----------|-------------|---------|
| `STACKS_API_MODE` | Run mode (`readonly`, `writeonly`, or default) | — |
| `STACKS_API_LOG_LEVEL` | Log level | — |
| `STACKS_PROFILER_PORT` | Enable profiler on this port | — |
| `IBD_MODE_UNTIL_BLOCK` | Initial block download mode until block height | — |
| `ENABLE_DEPRECATED_ENDPOINTS` | Serve deprecated `v1`/`v2` routes; `false` makes them respond `410 Gone` | `true` |
| `STACKS_SHUTDOWN_FORCE_KILL_TIMEOUT` | Graceful shutdown timeout (seconds) | `60` |

## Development

### Prerequisites

- Node.js >= 24
- Docker (for service dependencies)

### Setup

```shell
git clone https://github.com/hirosystems/stacks-blockchain-api.git
cd stacks-blockchain-api
npm install
```

### Running Locally

Build and start the API against a running PostgreSQL and Stacks node configured through the environment variables in [Configuration](#configuration):

```shell
npm run build
npm start
```

Alternatively, use the VS Code `start: api` or `start: mocknet` debug configurations.

Verify the server is running:

```
http://localhost:3999/extended
```

### Building

```shell
npm run build        # Compile TypeScript
npm run build:client # Generate the OpenAPI spec and client types
```

### Testing

Tests are split into suites, one npm script per suite (see `package.json`):

```shell
npm run test:api:transactions   # e.g. transactions suite; also blocks, principal-v3, pox5, ...
npm run test:api:event-replay   # Event replay tests
npm run test:snp                # SNP ingestion tests
```

Each suite spins up its own PostgreSQL via Docker (the `tests/api/setup.ts` global setup), so Docker must be running.

### Linting

```shell
npm run lint        # ESLint + Prettier
npm run lint:fix    # Auto-fix
```

### OpenAPI Spec Generation

The OpenAPI specification is generated directly from Fastify route definitions:

```shell
npm run generate:openapi    # Generate openapi.yaml (deprecated routes excluded)
npm run generate:client     # Generate TypeScript client types
```

The committed `openapi.yaml` and the client types are regenerated as part of the release process; do not regenerate them by hand in feature branches.

## Event Replay

When upgrading to a new major version with breaking database schema changes, the database must be rebuilt. Event replay allows re-ingesting historical events without a full chain re-sync.

### Using stacks-event-replay

The recommended approach is the [stacks-event-replay](https://github.com/hirosystems/stacks-event-replay) tool. Follow its [installation instructions](https://github.com/hirosystems/stacks-event-replay#installation).

### Manual Export / Import

1. Stop the API process (allow in-progress writes to finish).

2. Export events:
   ```shell
   node ./lib/index.js export-events --file /tmp/stacks-node-events.tsv
   ```

3. Update to the new API version.

4. Import events (this drops all existing tables):
   ```shell
   node ./lib/index.js import-events --file /tmp/stacks-node-events.tsv --wipe-db --force
   ```

   Import modes via `--mode`:
   - `archival` (default) — imports all events from genesis
   - `pruned` — skips mempool events until near chain tip, trading historical data for speed

## Deployment

### Requirements

- PostgreSQL 14 or newer
- A synced [Stacks node](https://github.com/stacks-network/stacks-core) configured to emit events to the API
- (Optional) Redis, for SNP streaming or index notifications in HA setups

### Docker

```shell
docker pull hirosystems/stacks-blockchain-api
```

The image runs `node ./lib/index.js` and expects the environment variables described in [Configuration](#configuration).

### Upgrading

Major version upgrades (e.g., `7.x` to `8.x`) may include breaking database schema changes. Use [Event Replay](#event-replay) to rebuild the database. Check the [release notes](https://github.com/hirosystems/stacks-blockchain-api/releases) for details on each release.

## Bugs and Feature Requests

1. **Search for existing issues** — check [existing and closed issues](../../issues) before opening a new one.
2. **Open a new issue** — use the appropriate [issue template](../../issues/new/choose) with as much detail as possible.
3. **Response SLA** — the team evaluates issues Monday through Friday and aims to respond within 7 business days.

For personal support or transaction status questions, use the [#support channel on Discord](https://discord.gg/SK3DxdsP).

## Contributing

Development happens in the open on GitHub. Read below to learn how to contribute.

Please read the [Code of Conduct](../../../.github/blob/main/CODE_OF_CONDUCT.md) before participating.

### Issues

Report bugs and request features via the [GitHub issue tracker](https://github.com/hirosystems/stacks-blockchain-api/issues/new). Include reproduction steps and as much context as possible.

## Community

- [Discord](https://discord.gg/ZQR6cyZC) — chat with other developers and the Hiro team
- [hiro.so](https://www.hiro.so/) — product updates and mailing list
- [Twitter / X](https://twitter.com/hirosystems) — follow Hiro for announcements

## License

GPL-3.0 — see [LICENSE](LICENSE) for details.
