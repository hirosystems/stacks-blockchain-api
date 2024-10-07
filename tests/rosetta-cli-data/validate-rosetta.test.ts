import { ApiServer, startApiServer } from '../../src/api/init';
import {
  makeSTXTokenTransfer,
  makeContractDeploy,
  PostConditionMode,
  makeContractCall,
  ClarityValue,
  getAddressFromPrivateKey,
  getAbi,
  ClarityAbi,
  encodeClarityValue,
  ChainID,
  AnchorMode,
  StacksTransaction,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
import * as fs from 'fs';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../../src/core-rpc/client';
import { unwrapOptional } from '../../src/helpers';
import { v2 as compose } from 'docker-compose';
import * as path from 'path';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server';
import { NonceJar, migrate, standByForTxSuccess } from '../utils/test-helpers';
import { timeout } from '@hirosystems/api-toolkit';

const sender1 = {
  address: 'STF9B75ADQAVXQHNEQ6KGHXTG7JP305J2GRWF3A2',
  privateKey: 'ce109fee08860bb16337c76647dcbc02df0c06b455dd69bcf30af74d4eedd19301',
};
const sender2 = {
  address: 'ST18MDW2PDTBSCR1ACXYRJP2JX70FWNM6YY2VX4SS',
  privateKey: '08c14a1eada0dd42b667b40f59f7c8dedb12113613448dc04980aea20b268ddb01',
};

const sender3 = {
  address: 'ST1DTAEAKM02GKCT4NGKTVER8MTJJHYQ9NT27E677',
  privateKey: 'fdab825d3a12ca73d24c0b446eda8639605025450a4bf6716a2627121c594d0a01',
};

const senders = [sender1, sender2, sender3];

const recipientAdd1 = 'ST3KTZ45AQES4PNNHB2YGGJ4JXQQMRACRNZPQ19SP';
const recipientAdd2 = 'ST17ZNMSQMDARSCZ85Z7BVJX6T20ZWDF3VX0ZP33K';
const recipientAdd3 = 'ST3DR3THSKSWRH10SEDFFP3D90KZYG57J5N8M9KR9';
const recipientPk3 = '3af9b0b442389252c61db56233a2267cd242cc9f8a3284ae64808784c684c4ef01';
const recipientAdd4 = 'ST3WHD5WEKHENA38T9BWZK9M0SDXA46T9DQT0ZDTY';
const recipientAdd5 = 'ST2WZKZVZRJJMT2RJPWWM9FVC20S9R30CNVMJEX0H';
const recipientAdd6 = 'STFHWET10QDAQ8B88WNAVEV15XVNWNNCTMQGD5KN';
const recipientAdd7 = 'ST3YFNTA33A14NYTE0P85790E2X7Y890SD24K8WAK';
const recipientAdd8 = 'ST367HN911AFQ666829M2C6XP0HPMSTT517B5FMNB';
const recipientAdd9 = 'STN5W5SAFHVWS9P6BDMVJQZWQGCAHQBPXQYKKCCW';
const recipientAdd10 = 'ST5WDT0C4995DWA3H7YDKYM0NK4QNADR4T93HYD1';
const recipientAdd11 = 'ST1JBBKAPX6XDGR9TEGQTNVV2H4NJX456FKRJ5QWA';
const recipientAdd12 = 'ST3T6ERPJ2TXPQ668747Z52P4EJBYY966SVFM7W8X';
const recipientAdd13 = 'ST2Y60MJ5CPGEN1CP405H7X8CPCEYV2FJ0PHZ742P';
const recipientAdd14 = 'STAXJZ26VDBNA5TVJRJ63SV77C1AWW786X84V634';
const recipientAdd15 = 'ST3Q362NAVV3W6T1GV0XH78JJJ0BKZREHR6C168TV';
const recipientAdd16 = 'ST16EDNWEW80AX2737KA58SJZQ8QNW7DXKTDBBVCV';
const recipientAdd17 = 'ST3VHZ1ETEB0D7V27TCB5BB9YVQVWPQJHJG5Y6ARH';
const recipientAdd18 = 'ST2NC3GSVB511TPCBDKB4PRA6VJHYNSGH93756H1M';
const recipientAdd19 = 'ST11QXGG0SRPC5QYESX3WA55BKQWWMPV7CSWKG6SN';
const recipientAdd20 = 'STJ5PW80NKC6NJ0J87YWXYNGE474RN38K2B4YW1R';

const recipients = [
  recipientAdd1,
  recipientAdd2,
  recipientAdd3,
  recipientAdd4,
  recipientAdd5,
  recipientAdd6,
  recipientAdd7,
  recipientAdd8,
  recipientAdd9,
  recipientAdd10,
  recipientAdd11,
  recipientAdd12,
  recipientAdd13,
  recipientAdd14,
  recipientAdd15,
  recipientAdd16,
  recipientAdd17,
  recipientAdd18,
  recipientAdd19,
  recipientAdd20,
];

const contracts: string[] = [];

const HOST = 'localhost';
const PORT = 20443;
const stacksNetwork = getStacksTestnetNetwork();

describe('Rosetta API', () => {
  let db: PgWriteStore;
  let eventServer: EventStreamServer;
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
        'tests/rosetta-cli-data/envs/env.data',
      ],
    });
    console.log('compose build result:', composeBuildResult);

    await waitForBlock(api);

    let txs: string[] = [];
    for (const addr of recipients) {
      const tx1 = await transferStx(addr, 1000, sender1.privateKey, nonceJar);
      const tx2 = await transferStx(addr, 1000, sender2.privateKey, nonceJar);
      const tx3 = await transferStx(sender3.address, 6000, sender1.privateKey, nonceJar);
      txs.push(tx1, tx2, tx3);
    }

    for (const tx of txs) {
      await standByForTxSuccess(tx, api);
      console.log('one success');
    }
    txs = [];

    for (const sender of senders) {
      const response = await deployContract(
        sender.privateKey,
        'tests/rosetta-cli-data/contracts/hello-world.clar',
        nonceJar
      );
      contracts.push(response.contractId);
      txs.push(response.txId);
    }

    for (const tx of txs) {
      await standByForTxSuccess(tx, api);
    }
    txs = [];

    for (const contract of contracts) {
      const tx1 = await callContractFunction(api, nonceJar, sender1.privateKey, contract, 'say-hi');
      const tx2 = await callContractFunction(api, nonceJar, sender2.privateKey, contract, 'say-hi');
      txs.push(tx1, tx2);
    }

    for (const tx of txs) {
      await standByForTxSuccess(tx, api);
    }
    txs = [];
  });

  it('run rosetta-cli tool', async () => {
    // start cli container
    const composeUpResult = await compose
      .upOne('rosetta-cli', {
        cwd: path.join(__dirname, '../../'),
        log: true,
        composeOptions: [
          '-f',
          'docker/docker-compose.dev.rosetta-cli.yml',
          '--env-file',
          'tests/rosetta-cli-data/envs/env.data',
        ],
        commandOptions: ['--abort-on-container-exit', '--force-recreate'],
        callback: (chunk, source) => {
          if (source === 'stderr') {
            console.error(`compose up stderr: ${chunk.toString()}`);
          } else {
            console.log(`compose up stdout: ${chunk.toString()}`);
          }
        },
      })
      .catch(error => {
        console.error(`compose up error: ${error}`, error);
        throw error;
      });
    console.log(composeUpResult);

    // Wait on rosetta-cli to finish output
    while (!rosettaOutput) {
      if (fs.existsSync('docker/rosetta-output/rosetta-cli-output.json')) {
        rosettaOutput = require('../../docker/rosetta-output/rosetta-cli-output.json');
      } else {
        await timeout(1000);
      }
    }
  });

  it('check request/response', () => {
    return expect(rosettaOutput.tests.request_response).toBeTruthy();
  });

  it('check all responses are correct', () => {
    return expect(rosettaOutput.tests.response_assertion).toBeTruthy();
  });

  it('check blocks are connected', () => {
    return expect(rosettaOutput.tests.block_syncing).toBeTruthy();
  });

  it('check negative account balance', () => {
    return expect(rosettaOutput.tests.balance_tracking).toBeTruthy();
  });

  it('check reconciliation', () => {
    return expect(rosettaOutput.tests.reconciliation).toBeTruthy();
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
          'tests/rosetta-cli-data/envs/env.data',
        ],
      })
      .catch(error => {
        console.error(`compose down error: ${error}`, error);
      });
    console.log('compose down result:', composeDownResult);

    await new Promise<void>(resolve => eventServer.close(() => resolve()));
    await api.terminate();
    await db?.close();
    await migrate('down');
  });
});

