import {
  loadDotEnv,
  timeout,
  logger,
  logError,
  isProdEnv,
  numberToHex,
  httpPostRequest,
  parseArgBoolean,
} from './helpers';
import * as sourceMapSupport from 'source-map-support';
import { DataStore } from './datastore/common';
import { cycleMigrations, dangerousDropAllTables, PgDataStore } from './datastore/postgres-store';
import { MemoryDataStore } from './datastore/memory-store';
import { startApiServer } from './api/init';
import { startProfilerServer } from './inspector-util';
import { startEventServer } from './event-stream/event-server';
import {
  isFtMetadataEnabled,
  isNftMetadataEnabled,
  TokensProcessorQueue,
} from './event-stream/tokens-contract-handler';
import { StacksCoreRpcClient } from './core-rpc/client';
import { createServer as createPrometheusServer } from '@promster/server';
import { ChainID } from '@stacks/transactions';
import { registerShutdownConfig } from './shutdown-handler';
import { importV1TokenOfferingData, importV1BnsData } from './import-v1';
import { OfflineDummyStore } from './datastore/offline-dummy-store';
import { Socket } from 'net';
import * as getopts from 'getopts';
import * as fs from 'fs';
import * as path from 'path';
import { injectC32addressEncodeCache } from './c32-addr-cache';

enum StacksApiMode {
  /**
   * Default mode. Runs both the Event Server and API endpoints. AKA read-write mode.
   */
  default,
  /**
   * Runs the API endpoints without an Event Server. A connection to a `default`
   * or `writeOnly` API's postgres DB is required.
   */
  readOnly,
  /**
   * Runs the Event Server only.
   */
  writeOnly,
  /**
   * Runs without an Event Server or API endpoints. Used for Rosetta only.
   */
  offline,
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
  if (parseArgBoolean(process.env['STACKS_READ_ONLY_MODE'])) {
    return StacksApiMode.readOnly;
  }
  if (parseArgBoolean(process.env['STACKS_API_OFFLINE_MODE'])) {
    return StacksApiMode.offline;
  }
  return StacksApiMode.default;
}

loadDotEnv();

sourceMapSupport.install({ handleUncaughtExceptions: false });

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
      logger.error(`Warning: failed to connect to node RPC server at ${client.endpoint}`);
    }
    await timeout(CORE_RPC_HEARTBEAT_INTERVAL);
  }
}

async function getCoreChainID(): Promise<ChainID> {
  const client = new StacksCoreRpcClient();
  await client.waitForConnection(Infinity);
  const coreInfo = await client.getInfo();
  if (coreInfo.network_id === ChainID.Mainnet) {
    return ChainID.Mainnet;
  } else if (coreInfo.network_id === ChainID.Testnet) {
    return ChainID.Testnet;
  } else {
    throw new Error(`Unexpected network_id "${coreInfo.network_id}"`);
  }
}

function getConfiguredChainID() {
  if (!('STACKS_CHAIN_ID' in process.env)) {
    const error = new Error(`Env var STACKS_CHAIN_ID is not set`);
    logError(error.message, error);
    throw error;
  }
  const configuredChainID: ChainID = parseInt(process.env['STACKS_CHAIN_ID'] as string);
  return configuredChainID;
}

