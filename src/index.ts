import {
  loadDotEnv,
  getApiConfiguredChainID,
  getStacksNodeChainID,
  chainIdConfigurationCheck,
} from './helpers';
import * as sourceMapSupport from 'source-map-support';
import { startApiServer } from './api/init';
import { startProfilerServer } from './inspector-util';
import { startEventServer } from './event-stream/event-server';
import { StacksCoreRpcClient } from './core-rpc/client';
import * as promClient from 'prom-client';
import { OfflineDummyStore } from './datastore/offline-dummy-store';
import * as getopts from 'getopts';
import * as fs from 'fs';
import { injectC32addressEncodeCache } from './c32-addr-cache';
import { exportEventsAsTsv, importEventsFromTsv } from './event-replay/event-replay';
import { PgStore } from './datastore/pg-store';
import { PgWriteStore } from './datastore/pg-write-store';
import { registerMempoolPromStats } from './datastore/helpers';
import { logger } from './logger';
import {
  isProdEnv,
  numberToHex,
  parseBoolean,
  PINO_LOGGER_CONFIG,
  registerShutdownConfig,
  timeout,
} from '@hirosystems/api-toolkit';
import Fastify from 'fastify';
import { SnpEventStreamHandler } from './event-stream/snp-event-stream';

enum StacksApiMode {
  /**
   * Default mode. Runs both the Event Server and API endpoints. AKA read-write mode.
   */
  default = 'default',
  /**
   * Runs the API endpoints without an Event Server. A connection to a `default`
   * or `writeOnly` API's postgres DB is required.
   */
  readOnly = 'readonly',
  /**
   * Runs the Event Server only.
   */
  writeOnly = 'writeonly',
  /**
   * Runs without an Event Server or API endpoints. Used for Rosetta only.
   */
  offline = 'offline',
}

/**
 * Determines the current API execution mode based on .env values.
 * @returns detected StacksApiMode
 */
function getApiMode(): StacksApiMode {
  switch (process.env['STACKS_API_MODE']) {
    case 'readonly':
      return StacksApiMode.readOnly;
    case 'writeonly':
      return StacksApiMode.writeOnly;
    case 'offline':
      return StacksApiMode.offline;
    default:
      break;
  }
  // Make sure we're backwards compatible if `STACKS_API_MODE` is not specified.
  if (parseBoolean(process.env['STACKS_READ_ONLY_MODE'])) {
    return StacksApiMode.readOnly;
  }
  if (parseBoolean(process.env['STACKS_API_OFFLINE_MODE'])) {
    return StacksApiMode.offline;
  }
  return StacksApiMode.default;
}

loadDotEnv();

// ts-node has automatic source map support, avoid clobbering
if (!process.execArgv.some(r => r.includes('ts-node'))) {
  sourceMapSupport.install({ handleUncaughtExceptions: false });
}

injectC32addressEncodeCache();

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
  const apiMode = getApiMode();
  let dbStore: PgStore;
  let dbWriteStore: PgWriteStore;
  if (apiMode === StacksApiMode.offline) {
    dbStore = OfflineDummyStore;
    dbWriteStore = OfflineDummyStore;
  } else {
    dbStore = await PgStore.connect({
      usageName: `datastore-${apiMode}`,
    });
    dbWriteStore = await PgWriteStore.connect({
      usageName: `write-datastore-${apiMode}`,
      skipMigrations: apiMode === StacksApiMode.readOnly,
      withRedisNotifier: parseBoolean(process.env['REDIS_NOTIFIER_ENABLED']) ?? false,
    });
    registerMempoolPromStats(dbWriteStore.eventEmitter);
  }

  if (apiMode === StacksApiMode.default || apiMode === StacksApiMode.writeOnly) {
    const configuredChainID = getApiConfiguredChainID();
    const eventServer = await startEventServer({
      datastore: dbWriteStore,
      chainId: configuredChainID,
    });
    registerShutdownConfig({
      name: 'Event Server',
      handler: () => eventServer.closeAsync(),
      forceKillable: false,
    });

    const skipChainIdCheck = parseBoolean(process.env['SKIP_STACKS_CHAIN_ID_CHECK']);
    const snpEnabled = parseBoolean(process.env['SNP_EVENT_STREAMING']);
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
      const lastRedisMsgId = await dbWriteStore.getLastIngestedSnpRedisMsgId();
      const snpStream = new SnpEventStreamHandler({
        lastMessageId: lastRedisMsgId,
        db: dbWriteStore,
        eventServer,
      });
      await snpStream.start();
      registerShutdownConfig({
        name: 'SNP client stream',
        handler: () => snpStream.stop(),
        forceKillable: false,
      });
    }
  }

  if (
    apiMode === StacksApiMode.default ||
    apiMode === StacksApiMode.readOnly ||
    apiMode === StacksApiMode.offline
  ) {
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

  const profilerHttpServerPort = process.env['STACKS_PROFILER_PORT'];
  if (profilerHttpServerPort) {
    const profilerServer = await startProfilerServer(profilerHttpServerPort);
    registerShutdownConfig({
      name: 'Profiler server',
      handler: () => profilerServer.close(),
      forceKillable: false,
    });
  }

  if (apiMode !== StacksApiMode.offline) {
    registerShutdownConfig({
      name: 'DB',
      handler: async () => {
        await dbStore.close();
        await dbWriteStore.close();
      },
      forceKillable: false,
    });
  }

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
      forceKillable: false,
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
      }
    | {
        operand: 'from-parquet-events';
        options: {
          ['new-burn-block']?: boolean;
          ['attachment-new']?: boolean;
          ['new-block']?: boolean;
          ['ids-path']?: string;
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
  } else if (args.operand === 'from-parquet-events') {
    const { ReplayController } = await import('./event-replay/parquet-based/replay-controller');
    const replay = await ReplayController.init();
    await replay.prepare();
    await replay.do();
    await replay.finalize();
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
