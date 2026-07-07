import type { DockerTestContainerConfig } from '@stacks/api-test-toolkit';
import { dockerTestDown, dockerTestUp } from '@stacks/api-test-toolkit';

function defaultContainers(): DockerTestContainerConfig[] {
  const postgres: DockerTestContainerConfig = {
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

  return [postgres];
}

export async function globalSetup() {
  const containers = defaultContainers();
  for (const config of containers) {
    await dockerTestUp({ config });
  }
  process.stdout.write(`[testenv:api] all containers ready\n`);
}

export async function globalTeardown() {
  const containers = defaultContainers();
  for (const config of [...containers].reverse()) {
    await dockerTestDown({ config });
  }
  process.stdout.write(`[testenv:api] all containers removed\n`);
}