async function callContractFunction(
  api: ApiServer,
  nonceJar: NonceJar,
  senderPk: string,
  contractId: string,
  functionName: string,
  ...functionArgs: string[]
) {
  await waitForBlock(api);
  const [contractAddr, contractName] = contractId.split('.');

  const contractAbi: ClarityAbi = await getAbi(contractAddr, contractName, stacksNetwork);
  const abiFunction = contractAbi.functions.find(fn => fn.name === functionName);
  if (abiFunction === undefined) {
    throw new Error(`Contract ${contractId} ABI does not have function "${functionName}"`);
  }
  const clarityValueArgs: ClarityValue[] = new Array(abiFunction.args.length);
  for (let i = 0; i < clarityValueArgs.length; i++) {
    const abiArg = abiFunction.args[i];
    const stringArg = unwrapOptional(functionArgs[i]);
    const clarityVal = encodeClarityValue(abiArg.type, stringArg);
    clarityValueArgs[i] = clarityVal;
  }

  const senderAddress = getAddressFromPrivateKey(senderPk, stacksNetwork.version);
  const { txId } = await sendCoreTx(senderAddress, nonceJar, async nonce => {
    return await makeContractCall({
      contractAddress: contractAddr,
      contractName: contractName,
      functionName: functionName,
      functionArgs: clarityValueArgs,
      senderKey: senderPk,
      network: stacksNetwork,
      postConditionMode: PostConditionMode.Allow,
      sponsored: false,
      anchorMode: AnchorMode.Any,
      fee: 100000,
      nonce,
    });
  });

  return txId;
}

