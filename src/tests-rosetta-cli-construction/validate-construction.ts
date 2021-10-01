import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbBlock, DbMempoolTx, DbTx, DbTxStatus } from '../datastore/common';
import { ChainID, makeSTXTokenTransfer } from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
import * as BN from 'bn.js';
import * as fs from 'fs';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../core-rpc/client';
import * as compose from 'docker-compose';
import * as path from 'path';
import Docker = require('dockerode');

const docker = new Docker();

const sender1 = {
  address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
  privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
};

const recipientAdd1 = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';

const HOST = 'localhost';
const PORT = 20443;
const stacksNetwork = GetStacksTestnetNetwork();

const isContainerRunning = async (name: string): Promise<boolean> =>
  new Promise((resolve, reject): void => {
    docker.listContainers((err: any, containers: any): void => {
      if (err) {
        reject(err);
      }

      const running = (containers || []).filter((container: any): boolean =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        container.Names.includes(name)
      );

      resolve(running.length > 0);
    });
  });

describe('Rosetta API', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: Server;
  let api: ApiServer;
  let rosettaOutput: any;

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

    // remove previous outputs if any
    fs.rmdirSync('rosetta-output-construction', { recursive: true });

    // build rosetta-cli container
    await compose.buildOne('rosetta-cli', {
      cwd: path.join(__dirname, '../../'),
      log: true,
      composeOptions: [
        '-f',
        'docker-compose.dev.rosetta-cli.yml',
        '--env-file',
        'env.construction',
      ],
    });
    // start cli container
    void compose.upOne('rosetta-cli', {
      cwd: path.join(__dirname, '../../'),
      log: true,
      composeOptions: [
        '-f',
        'docker-compose.dev.rosetta-cli.yml',
        '--env-file',
        'env.construction',
      ],
      commandOptions: ['--abort-on-container-exit'],
    });

    await waitForBlock(api);
    // await sleep(10000);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);

    // wait for rosetta-cli to exit
    let check = true;
    while (check) {
      // todo: remove hardcoded container name with dynamic
      check = await isContainerRunning('/stacks-blockchain-api_rosetta-cli_1');
      await sleep(1000);
    }

    rosettaOutput = require('../../rosetta-output-construction/rosetta-cli-output-const.json');
  });

  it('check transaction confirmed', () => {
    expect(rosettaOutput.stats.transactions_confirmed).toBeGreaterThan(1);
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});

async function transferStx(
  recipientAddr: string,
  amount: number,
  senderPk: string,
  api: ApiServer
) {
  await waitForBlock(api);
  const transferTx = await makeSTXTokenTransfer({
    recipient: recipientAddr,
    amount: new BN(amount),
    senderKey: senderPk,
    network: stacksNetwork,
    memo: 'test-transaction',
    sponsored: false,
  });
  const serialized: Buffer = transferTx.serialize();

  const { txId } = await sendCoreTx(serialized, api, 'transfer-stx');
  await standByForTx(txId, api);

  return txId;
}

function standByForTx(expectedTxId: string, api: ApiServer): Promise<string> {
  const broadcastTx = new Promise<string>(resolve => {
    const listener: (info: string) => void = info => {
      api.datastore.removeListener('txUpdate', listener);
      resolve(info);
    };
    api.datastore.addListener('txUpdate', listener);
  });

  return broadcastTx;
}

async function sendCoreTx(
  serializedTx: Buffer,
  api: ApiServer,
  type: string
): Promise<{ txId: string }> {
  try {
    const submitResult = await new StacksCoreRpcClient({
      host: HOST,
      port: PORT,
    }).sendTransaction(serializedTx);
    return submitResult;
  } catch (error) {
    console.log(type);
    console.error(error);
  }
  return Promise.resolve({ txId: '' });
}

export function GetStacksTestnetNetwork() {
  const stacksNetwork = new StacksTestnet();
  stacksNetwork.coreApiUrl = getCoreNodeEndpoint({
    host: `http://${HOST}`,
    port: PORT,
  });
  return stacksNetwork;
}

async function waitForBlock(api: ApiServer) {
  await new Promise<string>(resolve => api.datastore.once('blockUpdate', block => resolve(block)));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
