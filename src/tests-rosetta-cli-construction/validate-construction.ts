import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { AnchorMode, ChainID, makeSTXTokenTransfer } from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
import * as fs from 'fs';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../core-rpc/client';
import { timeout } from '../helpers';
import * as compose from 'docker-compose';
import * as path from 'path';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';

const sender1 = {
  address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
  privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
};

const recipientAdd1 = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';

const HOST = 'localhost';
const PORT = 20443;
const stacksNetwork = GetStacksTestnetNetwork();

describe('Rosetta API', () => {
  let db: PgWriteStore;
  let eventServer: Server;
  let api: ApiServer;
  let rosettaOutput: any;

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests' });
    eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

    // build rosetta-cli container
    await compose.buildOne('rosetta-cli', {
      cwd: path.join(__dirname, '../../'),
      log: true,
      composeOptions: [
        '-f',
        'docker/docker-compose.dev.rosetta-cli.yml',
        '--env-file',
        'src/tests-rosetta-cli-construction/envs/env.construction',
      ],
    });
    // start cli container
    void compose.upOne('rosetta-cli', {
      cwd: path.join(__dirname, '../../'),
      log: true,
      composeOptions: [
        '-f',
        'docker/docker-compose.dev.rosetta-cli.yml',
        '--env-file',
        'src/tests-rosetta-cli-construction/envs/env.construction',
      ],
      commandOptions: ['--abort-on-container-exit'],
    });

    await waitForBlock(api);

    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);
    await transferStx(recipientAdd1, 1000000000, sender1.privateKey, api);

    // Wait on rosetta-cli to finish output
    while (!rosettaOutput) {
      if (fs.existsSync('docker/rosetta-output-construction/rosetta-cli-output-const.json')) {
        rosettaOutput = require('../../docker/rosetta-output-construction/rosetta-cli-output-const.json');
      } else {
        await timeout(1000);
      }
    }
  });

  it('check transaction confirmed', () => {
    expect(rosettaOutput.stats.transactions_confirmed).toBeGreaterThan(1);
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
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
    amount: amount,
    senderKey: senderPk,
    network: stacksNetwork,
    memo: 'test-transaction',
    sponsored: false,
    anchorMode: AnchorMode.Any,
    fee: 100000,
  });
  const serialized: Buffer = Buffer.from(transferTx.serialize());

  const { txId } = await sendCoreTx(serialized, api, 'transfer-stx');
  await standByForTx(txId, api);

  return txId;
}

function standByForTx(expectedTxId: string, api: ApiServer): Promise<string> {
  const broadcastTx = new Promise<string>(resolve => {
    const listener: (info: string) => void = info => {
      api.datastore.eventEmitter.removeListener('txUpdate', listener);
      resolve(info);
    };
    api.datastore.eventEmitter.addListener('txUpdate', listener);
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

function GetStacksTestnetNetwork() {
  const url = getCoreNodeEndpoint({
    host: `http://${HOST}`,
    port: PORT,
  });
  const stacksNetwork = new StacksTestnet({ url });
  return stacksNetwork;
}

async function waitForBlock(api: ApiServer) {
  await new Promise<string>(resolve =>
    api.datastore.eventEmitter.once('blockUpdate', block => resolve(block))
  );
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
