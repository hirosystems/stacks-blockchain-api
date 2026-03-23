import type { ContainerConfig } from '../docker-container.ts';
import { runDown, runLogs, runUp } from '../docker-container.ts';

function kryptonContainers(): ContainerConfig[] {
  const postgres: ContainerConfig = {
    image: 'postgres:17',
    name: `stacks-api-test-krypton-postgres`,
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
  };

  const stacksBlockchain: ContainerConfig = {
    image: 'hirosystems/stacks-api-e2e:stacks3.0-0a2c0e2',
    name: `stacks-api-test-krypton-stacks-blockchain`,
    ports: [
      { host: 20443, container: 20443 },
      { host: 20444, container: 20444 },
      { host: 18443, container: 18443 },
      { host: 18444, container: 18444 },
    ],
    waitPort: 20443,
    env: ['STACKS_EVENT_OBSERVER=host.docker.internal:3700', 'MINE_INTERVAL=0.1s'],
    extraHosts: ['host.docker.internal:host-gateway'],
  };

  return [postgres, stacksBlockchain];
}

export async function globalSetup() {
  const containers = kryptonContainers();
  for (const config of containers) {
    await runUp(config);
  }
  process.stdout.write(`[testenv:krypton] all containers ready\n`);
}

export async function globalTeardown() {
  const containers = kryptonContainers();
  for (const config of [...containers].reverse()) {
    try {
      process.stdout.write(`\n[testenv:krypton] logs for ${config.name}\n`);
      await runLogs(config, ['--once']); // tail last logs
    } catch (error) {
      process.stdout.write(`[testenv:krypton] could not read logs for ${config.name}: ${error}\n`);
    }
    await runDown(config);
  }
  process.stdout.write(`[testenv:krypton] all containers removed\n`);
}
