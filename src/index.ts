import watch from 'node-watch';
import { exec } from 'child_process';
import { loadDotEnv, timeout } from './helpers';
import { DataStore } from './datastore/common';
import { PgDataStore } from './datastore/postgres-store';
import { MemoryDataStore } from './datastore/memory-store';
import { startApiServer } from './api/init';
import { startEventServer } from './event-stream/event-server';
import { StacksCoreRpcClient } from './core-rpc/client';

loadDotEnv();

const compileSchemas = process.argv.includes('--compile-schemas');
const generateSchemas = () => exec('npm run generate:schemas');

if (compileSchemas) {
  watch('./docs', { recursive: true, filter: /\.schema\.json$/ }, () => generateSchemas());
}

async function monitorCoreRpcConnection(): Promise<void> {
  let previouslyConnected = false;
  while (true) {
    const client = new StacksCoreRpcClient();
    try {
      await client.waitForConnection();
      if (!previouslyConnected) {
        console.log(`Connection to Stacks core node API server at: ${client.endpoint}`);
      }
      previouslyConnected = true;
    } catch (error) {
      previouslyConnected = false;
      console.error(`Warning: failed to connect to node RPC server at ${client.endpoint}`);
      await timeout(5000);
    }
  }
}

async function init(): Promise<void> {
  let db: DataStore;
  switch (process.env['STACKS_SIDECAR_DB']) {
    case 'memory': {
      console.log('using in-memory db');
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
    console.error(`Error monitoring RPC connection: ${error}`);
    console.error(error);
  });
  const apiServer = await startApiServer(db);
  console.log(`API server listening on: http://${apiServer.address}`);
}

init()
  .then(() => {
    console.log('App initialized');
  })
  .catch(error => {
    console.error(`app failed to start: ${error}`);
    console.error(error);
    process.exit(1);
  });
