import * as net from 'net';
import { Readable } from 'stream';
import { readMessageFromStream, parseMessageTransactions } from './event-stream/reader';
import { CoreNodeMessage } from './event-stream/core-node-message';
import { loadDotEnv, jsonStringify } from './helpers';
import { DataStore } from './datastore/common';
import { PgDataStore } from './datastore/postgres-store';
import { MemoryDataStore } from './datastore/memory-store';

loadDotEnv();

async function handleClientMessage(clientSocket: Readable, db: DataStore): Promise<void> {
  let msg: CoreNodeMessage;
  try {
    msg = await readMessageFromStream(clientSocket);
    if (msg.events.length > 0) {
      console.log('got events');
    }
  } catch (error) {
    console.error(`error reading messages from socket: ${error}`);
    console.error(error);
    clientSocket.destroy();
    return;
  }
  const parsedMsg = parseMessageTransactions(msg);
  // const stringified = jsonStringify(parsedMsg);
  // console.log(stringified);
  await db.updateBlock({ ...parsedMsg, canonical: true });
}

async function startEventSocketServer(db: DataStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(clientSocket => {
      console.log('client connected');
      handleClientMessage(clientSocket, db).catch(error => {
        console.error(`error processing socket connection: ${error}`);
        console.error(error);
      });
      clientSocket.on('end', () => {
        console.log('client disconnected');
      });
    });
    server.on('error', error => {
      console.error(`socket server error: ${error}`);
      reject(error);
    });
    server.listen(3700, () => {
      const addr = server.address();
      if (addr === null) {
        throw new Error('server missing address');
      }
      const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
      console.log(`server listening at ${addrStr}`);
      resolve();
    });
  });
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
  await startEventSocketServer(db);
}

init()
  .then(() => {
    console.log('app started');
  })
  .catch(error => {
    console.error(`app failed to start: ${error}`);
    console.error(error);
    process.exit(1);
  });
