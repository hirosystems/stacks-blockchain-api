import { connectPostgres, timeout } from '@stacks/api-toolkit';
import type { ContainerConfig } from '../docker-container.ts';
import { runDown, runLogs, runUp } from '../docker-container.ts';
import { createClient } from 'redis';

function snpContainers(): ContainerConfig[] {
  const postgres: ContainerConfig = {
    image: 'postgres:17',
    name: `stacks-api-test-snp-postgres`,
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
    name: `stacks-api-test-snp-redis`,
    ports: [{ host: 6379, container: 6379 }],
    waitPort: 6379,
  };

  const snp: ContainerConfig = {
    image: 'ghcr.io/stx-labs/stacks-node-publisher:latest',
    name: `stacks-api-test-snp`,
    ports: [{ host: 3022, container: 3022 }],
    env: [
      'OBSERVER_HOST=0.0.0.0',
      `OBSERVER_PORT=3022`,
      `REDIS_URL=redis://host.docker.internal:6379`,
      'PGHOST=host.docker.internal',
      `PGPORT=5490`,
      'PGUSER=postgres',
      'PGPASSWORD=postgres',
      'PGDATABASE=postgres',
    ],
    waitPort: 3022,
    extraHosts: ['host.docker.internal:host-gateway'],
  };

  return [postgres, redis, snp];
}

async function waitForPostgres(): Promise<void> {
  const sql = await connectPostgres({
    usageName: 'test-snp',
    connectionArgs: {
      host: '127.0.0.1',
      port: 5490,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    },
  });
  await sql`SELECT 1`;
  await sql.end();
  console.log('Postgres is ready');
}

async function waitForRedis(): Promise<void> {
  const redisClient = createClient({
    url: 'redis://127.0.0.1:6379',
    name: 'stacks-blockchain-api-server-tests',
  });
  redisClient.on('error', (err: Error) => console.error(`Redis not ready: ${err}`));
  redisClient.once('ready', () => console.log('Connected to Redis successfully!'));
  while (true) {
    try {
      await redisClient.connect();
      break;
    } catch (error) {
      console.error(`Failed to connect to Redis:`, error);
      await timeout(100);
    }
  }
  await redisClient.disconnect();
}

async function waitForSNP(): Promise<void> {
  const snpUrl = 'http://127.0.0.1:3022';
  const maxAttempts = 10;
  let attempt = 0;
  let lastError: unknown;
  while (true) {
    attempt += 1;
    try {
      const response = await fetch(snpUrl + '/status');
      if (response.ok) {
        console.log('SNP is ready');
        break;
      } else {
        const error = new Error(`SNP not ready at ${snpUrl}: ${response.statusText}`);
        lastError = error;
        console.error(error.message);
      }
    } catch (error) {
      lastError = error;
      console.error(`SNP not ready at ${snpUrl}: ${error}`);
    }
    if (attempt >= maxAttempts) {
      break;
    }
    await timeout(100);
  }
}

export async function globalSetup() {
  const containers = snpContainers();
  for (const config of containers) {
    await runUp(config);
  }
  await waitForPostgres();
  await waitForRedis();
  await waitForSNP();
  for (const config of containers) {
    try {
      process.stdout.write(`\n[testenv:snp] logs for ${config.name}\n`);
      await runLogs(config, ['--once']);
    } catch (error) {
      process.stdout.write(`[testenv:snp] could not read logs for ${config.name}: ${error}\n`);
    }
  }
  process.stdout.write(`[testenv:snp] all containers ready\n`);
}

export async function globalTeardown() {
  const containers = snpContainers();
  for (const config of [...containers].reverse()) {
    await runDown(config);
  }
  process.stdout.write(`[testenv:snp] all containers removed\n`);
}
