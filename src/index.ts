import { loadDotEnv, timeout, logger, logError } from './helpers';
import { DataStore } from './datastore/common';
import { PgDataStore } from './datastore/postgres-store';
import { MemoryDataStore } from './datastore/memory-store';
import { startApiServer } from './api/init';
import { startEventServer } from './event-stream/event-server';
import { StacksCoreRpcClient } from './core-rpc/client';

loadDotEnv();

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

async function init(): Promise<void> {
  let db: DataStore;
  switch (process.env['STACKS_SIDECAR_DB']) {
    case 'memory': {
      logger.info('using in-memory db');
      db = new MemoryDataStore();
      break;
    }
    case 'pg':
    case undefined: {
      db = await PgDataStore.connect();
      break;
    }
    default: {
      throw new Error(`invalid STACKS_SIDECAR_DB option: "${process.env['STACKS_SIDECAR_DB']}"`);
    }
  }
  await startEventServer(db);
  monitorCoreRpcConnection().catch(error => {
    logger.error(`Error monitoring RPC connection: ${error}`, error);
  });
  const apiServer = await startApiServer(db);
  logger.info(`API server listening on: http://${apiServer.address}`);
}

init()
  .then(() => {
    logger.info('App initialized');
  })
  .catch(error => {
    logError(`app failed to start: ${error}`, error);
    process.exit(1);
  });
