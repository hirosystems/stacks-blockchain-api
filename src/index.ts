import {
  getApiConfiguredChainID,
  getStacksNodeChainID,
  chainIdConfigurationCheck,
} from './helpers.js';
import * as sourceMapSupport from 'source-map-support';
import { startApiServer } from './api/init.js';
import { startEventServer } from './event-stream/event-server.js';
import { StacksCoreRpcClient } from './core-rpc/client.js';
import * as promClient from 'prom-client';
import getopts from 'getopts';
import * as fs from 'fs';
import { exportEventsAsTsv, importEventsFromTsv } from './event-replay/event-replay.js';
import { PgStore } from './datastore/pg-store.js';
import { PgWriteStore } from './datastore/pg-write-store.js';
import { registerMempoolPromStats } from './datastore/helpers.js';
import {
  buildProfilerServer,
  isProdEnv,
  logger,
  numberToHex,
  PINO_LOGGER_CONFIG,
  registerShutdownConfig,
  timeout,
} from '@stacks/api-toolkit';
import Fastify from 'fastify';
import { SnpEventStreamHandler } from './event-stream/snp-event-stream.js';
import { ENV } from './env.js';

// ts-node has automatic source map support, avoid clobbering
if (!process.execArgv.some(r => r.includes('ts-node'))) {
  sourceMapSupport.install({ handleUncaughtExceptions: false });
}

registerShutdownConfig();

async function monitorCoreRpcConnection(): Promise<void> {
  const CORE_RPC_HEARTBEAT_INTERVAL = 5000; // 5 seconds
  let previouslyConnected = false;
  while (true) {
    const client = new StacksCoreRpcClient();
    try {
      await client.waitForConnection();
      if (!previouslyConnected) {
        logger.info(`Connection to Stacks core node API server at: ${client.endpoint}`);
      }
      previouslyConnected = true;
    } catch (error) {
      previouslyConnected = false;
      logger.warn(
        error,
        `[Non-critical] notice: failed to connect to node RPC server at ${client.endpoint}`
      );
    }
    await timeout(CORE_RPC_HEARTBEAT_INTERVAL);
  }
}