async function init(): Promise<void> {
  if (isProdEnv && !fs.existsSync('.git-info')) {
    throw new Error(
      'File not found: .git-info. This generated file is required to display the running API version in the ' +
        '`/extended/v1/status` endpoint. Please execute `npm run build` to regenerate it.'
    );
  }
  const apiMode = getApiMode();

  let db: DataStore;
  if (apiMode === StacksApiMode.offline) {
    db = OfflineDummyStore;
  } else {
    switch (process.env['STACKS_BLOCKCHAIN_API_DB']) {
      case 'memory': {
        logger.info('using in-memory db');
        db = new MemoryDataStore();
        break;
      }
      case 'pg':
      case undefined: {
        const skipMigrations = apiMode === StacksApiMode.readOnly;
        db = await PgDataStore.connect(skipMigrations);
        break;
      }
      default: {
        throw new Error(
          `Invalid STACKS_BLOCKCHAIN_API_DB option: "${process.env['STACKS_BLOCKCHAIN_API_DB']}"`
        );
      }
    }

    if (apiMode !== StacksApiMode.readOnly) {
      if (db instanceof PgDataStore) {
        if (isProdEnv) {
          await importV1TokenOfferingData(db);
        } else {
          logger.warn(
            `Notice: skipping token offering data import because of non-production NODE_ENV`
          );
        }
        if (isProdEnv && !process.env.BNS_IMPORT_DIR) {
          logger.warn(`Notice: full BNS functionality requires 'BNS_IMPORT_DIR' to be set.`);
        } else if (process.env.BNS_IMPORT_DIR) {
          await importV1BnsData(db, process.env.BNS_IMPORT_DIR);
        }
      }

      const configuredChainID = getConfiguredChainID();

      const eventServer = await startEventServer({
        datastore: db,
        chainId: configuredChainID,
      });
      registerShutdownConfig({
        name: 'Event Server',
        handler: () => eventServer.closeAsync(),
        forceKillable: false,
      });

      const networkChainId = await getCoreChainID();
      if (networkChainId !== configuredChainID) {
        const chainIdConfig = numberToHex(configuredChainID);
        const chainIdNode = numberToHex(networkChainId);
        const error = new Error(
          `The configured STACKS_CHAIN_ID does not match, configured: ${chainIdConfig}, stacks-node: ${chainIdNode}`
        );
        logError(error.message, error);
        throw error;
      }
      monitorCoreRpcConnection().catch(error => {
        logger.error(`Error monitoring RPC connection: ${error}`, error);
      });

      if (isFtMetadataEnabled() || isNftMetadataEnabled()) {
        const tokenMetadataProcessor = new TokensProcessorQueue(db, configuredChainID);
        registerShutdownConfig({
          name: 'Token Metadata Processor',
          handler: () => tokenMetadataProcessor.close(),
          forceKillable: true,
        });
        // check if db has any non-processed token queues and await them all here
        await tokenMetadataProcessor.drainDbQueue();
      }
    }
  }

  if (apiMode !== StacksApiMode.writeOnly) {
    const apiServer = await startApiServer({ datastore: db, chainId: getConfiguredChainID() });
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

  registerShutdownConfig({
    name: 'DB',
    handler: () => db.close(),
    forceKillable: false,
  });

  if (isProdEnv) {
    const prometheusServer = await createPrometheusServer({ port: 9153 });
    logger.info(`@promster/server started on port 9153.`);
    const sockets = new Set<Socket>();
    prometheusServer.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    registerShutdownConfig({
      name: 'Prometheus',
      handler: async () => {
        for (const socket of sockets) {
          socket.destroy();
          sockets.delete(socket);
        }
        await Promise.resolve(prometheusServer.close());
      },
      forceKillable: true,
    });
  }
}

function initApp() {
  init()
    .then(() => {
      logger.info('App initialized');
    })
    .catch(error => {
      logError(`app failed to start: ${error}`, error);
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
          ['wipe-db']?: boolean;
          ['force']?: boolean;
        };
      };
  return { args, parsedOpts };
}

async function handleProgramArgs() {
  const { args, parsedOpts } = getProgramArgs();
  if (args.operand === 'export-events') {
    if (!args.options.file) {
      throw new Error(`A file path should be specified with the --file option`);
    }
    const filePath = path.resolve(args.options.file);
    if (fs.existsSync(filePath) && args.options['overwrite-file'] !== true) {
      throw new Error(
        `A file already exists at ${filePath}. Add --overwrite-file to truncate an existing file`
      );
    }
    console.log(`Export event data to file: ${filePath}`);
    const writeStream = fs.createWriteStream(filePath);
    console.log(`Export started...`);
    await PgDataStore.exportRawEventRequests(writeStream);
    console.log('Export successful.');
  } else if (args.operand === 'import-events') {
    if (!args.options.file) {
      throw new Error(`A file path should be specified with the --file option`);
    }
    const filePath = path.resolve(args.options.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    const hasData = await PgDataStore.containsAnyRawEventRequests();
    if (!args.options['wipe-db'] && hasData) {
      throw new Error(
        `Database contains existing data. Add --wipe-db to drop the existing tables.`
      );
    }

    if (args.options['force']) {
      await dangerousDropAllTables({ acknowledgePotentialCatastrophicConsequences: 'yes' });
    }

    // This performs a "migration down" which drops the tables, then re-creates them.
    // If there's a breaking change in the migration files, this will throw, and the pg database needs wiped manually,
    // or the `--force` option can be used.
    await cycleMigrations({ dangerousAllowDataLoss: true });

    const db = await PgDataStore.connect(true, false, true);
    const eventServer = await startEventServer({
      datastore: db,
      chainId: getConfiguredChainID(),
      serverHost: '127.0.0.1',
      serverPort: 0,
      httpLogLevel: 'debug',
    });

    const readStream = fs.createReadStream(filePath);
    const rawEventsIterator = PgDataStore.getRawEventRequests(readStream, status => {
      console.log(status);
    });
    // Set logger to only output for warnings/errors, otherwise the event replay will result
    // in the equivalent of months/years of API log output.
    logger.level = 'warn';
    // Disable this feature so a redundant export file isn't created while importing from an existing one.
    delete process.env['STACKS_EXPORT_EVENTS_FILE'];
    for await (const rawEvents of rawEventsIterator) {
      for (const rawEvent of rawEvents) {
        await httpPostRequest({
          host: '127.0.0.1',
          port: eventServer.serverAddress.port,
          path: rawEvent.event_path,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(rawEvent.payload, 'utf8'),
          throwOnNotOK: true,
        });
      }
    }
    await db.finishEventReplay();
    console.log(`Event import and playback successful.`);
    await eventServer.closeAsync();
    await db.close();
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
