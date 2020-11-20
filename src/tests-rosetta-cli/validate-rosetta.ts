import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import fetch from 'node-fetch';
import * as os from 'os';
import * as tar from 'tar';
import * as stream from 'stream';
import * as util from 'util';
import * as childProcess from 'child_process';
import { DbBlock } from '../datastore/common';
import {
  encodeClarityValue,
  makeSTXTokenTransfer,
  makeContractDeploy,
  PostConditionMode,
  makeContractCall,
  ClarityValue,
  ClarityAbi,
  StacksTestnet,
  getAddressFromPrivateKey,
  getAbi,
  estimateContractFunctionCall,
} from '@blockstack/stacks-transactions';
import * as BN from 'bn.js';
import * as fs from 'fs';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../core-rpc/client';
import { assertNotNullish } from '../helpers';
import * as path from 'path';

const pipeline = util.promisify(stream.pipeline);

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
const URL = `http://${HOST}:${PORT}`;

const stacksNetwork = GetStacksTestnetNetwork();

const ROSETTA_CLI_VERSION = '0.5.10';
const ROSETTA_CLI_URL =
  'https://github.com/coinbase/rosetta-cli/releases/download/v{version}/rosetta-cli-{version}-{platform}-{arch}.tar.gz';

async function execRosettaCli(options: {
  args: string[];
  cwd: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const platform = (() => {
    switch (os.platform()) {
      case 'win32':
        return 'windows';
      default:
        return os.platform();
    }
  })();
  const arch = (() => {
    switch (os.arch()) {
      case 'x64':
        return 'amd64';
      default:
        return os.arch();
    }
  })();
  const fetchUrl = ROSETTA_CLI_URL.replace(/{version}/g, ROSETTA_CLI_VERSION)
    .replace(/{platform}/g, platform)
    .replace(/{arch}/g, arch);
  const resp = await fetch(fetchUrl, { redirect: 'follow' });
  if (!resp.ok) {
    throw new Error(`Error ${resp.status} ${resp.statusText} fetching ${fetchUrl}`);
  }
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacks-rosetta-'));
  await pipeline(resp.body, tar.x({ cwd: outputDir }));

  let filePath = fs.readdirSync(outputDir).filter(f => f.startsWith('rosetta-cli'))[0];
  filePath = path.join(outputDir, filePath);
  const process = childProcess.spawn(filePath, options.args, { cwd: options.cwd });
  let stdout = '';
  let stderr = '';
  process.stdout.on('data', d => (stdout += d));
  process.stderr.on('data', d => (stderr += d));
  return new Promise((resolve, reject) => {
    process.on('error', error => reject(error));
    process.on('close', code => resolve({ stdout, stderr, exitCode: code }));
  });
}

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
    eventServer = await startEventServer({ db });
    api = await startApiServer(db);

    // remove previous outputs if any
    fs.rmdirSync('rosetta-cli-config/rosetta-output', { recursive: true });
    fs.mkdirSync('rosetta-cli-config/rosetta-output');

    const rosettaConfigFile = path.resolve('rosetta-cli-config/rosetta-config-docker.json');
    // const rosettaConfigFile = path.resolve('rosetta-cli-config/rosetta-config-native.json');
    const rosettaCwd = path.resolve('rosetta-cli-config');
    const rosettaCliContainerPromise = execRosettaCli({
      cwd: rosettaCwd,
      args: ['--configuration-file', rosettaConfigFile, 'check:data'],
    })
      .then(r => {
        console.log(r);
      })
      .catch(e => {
        console.error(e);
      });

    await waitForBlock(api);

    for (const addr of recipients) {
      await transferStx(addr, 1000, sender1.privateKey, api);
      await transferStx(addr, 1000, sender2.privateKey, api);
      await transferStx(sender3.address, 6000, sender1.privateKey, api);
    }

    for (const sender of senders) {
      const response = await deployContract(
        sender.privateKey,
        'src/tests-rosetta-cli/contracts/hello-world.clar',
        api
      );
      contracts.push(response.contractId);
    }

    for (const contract of contracts) {
      await callContractFunction(api, sender1.privateKey, contract, 'say-hi');
      await callContractFunction(api, sender2.privateKey, contract, 'say-hi');
    }

    // wait for rosetta-cli to exit
    await rosettaCliContainerPromise;

    rosettaOutput = require('../../rosetta-cli-config/rosetta-output/rosetta-cli-output.json');
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
    await new Promise(resolve => eventServer.close(() => resolve()));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});

async function callContractFunction(
  api: ApiServer,
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
    const stringArg = assertNotNullish(functionArgs[i]);
    const clarityVal = encodeClarityValue(abiArg.type, stringArg);
    clarityValueArgs[i] = clarityVal;
  }

  const contractCallTx = await makeContractCall({
    contractAddress: contractAddr,
    contractName: contractName,
    functionName: functionName,
    functionArgs: clarityValueArgs,
    senderKey: senderPk,
    network: stacksNetwork,
    postConditionMode: PostConditionMode.Allow,
    sponsored: false,
  });
  const fee = await estimateContractFunctionCall(contractCallTx, stacksNetwork);
  contractCallTx.setFee(fee);

  const serialized: Buffer = contractCallTx.serialize();

  const { txId } = await sendCoreTx(serialized, api, 'call-contract-func');
}

async function deployContract(senderPk: string, sourceFile: string, api: ApiServer) {
  await waitForBlock(api);
  const contractName = `test-contract-${uniqueId()}`;
  const senderAddress = getAddressFromPrivateKey(senderPk, stacksNetwork.version);
  const source = fs.readFileSync(sourceFile).toString();
  const normalized_contract_source = source.replace(/\r/g, '').replace(/\t/g, ' ');

  const contractDeployTx = await makeContractDeploy({
    contractName: contractName,
    codeBody: normalized_contract_source,
    senderKey: senderPk,
    network: stacksNetwork,
    postConditionMode: PostConditionMode.Allow,
    sponsored: false,
  });

  const contractId = senderAddress + '.' + contractName;

  const feeRateReq = await fetch(stacksNetwork.getTransferFeeEstimateApiUrl());
  const feeRateResult = await feeRateReq.text();
  const txBytes = new BN(contractDeployTx.serialize().byteLength);
  const feeRate = new BN(feeRateResult);
  const fee = feeRate.mul(txBytes);
  contractDeployTx.setFee(fee);
  const { txId } = await sendCoreTx(contractDeployTx.serialize(), api, 'deploy-contract');

  return { txId, contractId };
}
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

  return txId;
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

function uniqueId() {
  return Math.random().toString(16).slice(-4);
}

async function waitForBlock(api: ApiServer) {
  await new Promise<DbBlock>(resolve => api.datastore.once('blockUpdate', block => resolve(block)));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
