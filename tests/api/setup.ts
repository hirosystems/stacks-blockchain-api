import type { ContainerConfig } from '../docker-container.ts';
import { runDown, runUp } from '../docker-container.ts';

function defaultContainers(): ContainerConfig[] {
  const postgres: ContainerConfig = {
    image: 'postgres:17',
    name: `stacks-api-test-postgres`,
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
    volumes: ['tests/api/event-replay/.tmp/local/:/root/'],
  };

  const bitcoind: ContainerConfig = {
    image: 'blockstack/bitcoind:v0.20.99.0',
    name: `stacks-api-test-bitcoind`,
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
    name: `stacks-api-test-bitcoind-fill-faucet`,
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
    name: `stacks-api-test-stacks-blockchain`,
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
    // volumes: [
    //   'stacks-blockchain/:/app/config',
    //   'stacks-blockchain/.chaindata:/tmp/stacks-blockchain-data',
    // ],
    extraHosts: ['host.docker.internal:host-gateway'],
    restartPolicy: 'on-failure',
  };

  return [postgres, bitcoind, bitcoindFillFaucet, stacksBlockchain];
}

export async function globalSetup() {
  const containers = defaultContainers();
  for (const config of containers) {
    await runUp(config);
  }
  process.stdout.write(`[testenv:api] all containers ready\n`);
}

export async function globalTeardown() {
  const containers = defaultContainers();
  for (const config of [...containers].reverse()) {
    await runDown(config);
  }
  process.stdout.write(`[testenv:api] all containers removed\n`);
}
