import * as net from 'node:net';
import * as Docker from 'dockerode';
import { connectPostgres, timeout } from '@hirosystems/api-toolkit';
import { createClient } from 'redis';
import { loadDotEnv } from '../../src/helpers';
import { fetch } from 'undici';

const testContainerLabel = 'stacks-blockchain-api-tests';

function isDockerImagePulled(docker: Docker, imgName: string) {
  return docker
    .getImage(imgName)
    .inspect()
    .then(
      () => true,
      () => false
    );
}

async function pullDockerImage(docker: Docker, imgName: string) {
  await new Promise<void>((resolve, reject) => {
    docker.pull(imgName, {}, (err, stream) => {
      if (err || !stream) return reject(err as Error);
      docker.modem.followProgress(stream, err => (err ? reject(err) : resolve()), console.log);
    });
  });
}

async function pruneContainers(docker: Docker, label: string) {
  const containers = await docker.listContainers({ all: true, filters: { label: [label] } });
  for (const container of containers) {
    const c = docker.getContainer(container.Id);
    await c.remove({ v: true, force: true });
  }
  await docker.pruneContainers({ filters: { label: [label] } });
  return containers.length;
}

async function startContainer(args: {
  docker: Docker;
  image: string;
  ports: { container: number; host: number }[];
  env: string[];
}) {
  const { docker, image, ports, env } = args;
  try {
    const imgPulled = await isDockerImagePulled(docker, image);
    if (!imgPulled) {
      console.log(`Pulling ${image} image...`);
      await pullDockerImage(docker, image);
    }
    console.log(`Creating ${image} container...`);
    const exposedPorts = ports.reduce(
      (acc, port) => ({ ...acc, [`${port.container}/tcp`]: {} }),
      {}
    );
    const portBindings: Record<string, { HostPort: string }[]> = {};
    ports.forEach(port => {
      portBindings[`${port.container}/tcp`] = [{ HostPort: port.host.toString() }];
    });
    const container = await docker.createContainer({
      Labels: { [testContainerLabel]: 'true' },
      Image: image,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        ExtraHosts: ['host.docker.internal:host-gateway'],
      },
      Env: env,
    });

    console.log(`Starting ${image} container...`);
    await container.start();

    console.log(`${image} container started on ports ${JSON.stringify(ports)}`);

    const containers: { id: string; image: string }[] =
      (globalThis as any).__TEST_DOCKER_CONTAINERS ?? [];
    containers.push({ id: container.id, image });
    Object.assign(globalThis, { __TEST_DOCKER_CONTAINERS: containers });

    return { image, containerId: container.id };
  } catch (error) {
    console.error('Error starting PostgreSQL container:', error);
    throw error;
  }
}

async function findFreePorts(count: number) {
  const servers = await Promise.all(
    Array.from({ length: count }, () => {
      return new Promise<net.Server>((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, () => resolve(server)).on('error', reject);
      });
    })
  );
  const ports = await Promise.all(
    servers.map(server => {
      const { port } = server.address() as net.AddressInfo;
      return new Promise<number>(resolve => server.close(() => resolve(port)));
    })
  );
  return ports;
}

// Helper function to wait for PostgreSQL to be ready
async function waitForPostgres(): Promise<void> {
  const sql = await connectPostgres({
    usageName: testContainerLabel,
    connectionArgs: {
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT as string),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
    },
  });
  await sql`SELECT 1`;
  await sql.end();
  console.log('Postgres is ready');
}