async function deployContract(senderPk: string, sourceFile: string, nonceJar: NonceJar) {
  // await waitForBlock(api);
  const contractName = `test-contract-${uniqueId()}`;
  const senderAddress = getAddressFromPrivateKey(senderPk, stacksNetwork.version);
  const source = fs.readFileSync(sourceFile).toString();
  const normalized_contract_source = source.replace(/\r/g, '').replace(/\t/g, ' ');

  const { txId } = await sendCoreTx(senderAddress, nonceJar, async nonce => {
    return await makeContractDeploy({
      contractName: contractName,
      codeBody: normalized_contract_source,
      senderKey: senderPk,
      network: stacksNetwork,
      postConditionMode: PostConditionMode.Allow,
      sponsored: false,
      anchorMode: AnchorMode.Any,
      fee: 100000,
      nonce,
    });
  });

  const contractId = senderAddress + '.' + contractName;
  return { txId, contractId };
}
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

function getStacksTestnetNetwork() {
  const url = getCoreNodeEndpoint({
    host: `http://${HOST}`,
    port: PORT,
  });
  const stacksNetwork = new StacksTestnet({ url });
  return stacksNetwork;
}

function uniqueId() {
  return Math.random().toString(16).slice(-4);
}

async function waitForBlock(api: ApiServer) {
  await new Promise<string>(resolve =>
    api.datastore.eventEmitter.once('blockUpdate', blockHash => resolve(blockHash))
  );
}