async function init(): Promise<void> {
  if (isProdEnv && !fs.existsSync('.git-info')) {
    throw new Error(
      'File not found: .git-info. This generated file is required to display the running API version in the ' +
        '`/extended/` endpoint. Please execute `npm run build` to regenerate it.'
    );
  }
  promClient.collectDefaultMetrics();
  chainIdConfigurationCheck();
  const apiMode = ENV.STACKS_API_MODE;
  const dbStore = await PgStore.connect({
    usageName: `datastore-${apiMode}`,
  });
  const dbWriteStore = await PgWriteStore.connect({
    usageName: `write-datastore-${apiMode}`,
    skipMigrations: apiMode === 'readonly',
    withRedisNotifier: ENV.REDIS_NOTIFIER_ENABLED,
  });
  registerMempoolPromStats(dbWriteStore.eventEmitter);

  if (apiMode === 'default' || apiMode === 'writeonly') {
    const configuredChainID = getApiConfiguredChainID();
    const eventServer = await startEventServer({
      datastore: dbWriteStore,
      chainId: configuredChainID,
    });
    registerShutdownConfig({
      name: 'Event Server',
      handler: () => eventServer.closeAsync(),
      forceKillable: true,
    });

    const skipChainIdCheck = ENV.SKIP_STACKS_CHAIN_ID_CHECK;
    const snpEnabled = ENV.SNP_EVENT_STREAMING;
    if (!skipChainIdCheck && !snpEnabled) {
      const networkChainId = await getStacksNodeChainID();
      if (networkChainId !== configuredChainID) {
        const chainIdConfig = numberToHex(configuredChainID);
        const chainIdNode = numberToHex(networkChainId);
        const error = new Error(
          `The configured STACKS_CHAIN_ID does not match, configured: ${chainIdConfig}, stacks-node: ${chainIdNode}`
        );
        logger.error(error, error.message);
        throw error;
      }
    }
    if (!snpEnabled) {
      monitorCoreRpcConnection().catch(error => {
        logger.error(error, 'Error monitoring RPC connection');
      });
    }

    if (snpEnabled) {
      const snpStream = new SnpEventStreamHandler({
        db: dbWriteStore,
        eventServer,
      });
      await snpStream.start();
      registerShutdownConfig({
        name: 'SNP client stream',
        handler: () => snpStream.stop(),
        forceKillable: true,
      });
    }
  }

  if (apiMode === 'default' || apiMode === 'readonly') {
    const apiServer = await startApiServer({
      datastore: dbStore,
      writeDatastore: dbWriteStore,
      chainId: getApiConfiguredChainID(),
    });
    logger.info(`API server listening on: http://${apiServer.address}`);
    registerShutdownConfig({
      name: 'API Server',
      handler: () => apiServer.terminate(),
      forceKillable: true,
      forceKillHandler: () => apiServer.forceKill(),
    });
  }

  if (ENV.STACKS_PROFILER_PORT) {
    const profilerServer = await buildProfilerServer();
    registerShutdownConfig({
      name: 'Profiler server',
      handler: () => profilerServer.close(),
      forceKillable: true,
    });
    await profilerServer.listen({
      host: ENV.STACKS_PROFILER_HOST ?? '0.0.0.0',
      port: ENV.STACKS_PROFILER_PORT,
    });
  }

  registerShutdownConfig({
    name: 'DB',
    handler: async () => {
      await dbStore.close();
      await dbWriteStore.close();
    },
    forceKillable: true,
  });

  if (isProdEnv) {
    const promServer = Fastify({
      trustProxy: true,
      logger: PINO_LOGGER_CONFIG,
    });
    promServer.route({
      url: '/metrics',
      method: 'GET',
      logLevel: 'info',
      handler: async (_, reply) => {
        const metrics: string = await promClient.register.metrics();
        await reply.type('text/plain').send(metrics);
      },
    });
    registerShutdownConfig({
      name: 'Prometheus Server',
      forceKillable: true,
      handler: async () => {
        await promServer.close();
      },
    });
    await promServer.listen({ host: '0.0.0.0', port: 9153 });
  }
}

function initApp() {
  init()
    .then(() => {
      logger.info('App initialized');
    })
    .catch(error => {
      logger.error(error, 'app failed to start');
      process.exit(1);
    });
}

function getProgramArgs() {
  // TODO: use a more robust arg parsing library that has built-in `--help` functionality
  const parsedOpts = getopts(process.argv.slice(2), {
    boolean: ['overwrite-file', 'wipe-db'],
  });
  const args = {
    operand: parsedOpts._[0],
    options: parsedOpts,
  } as
    | {
        operand: 'export-events';
        options: {
          ['file']?: string;
          ['overwrite-file']?: boolean;
        };
      }
    | {
        operand: 'import-events';
        options: {
          ['file']?: string;
          ['mode']?: string;
          ['wipe-db']?: boolean;
          ['force']?: boolean;
        };
      };
  return { args, parsedOpts };
}

async function handleProgramArgs() {
  const { args, parsedOpts } = getProgramArgs();
  if (args.operand === 'export-events') {
    await exportEventsAsTsv(args.options.file, args.options['overwrite-file']);
  } else if (args.operand === 'import-events') {
    await importEventsFromTsv(
      args.options.file,
      args.options.mode,
      args.options['wipe-db'],
      args.options.force
    );
  } else if (parsedOpts._[0]) {
    throw new Error(`Unexpected program argument: ${parsedOpts._[0]}`);
  } else {
    initApp();
  }
}

void handleProgramArgs().catch(error => {
  console.error(error);
  const { args } = getProgramArgs();
  if (args.operand) {
    console.error(`${args.operand} process failed`);
  }
  process.exit(1);
});