async function waitForRedis(): Promise<void> {
  const redisClient = createClient({
    url: process.env['SNP_REDIS_URL'],
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
  const snpUrl = process.env['SNP_OBSERVER_URL'];
  if (!snpUrl) {
    throw new Error('SNP_OBSERVER_URL is not set');
  }
  while (true) {
    try {
      const response = await fetch(snpUrl + '/status');
      if (response.ok) {
        console.log('SNP is ready');
        break;
      } else {
        console.error(`SNP not ready at ${snpUrl}: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`SNP not ready at ${snpUrl}: ${error}`);
    }
    await timeout(100);
  }
}

// Jest global setup
// ts-unused-exports:disable-next-line
export default async function setup(): Promise<void> {
  loadDotEnv();

  // use a random PGSCHEMA for each test to avoid conflicts
  process.env.PG_SCHEMA = `test_${crypto.randomUUID()}`;

  const docker = new Docker();
  const prunedCount = await pruneContainers(docker, testContainerLabel);
  if (prunedCount > 0) {
    console.log(`Pruned ${prunedCount} existing test docker containers`);
  }

  const [pgHostPort, redisHostPort, snpHostPort] = await findFreePorts(3);

  const startPg = async () => {
    const pgPort = 5432;
    const pgContainer = await startContainer({
      docker,
      image: 'postgres:17',
      ports: [{ container: pgPort, host: pgHostPort }],
      env: [
        `POSTGRES_USER=${process.env.PG_USER}`,
        `POSTGRES_PASSWORD=${process.env.PG_PASSWORD}`,
        `POSTGRES_DB=${process.env.PG_DATABASE}`,
        `PGPORT=${pgPort}`,
      ],
    });
    process.env.PG_PORT = pgHostPort.toString();
    process.env['_PG_DOCKER_CONTAINER_ID'] = pgContainer.containerId;
    // Wait for the database to be ready
    await waitForPostgres();
  };

  const startRedis = async () => {
    const redisPort = 6379;
    const redisContainer = await startContainer({
      docker,
      image: 'redis:7',
      ports: [{ container: redisPort, host: redisHostPort }],
      env: [],
    });
    process.env['SNP_REDIS_URL'] = `redis://127.0.0.1:${redisHostPort}`;
    process.env['_REDIS_DOCKER_CONTAINER_ID'] = redisContainer.containerId;
    // wait for redis to be ready
    await waitForRedis();
  };

  const startServices = await Promise.allSettled([startPg(), startRedis()]);
  for (const service of startServices) {
    if (service.status === 'rejected') {
      throw service.reason;
    }
  }

  const startSNP = async () => {
    const snpObserverPort = 3022;
    process.env.SNP_REDIS_STREAM_KEY_PREFIX = `test_${crypto.randomUUID()}`;
    console.log(`Using REDIS_STREAM_KEY_PREFIX: ${process.env.SNP_REDIS_STREAM_KEY_PREFIX}`);
    const snpContainer = await startContainer({
      docker,
      image: 'hirosystems/salt-n-pepper:1.1.2',
      ports: [{ container: snpObserverPort, host: snpHostPort }],
      env: [
        `OBSERVER_HOST=0.0.0.0`,
        `OBSERVER_PORT=${snpObserverPort}`,
        `REDIS_URL=redis://host.docker.internal:${redisHostPort}`,
        `REDIS_STREAM_KEY_PREFIX=${process.env.SNP_REDIS_STREAM_KEY_PREFIX}`,
        `PGHOST=host.docker.internal`,
        `PGPORT=${process.env.PG_PORT}`,
        `PGUSER=${process.env.PG_USER}`,
        `PGPASSWORD=${process.env.PG_PASSWORD}`,
        `PGDATABASE=${process.env.PG_DATABASE}`,
        `PGSCHEMA=test_snp_${crypto.randomUUID()}`,
      ],
    });
    process.env['SNP_OBSERVER_URL'] = `http://127.0.0.1:${snpHostPort}`;
    process.env['_SNP_DOCKER_CONTAINER_ID'] = snpContainer.containerId;
    // Wait for snp to be ready
    await waitForSNP();
  };
  await startSNP();

  // Setup misc required env vars
  process.env.STACKS_NODE_RPC_HOST = '';
  process.env.STACKS_NODE_RPC_PORT = '1';
}
