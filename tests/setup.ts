import { ContainerConfig, runUp, runDown } from './docker-container';

const CONTAINER_PREFIX = 'stacks-api-test';

type Profile = 'default' | 'snp';

// ---------------------------------------------------------------------------
// Default profile — postgres, bitcoind, stacks-blockchain
// ---------------------------------------------------------------------------

function defaultContainers(): ContainerConfig[] {
  const postgres: ContainerConfig = {
    image: 'postgres:17',
    name: `${CONTAINER_PREFIX}-postgres`,
    ports: [{ host: 5490, container: 5432 }],
    env: [
      'POSTGRES_USER=postgres',
      'POSTGRES_PASSWORD=postgres',
      'POSTGRES_DB=stacks_blockchain_api',
      'POSTGRES_PORT=5432',
    ],
    entrypoint: [
      '/bin/bash',
      '-c',
      "docker-entrypoint.sh postgres & rm -f /ready.txt || true && until pg_isready -U postgres; do sleep 3; done && psql -U postgres -d stacks_blockchain_api -c 'CREATE SCHEMA IF NOT EXISTS stacks_blockchain_api;' || true && echo 'done' > /ready.txt && wait",
    ],
    healthcheck: 'cat /ready.txt && pg_isready -U postgres',
    volumes: ['tests/event-replay/.tmp/local/:/root/'],
  };

  const bitcoind: ContainerConfig = {
    image: 'blockstack/bitcoind:v0.20.99.0',
    name: `${CONTAINER_PREFIX}-bitcoind`,
    ports: [
      { host: 18443, container: 18443 },
      { host: 18444, container: 18444 },
    ],
    waitPort: 18443,
    command: [
      '/usr/local/bin/bitcoind',
      '-printtoconsole',
      '-regtest=1',
      '-txindex=1',
      '-rpcallowip=0.0.0.0/0',
      '-rpcbind=0.0.0.0',
      '-rpcuser=btc',
      '-rpcpassword=btc',
    ],
  };

  const bitcoindFillFaucet: ContainerConfig = {
    image: 'byrnedo/alpine-curl',
    name: `${CONTAINER_PREFIX}-bitcoind-fill-faucet`,
    ports: [],
    waitForReady: false,
    restartPolicy: 'on-failure',
    command: [
      '-f',
      '-u',
      'btc:btc',
      '--data-binary',
      '{"jsonrpc": "1.0", "id":"c", "method": "generatetoaddress", "params": [110, "mrzLDS7LT3otAnpiRWGYkWipdnAZJaXAZQ"] }',
      '-H',
      'content-type: text/plain;',
      'http://host.docker.internal:18443/',
    ],
    extraHosts: ['host.docker.internal:host-gateway'],
  };

  const stacksBlockchain: ContainerConfig = {
    image: 'hirosystems/stacks-api-e2e:stacks3.0-0a2c0e2',
    name: `${CONTAINER_PREFIX}-stacks-blockchain`,
    ports: [
      { host: 20443, container: 20443 },
      { host: 20444, container: 20444 },
    ],
    waitPort: 20443,
    env: [
      'STACKS_EVENT_OBSERVER=host.docker.internal:3700',
      'BLOCKSTACK_USE_TEST_GENESIS_CHAINSTATE=1',
      'NOP_BLOCKSTACK_DEBUG=1',
    ],
    volumes: [
      'stacks-blockchain/:/app/config',
      'stacks-blockchain/.chaindata:/tmp/stacks-blockchain-data',
    ],
    extraHosts: ['host.docker.internal:host-gateway'],
    restartPolicy: 'on-failure',
  };

  return [postgres, bitcoind, bitcoindFillFaucet, stacksBlockchain];
}

// ---------------------------------------------------------------------------
// SNP profile — postgres, redis, stacks-node-publisher
// ---------------------------------------------------------------------------

function snpContainers(): ContainerConfig[] {
  const postgres: ContainerConfig = {
    image: 'postgres:17',
    name: `${CONTAINER_PREFIX}-snp-postgres`,
    ports: [{ host: 5490, container: 5432 }],
    env: [
      'POSTGRES_USER=postgres',
      'POSTGRES_PASSWORD=postgres',
      'POSTGRES_DB=postgres',
      'PGPORT=5432',
    ],
    healthcheck: 'cat /ready.txt && pg_isready -U postgres',
  };

  const redis: ContainerConfig = {
    image: 'redis:7',
    name: `${CONTAINER_PREFIX}-snp-redis`,
    ports: [{ host: 6379, container: 6379 }],
  };

  const snp: ContainerConfig = {
    image: 'ghcr.io/stx-labs/stacks-node-publisher:latest',
    name: `${CONTAINER_PREFIX}-snp`,
    ports: [{ host: 3022, container: 3022 }],
    env: [
      'OBSERVER_HOST=0.0.0.0',
      `OBSERVER_PORT=3022`,
      `REDIS_URL=redis://host.docker.internal:6379`,
      'PGHOST=host.docker.internal',
      `PGPORT=5432`,
      'PGUSER=postgres',
      'PGPASSWORD=postgres',
      'PGDATABASE=postgres',
    ],
    extraHosts: ['host.docker.internal:host-gateway'],
  };

  return [postgres, redis, snp];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function resolveContainers(profile: Profile): ContainerConfig[] {
  switch (profile) {
    case 'default':
      return defaultContainers();
    case 'snp':
      return snpContainers();
    default:
      throw new Error(`unknown profile: ${profile}`);
  }
}

export async function setup(profile: Profile = 'default'): Promise<void> {
  const containers = resolveContainers(profile);
  for (const config of containers) {
    await runUp(config);
  }
  process.stdout.write(`[testenv:${profile}] all containers ready\n`);
}

export async function teardown(profile: Profile = 'default'): Promise<void> {
  const containers = resolveContainers(profile);
  for (const config of [...containers].reverse()) {
    await runDown(config);
  }
  process.stdout.write(`[testenv:${profile}] all containers removed\n`);
}

// ---------------------------------------------------------------------------
// CLI: setup.ts [up|down] [default|snp]
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command = 'up', profileArg = 'default'] = process.argv.slice(2);
  const profile = profileArg as Profile;
  if (profile !== 'default' && profile !== 'snp') {
    throw new Error(`unknown profile: ${profile} (use "default" or "snp")`);
  }
  if (command === 'up') {
    await setup(profile);
    return;
  }
  if (command === 'down') {
    await teardown(profile);
    return;
  }
  throw new Error(`unsupported command: ${command} (use "up" or "down")`);
}

if (process.argv[1]?.includes('setup.ts') || process.argv[1]?.includes('setup.js')) {
  void main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[testenv] ${message}\n`);
    process.exitCode = 1;
  });
}
