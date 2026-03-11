# Stacks Blockchain API

[![CI](https://github.com/hirosystems/stacks-blockchain-api/actions/workflows/ci.yml/badge.svg)](https://github.com/hirosystems/stacks-blockchain-api/actions/workflows/ci.yml)
[![GitHub Releases](https://img.shields.io/github/v/release/hirosystems/stacks-blockchain-api?display_name=release)](https://github.com/hirosystems/stacks-blockchain-api/releases/latest)
[![Docker Pulls](https://img.shields.io/docker/pulls/hirosystems/stacks-blockchain-api)](https://hub.docker.com/r/hirosystems/stacks-blockchain-api/)
[![NPM client package](https://img.shields.io/badge/npm-%40stacks%2Fblockchain--api--client-blue)](https://www.npmjs.org/package/@stacks/blockchain-api-client)

A Fastify-based REST API with real-time WebSocket and Socket.IO support for the [Stacks blockchain](https://www.stacks.co/). It indexes on-chain data from a [Stacks node](https://github.com/stacks-network/stacks-core) into PostgreSQL and exposes it through a rich set of RESTful endpoints, a full OpenAPI specification, and real-time event streams.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [API Endpoints](#api-endpoints)
- [Run Modes](#run-modes)
- [Configuration](#configuration)
- [Development](#development)
- [Event Replay](#event-replay)
- [Deployment](#deployment)
- [Bugs and Feature Requests](#bugs-and-feature-requests)
- [Contributing](#contributing)
- [Community](#community)

## Features

- **Nakamoto support** — full support for Nakamoto blocks, tenures, signer signatures, and `NakamotoCoinbase` / `TenureChange` transaction types
- **Comprehensive REST API** — v1 and v2 endpoints covering blocks, transactions, accounts, smart contracts, NFTs, fungible tokens, BNS (Bitcoin Name System), PoX / stacking, burn chain rewards, and more
- **Real-time streaming** — subscribe to blocks, microblocks, mempool transactions, address activity, STX balance changes, and NFT events via WebSocket (JSON-RPC) or Socket.IO
- **Client library** — type-safe TypeScript/JS client for REST and real-time APIs ([`@stacks/blockchain-api-client`](client/README.md))
- **OpenAPI specification** — auto-generated from route definitions; powers Redoc documentation, Postman collections, and the TypeScript client
- **Stacks node RPC proxy** — transparently proxies requests to the underlying Stacks node's `/v2/*` endpoints, with optional fee estimation
- **Multiple run modes** — default (read-write), read-only, and write-only modes for flexible scaling
- **Prometheus metrics** — built-in `/metrics` endpoint for monitoring
- **SNP integration** — Stacks Nakamoto Protocol event streaming via Redis
- **BNS** — full Bitcoin Name System support including name lookups, namespaces, subdomains, zonefiles, and pricing
- **BTC & STX faucets** — testnet/regtest faucet endpoints for development

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

## API Endpoints

### Extended API v2

The recommended versioned endpoints:

| Group | Prefix | Key Endpoints |
|-------|--------|---------------|
| **Blocks** | `/extended/v2/blocks` | List blocks, get by height/hash, list transactions, signer signatures, average block times |
| **Burn Blocks** | `/extended/v2/burn-blocks` | List burn blocks, get by height/hash, list Stacks blocks per burn block, PoX transactions |
| **Block Tenures** | `/extended/v2/block-tenures` | List blocks for a given tenure height |
| **Addresses** | `/extended/v2/addresses` | Transactions for address, transaction events, STX balance, FT balances, PoX transactions by BTC address |
| **PoX** | `/extended/v2/pox` | PoX cycles, signers per cycle, stackers per signer |
| **Smart Contracts** | `/extended/v2/smart-contracts` | Contract deployment status |
| **Mempool** | `/extended/v2/mempool` | Mempool fee priorities |

### Extended API v1

| Group | Prefix | Key Endpoints |
|-------|--------|---------------|
| **Transactions** | `/extended/v1/tx` | Recent, by ID, raw, by block hash/height, mempool, mempool stats, events |
| **Blocks** | `/extended/v1/block` | List, by height, by hash, by burn block height/hash |
| **Microblocks** | `/extended/v1/microblock` | List, by hash, unanchored transactions |
| **Accounts** | `/extended/v1/address` | STX balance, all balances, transactions, assets, inbound transfers, nonces, mempool |
| **Tokens** | `/extended/v1/tokens` | NFT holdings, NFT history, NFT mints, FT holders |
| **Smart Contracts** | `/extended/v1/contract` | By trait, by ID, contract events |
| **Search** | `/extended/v1/search` | Universal search (blocks, transactions, contracts, addresses) |
| **PoX** | `/extended/v1/pox2`, `pox3`, `pox4` | PoX events, stacker info, delegations |
| **STX Supply** | `/extended/v1/stx_supply` | Total, circulating, legacy format |
| **Burn Chain** | `/extended/v1/burnchain` | Reward slot holders, rewards, total rewards |
| **Fee Rate** | `/extended/v1/fee_rate` | Fee rate estimation |
| **Info** | `/extended/v1/info` | Network block times |
| **Faucets** | `/extended/v1/faucets` | BTC and STX testnet faucets |

### BNS (Bitcoin Name System)

| Prefix | Endpoints |
|--------|-----------|
| `/v1/names` | List names, get name details, zonefiles, subdomains |
| `/v1/namespaces` | List namespaces, names in a namespace |
| `/v1/addresses` | Resolve blockchain address to names |
| `/v2/prices` | Namespace and name pricing |

### Stacks Node RPC Proxy

All requests to `/v2/*` (e.g. `/v2/info`, `/v2/fees/transaction`) are proxied to the connected Stacks core node.

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
| `PG_PORT` | Database port | `5432` |
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
| `BNS_IMPORT_DIR` | Directory with V1 BNS export data | — |
| `STACKS_SHUTDOWN_FORCE_KILL_TIMEOUT` | Graceful shutdown timeout (seconds) | `60` |

## Development

### Prerequisites

- Node.js >= 22
- Docker (for service dependencies)

### Setup

```shell
git clone https://github.com/hirosystems/stacks-blockchain-api.git
cd stacks-blockchain-api
npm install
```

### Running Locally

The quickest way to start with all dependencies (PostgreSQL, Stacks node, Bitcoin node):

```shell
npm run dev:integrated
```

This uses Docker Compose to start the service dependencies and runs the API in development mode.

Alternatively, use the VS Code "Launch: w/ postgres" debug configuration.

Verify the server is running:

```
http://localhost:3999/extended/v1/status
```

### Building

```shell
npm run build        # Compile TypeScript
npm run build:docs   # Generate OpenAPI spec and Redoc docs
npm run build:client # Generate client types from OpenAPI spec
```

### Testing

```shell
npm test                        # Run all tests
npm run test:api                # API endpoint tests
npm run test:bns                # BNS tests
npm run test:2.5                # PoX-4 / stacking tests
npm run test:event-replay       # Event replay tests
npm run test:snp                # SNP ingestion tests
```

Integration tests spin up their own PostgreSQL via Docker:

```shell
npm run test:integration
```

### Linting

```shell
npm run lint        # ESLint + Prettier
npm run lint:fix    # Auto-fix
```

### OpenAPI Spec Generation

The OpenAPI specification is generated directly from Fastify route definitions:

```shell
npm run generate:openapi    # Generate docs/openapi.yaml and docs/openapi.json
npm run generate:redoc      # Generate Redoc HTML documentation
npm run generate:postman    # Generate Postman collection
npm run generate:client     # Generate TypeScript client types
```

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
   - `pruned` — skips mempool and microblock events until near chain tip, trading historical data for speed

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

A standalone regtest Dockerfile is also available at `docker/standalone-regtest.Dockerfile`, which bundles the API, Stacks node, Bitcoin node, and PostgreSQL into a single image for testing.

### Upgrading

Major version upgrades (e.g., `7.x` to `8.x`) may include breaking database schema changes. Use [Event Replay](#event-replay) to rebuild the database. Check the [CHANGELOG](CHANGELOG.md) for details on each release.

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

### Pull Requests

Pull requests should target the `develop` branch, not `master`.

## Community

- [Discord](https://discord.gg/ZQR6cyZC) — chat with other developers and the Hiro team
- [hiro.so](https://www.hiro.so/) — product updates and mailing list
- [Twitter / X](https://twitter.com/hirosystems) — follow Hiro for announcements

## License

GPL-3.0 — see [LICENSE](LICENSE) for details.
