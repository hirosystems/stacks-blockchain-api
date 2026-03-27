/* eslint-disable @typescript-eslint/no-unsafe-return */
import { strict as assert } from 'node:assert';
import * as net from 'node:net';
import Docker from 'dockerode';

export interface PortMapping {
  host: number;
  container: number;
}

export interface ContainerConfig {
  /** Docker image (e.g. "postgres:17") */
  image: string;
  /** Container name */
  name: string;
  /** Host to bind to (default: "127.0.0.1") */
  host?: string;
  /** Port mappings (host → container) */
  ports: PortMapping[];
  /** Port to wait on before declaring the container ready (default: first port's host side) */
  waitPort?: number;
  /** Set to false to skip the port-readiness check (e.g. for one-shot sidecars) */
  waitForReady?: boolean;
  /** Environment variables */
  env?: string[];
  /** Override the image entrypoint */
  entrypoint?: string[];
  /** Override the image command */
  command?: string[];
  /** Bind-mount volumes ("host:container") */
  volumes?: string[];
  /** Extra /etc/hosts entries ("hostname:ip") */
  extraHosts?: string[];
  /** Docker healthcheck command (passed after CMD-SHELL) */
  healthcheck?: string;
  /** Restart policy (default: no) */
  restartPolicy?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
  /** Labels to attach to the container */
  labels?: Record<string, string>;
  /** Startup timeout in ms (default: 120_000) */
  timeoutMs?: number;
}

const DEFAULTS = {
  host: '127.0.0.1',
  timeoutMs: 120_000,
} as const;

function createDockerClient(): Docker {
  if (process.env.DOCKER_HOST) {
    const dockerHost = new URL(process.env.DOCKER_HOST);
    return new Docker({
      host: dockerHost.hostname,
      port: Number(dockerHost.port),
      protocol: dockerHost.protocol.replace(':', '') as 'http' | 'https' | 'ssh',
    });
  }
  return new Docker({ socketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock' });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function streamToPromise(stream: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
}

async function pullImageIfMissing(docker: Docker, image: string): Promise<void> {
  const images = (await docker.listImages()) as { RepoTags?: string[] }[];
  const hasImage = images.some(img => img.RepoTags?.includes(image));
  if (hasImage) return;

  process.stdout.write(`[testenv] pulling image ${image}\n`);
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, err => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve();
    });
  });
}

async function getContainer(docker: Docker, name: string) {
  const containers = await docker.listContainers({
    all: true,
    filters: { name: [name] },
  });
  // Docker's name filter does substring matching, so we need an exact match.
  // Container names are stored with a leading slash (e.g. "/my-container").
  const exact = containers.find(c => c.Names.some(n => n === `/${name}` || n === name));
  if (!exact) return undefined;
  assert.ok(exact.Id);
  return docker.getContainer(exact.Id);
}

async function ensureContainerRunning(docker: Docker, config: ContainerConfig) {
  const host = config.host ?? DEFAULTS.host;
  const {
    name,
    image,
    ports,
    env,
    entrypoint,
    command,
    volumes,
    extraHosts,
    healthcheck,
    restartPolicy,
    labels,
  } = config;

  const existing = await getContainer(docker, name);
  if (existing) {
    const inspect = await existing.inspect();
    if (!inspect.State.Running) {
      process.stdout.write(`[testenv] starting existing container ${name}\n`);
      await existing.start();
    } else {
      process.stdout.write(`[testenv] container ${name} already running\n`);
    }
    return existing;
  }

  const exposedPorts: Record<string, object> = {};
  const portBindings: Record<string, { HostPort: string; HostIp: string }[]> = {};
  for (const { host: hostPort, container: containerPort } of ports) {
    const key = `${containerPort}/tcp`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(hostPort), HostIp: host }];
  }

  const binds = volumes?.map(v => {
    // Resolve relative paths from the project root
    if (!v.startsWith('/')) {
      const [hostPath, ...rest] = v.split(':');
      const resolved = `${process.cwd()}/${hostPath}`;
      return [resolved, ...rest].join(':');
    }
    return v;
  });

  process.stdout.write(`[testenv] creating container ${name}\n`);
  const container = await docker.createContainer({
    name,
    Image: image,
    Env: env,
    ...(entrypoint && { Entrypoint: entrypoint }),
    ...(command && { Cmd: command }),
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      AutoRemove: false,
      ...(binds && { Binds: binds }),
      ...(extraHosts && { ExtraHosts: extraHosts }),
      RestartPolicy: { Name: restartPolicy ?? 'no' },
    },
    Labels: labels,
    ...(healthcheck && {
      Healthcheck: {
        Test: ['CMD-SHELL', healthcheck],
        Interval: 2_000_000_000,
        Timeout: 2_000_000_000,
        Retries: 30,
        StartPeriod: 2_000_000_000,
      },
    }),
  });
  await container.start();
  return container;
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await new Promise<boolean>(resolve => {
      const socket = net.createConnection(port, host);
      socket.setTimeout(1_000);
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${host}:${port}`);
}

export async function runUp(config: ContainerConfig): Promise<void> {
  const host = config.host ?? DEFAULTS.host;
  const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
  const docker = createDockerClient();
  await pullImageIfMissing(docker, config.image);
  await ensureContainerRunning(docker, config);
  if (config.waitForReady !== false && config.ports.length > 0) {
    const port = config.waitPort ?? config.ports[0].host;
    await waitForPort(host, port, timeoutMs);
    process.stdout.write(`[testenv] ${config.name} ready on ${host}:${port}\n`);
  } else {
    process.stdout.write(`[testenv] ${config.name} started (no readiness check)\n`);
  }
}

export async function runDown(config: ContainerConfig): Promise<void> {
  const docker = createDockerClient();
  const container = await getContainer(docker, config.name);
  if (!container) {
    process.stdout.write(`[testenv] container ${config.name} is already absent\n`);
    return;
  }
  const inspect = await container.inspect();
  if (inspect.State.Running) {
    process.stdout.write(`[testenv] stopping ${config.name}\n`);
    await container.stop({ t: 0 });
  }
  process.stdout.write(`[testenv] removing ${config.name}\n`);
  await container.remove({ force: true, v: true });
}

export async function runLogs(config: ContainerConfig, argv: string[]): Promise<void> {
  const follow = argv.includes('-f') || argv.includes('--follow') || !argv.includes('--once');
  const docker = createDockerClient();
  const container = await getContainer(docker, config.name);
  if (!container) {
    throw new Error(`container ${config.name} not found`);
  }
  if (follow) {
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      timestamps: true,
      tail: 200,
    });
    container.modem.demuxStream(logStream, process.stdout, process.stderr);
    await streamToPromise(logStream);
    return;
  }
  const output = await container.logs({
    stdout: true,
    stderr: true,
    follow: false,
    timestamps: true,
    tail: 200,
  });
  process.stdout.write(output.toString('utf8'));
}
