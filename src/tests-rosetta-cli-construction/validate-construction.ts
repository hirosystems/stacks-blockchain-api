import { ApiServer, startApiServer } from '../api/init';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import {
  AnchorMode,
  ChainID,
  StacksTransaction,
  getAddressFromPrivateKey,
  makeSTXTokenTransfer,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
import * as fs from 'fs';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../core-rpc/client';
import { v2 as compose } from 'docker-compose';
import * as path from 'path';
import { PgWriteStore } from '../datastore/pg-write-store';
import { NonceJar, migrate, standByForTxSuccess } from '../test-utils/test-helpers';
import { timeout } from '@hirosystems/api-toolkit';

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
  let nonceJar: NonceJar;

  beforeAll(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests' });
    eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
    const client = new StacksCoreRpcClient();
    nonceJar = new NonceJar(api, client);

    await client.waitForConnection(60000);

    // build rosetta-cli container
    const composeBuildResult = await compose.buildOne('rosetta-cli', {
      cwd: path.join(__dirname, '../../'),
      log: true,
      composeOptions: [
        '-f',
        'docker/docker-compose.dev.rosetta-cli.yml',
        '--env-file',
        'src/tests-rosetta-cli-construction/envs/env.construction',
      ],
    });
    console.log('compose build result:', composeBuildResult);

    await waitForBlock(api);

    let txs: string[] = [
      await transferStx(recipientAdd1, 1000000000, sender1.privateKey, nonceJar),
      await transferStx(recipientAdd1, 1000000000, sender1.privateKey, nonceJar),
      await transferStx(recipientAdd1, 1000000000, sender1.privateKey, nonceJar),
      await transferStx(recipientAdd1, 1000000000, sender1.privateKey, nonceJar),
      await transferStx(recipientAdd1, 1000000000, sender1.privateKey, nonceJar),
    ];

    for (const tx of txs) {
      await standByForTxSuccess(tx, api);
      console.log('one success');
    }
    txs = [];
  });

  it('run rosetta-cli tool', async () => {
    // start cli container
    const upResult = await compose.upOne('rosetta-cli', {
      cwd: path.join(__dirname, '../../'),
      log: true,
      composeOptions: [
        '-f',
        'docker/docker-compose.dev.rosetta-cli.yml',
        '--env-file',
        'src/tests-rosetta-cli-construction/envs/env.construction',
      ],
      commandOptions: ['--abort-on-container-exit', '--force-recreate'],
      callback: (chunk, source) => {
        if (source === 'stderr') {
          console.error(`compose up stderr: ${chunk.toString()}`);
        } else {
          console.log(`compose up stdout: ${chunk.toString()}`);
        }
      },
    });
    console.log(upResult);

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
    const composeDownResult = await compose
      .stopOne('rosetta-cli', {
        cwd: path.join(__dirname, '../../'),
        log: true,
        composeOptions: [
          '-f',
          'docker/docker-compose.dev.rosetta-cli.yml',
          '--env-file',
          'src/tests-rosetta-cli-construction/envs/env.construction',
        ],
      })
      .catch(error => {
        console.error(`compose down error: ${error}`, error);
      });
    console.log('compose down result:', composeDownResult);

    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
    await db?.close();
    await migrate('down');
  });
});

async function transferStx(
  recipientAddr: string,
  amount: number,
  senderPk: string,
  nonceJar: NonceJar
) {
  const senderAddress = getAddressFromPrivateKey(senderPk, stacksNetwork.version);
  const { txId } = await sendCoreTx(senderAddress, nonceJar, async nonce => {
    return await makeSTXTokenTransfer({
      recipient: recipientAddr,
      amount: amount,
      senderKey: senderPk,
      network: stacksNetwork,
      memo: 'test-transaction',
      sponsored: false,
      anchorMode: AnchorMode.Any,
      fee: 100000,
      nonce,
    });
  });

  return txId;
}

async function sendCoreTx(
  address: string,
  nonceJar: NonceJar,
  buildTx: (nonce: number) => Promise<StacksTransaction>
): Promise<{
  txId: string;
}> {
  const nonceResult = await nonceJar.getNonce(address);
  const tx = await buildTx(nonceResult);
  const serializedTx = Buffer.from(tx.serialize());
  const submitResult = await new StacksCoreRpcClient({
    host: HOST,
    port: PORT,
  })
    .sendTransaction(serializedTx)
    .catch(error => {
      console.error(`Tx broadcast error: ${error}`, error);
      throw error;
    });
  return submitResult;
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
