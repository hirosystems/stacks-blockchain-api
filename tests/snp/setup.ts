import type { ContainerConfig } from '../docker-container.ts';
import { runDown, runUp } from '../docker-container.ts';

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
      `PGPORT=5432`,
      'PGUSER=postgres',
      'PGPASSWORD=postgres',
      'PGDATABASE=postgres',
    ],
    extraHosts: ['host.docker.internal:host-gateway'],
  };

  return [postgres, redis, snp];
}

export async function globalSetup() {
  const containers = snpContainers();
  for (const config of containers) {
    await runUp(config);
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
