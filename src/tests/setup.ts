import * as WebSocket from 'ws';
import { loadDotEnv } from '../helpers';
import { startEventServer } from '../event-stream/event-server';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { ChainID } from '@stacks/transactions';
import { PgDataStore } from '../datastore/postgres-store';

// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  const db = await PgDataStore.connect(true);
  const server = await startEventServer({
    chainId: ChainID.Testnet,
    datastore: db,
    messageHandler: {
      handleBlockMessage: () => {},
      handleBurnBlock: () => {},
      handleMempoolTxs: () => {},
      handleDroppedMempoolTxs: () => {},
      handleNewAttachment: () => {},
      handleRawEventRequest: () => {},
      handleMicroblockMessage: () => {},
    },
    httpLogLevel: 'silly',
  });
  Object.assign(global, { server: server, db: db });
  console.log('Waiting for RPC connection to core node..');
  await new StacksCoreRpcClient().waitForConnection(60000);
  console.log('Jest - setup done');
};
