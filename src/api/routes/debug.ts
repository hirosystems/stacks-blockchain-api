import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';
import * as BN from 'bn.js';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { htmlEscape } from 'escape-goat';
import {
  makeSTXTokenTransfer,
  TransactionVersion,
  makeSmartContractDeploy,
  Address,
  PostConditionMode,
  makeContractCall,
  ClarityValue,
} from '@blockstack/stacks-transactions';
import { BufferReader } from '../../binary-reader';
import { readTransaction } from '../../p2p/tx';
import { SampleContracts } from '../../sample-data/broadcast-contract-default';
import { DataStore } from '../../datastore/common';
import { ClarityAbi, getTypeString, encodeClarityValue } from '../../event-stream/contract-abi';
import { cssEscape, assertNotNullish, APP_DIR, REPO_DIR } from '../../helpers';
import { txidFromData } from '@blockstack/stacks-transactions/lib/src/utils';

function createMempoolBinFilePath(): string {
  let mempoolPath = process.env['STACKS_CORE_MEMPOOL_PATH'];
  if (!mempoolPath) {
    throw new Error('STACKS_CORE_MEMPOOL_PATH not specified');
  }
  if (!path.isAbsolute(mempoolPath)) {
    mempoolPath = path.resolve(REPO_DIR, mempoolPath);
  }
  return path.join(mempoolPath, `tx_${Date.now()}.bin`);
}

const testnetKeys: { secretKey: string; publicKey: string; stacksAddress: string }[] = [
  {
    secretKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
    publicKey: '02781d2d3a545afdb7f6013a8241b9e400475397516a0d0f76863c6742210539b5',
    stacksAddress: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
  },
  {
    secretKey: '98db64fd690a5dcf283cd92d3b1d4dd5010364535c3ac334f0ae45ebe5216dde01',
    publicKey: '023698a690d7756108a6534c8c6df5ab1353a17c2574958c9c15f38b8ddab8ab0c',
    stacksAddress: 'ST2YFCYFD76CP80NR6VSFFZEXXF9YMCDAQE7DNZP7',
  },
  {
    secretKey: '8fa1ad390ad1f7419b5149160ca7e8f0e5a11986d588d7a32677094b9ef047c701',
    publicKey: '020bba627d882866b7d44dd53f986c3df3b11209a72de722499bd6366744dcf1a1',
    stacksAddress: 'ST2XETEC4PYRB0B1Q1R4YB8CPRPZP166F8GCMBWWZ',
  },
  {
    secretKey: 'a3bdd8a6287eba19b5dcf81dbe366647ba0e512a59218b230e788648cbfd8a3101',
    publicKey: '032155a175cd3b7c235cec4c91066ce13e423b5b39a7f90e796cd70ee1a8b1ecf7',
    stacksAddress: 'ST1B25M9N697H37H6CVMQN79P8SF2NGZ9SCFE538E',
  },
  {
    secretKey: '4c9b63c22584cc4cf28530b8198a741f9c764c3018c2beb973fa450ed6e9d56f01',
    publicKey: '02399f03dfcb5b14c9cb8159aea8ba32abbdf4e282ee1f287e0c959495c8f12ca1',
    stacksAddress: 'ST312T97YRQ86WMWWAMF76AJVN24SEXGVM1Z5EH0F',
  },
];

export function createDebugRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.use(express.urlencoded({ extended: true }));

  const tokenTransferHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      input {
        display: block;
        width: 100%;
        margin-bottom: 10;
      }
    </style>
    <form action="" method="post">
      <label for="origin_key">Sender key</label>
      <input list="origin_keys" name="origin_key" value="${testnetKeys[0].secretKey}">
      <datalist id="origin_keys">
        ${testnetKeys.map(k => '<option value="' + k.secretKey + '">').join('\n')}
      </datalist>

      <label for="recipient_address">Recipient address</label>
      <input list="recipient_addresses" name="recipient_address" value="${
        testnetKeys[1].stacksAddress
      }">
      <datalist id="recipient_addresses">
        ${testnetKeys.map(k => '<option value="' + k.stacksAddress + '">').join('\n')}
      </datalist>

      <label for="stx_amount">uSTX amount</label>
      <input type="number" id="stx_amount" name="stx_amount" value="100">

      <label for="fee_rate">uSTX tx fee</label>
      <input type="number" id="fee_rate" name="fee_rate" value="9">

      <label for="nonce">Nonce</label>
      <input type="number" id="nonce" name="nonce" value="0">

      <label for="memo">Memo</label>
      <input type="text" id="memo" name="memo" value="hello" maxlength="34">

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/token-transfer', (req, res) => {
    res.set('Content-Type', 'text/html').send(tokenTransferHtml);
  });

  router.postAsync('/broadcast/token-transfer', (req, res) => {
    const { origin_key, recipient_address, stx_amount, fee_rate, nonce, memo } = req.body;

    const transferTx = makeSTXTokenTransfer(
      recipient_address,
      new BN(stx_amount),
      new BN(fee_rate),
      origin_key,
      {
        nonce: new BN(nonce),
        version: TransactionVersion.Testnet,
        memo: memo,
      }
    );
    const serialized = transferTx.serialize();
    const txBinPath = createMempoolBinFilePath();
    fs.writeFileSync(txBinPath, serialized);
    const txId = '0x' + txidFromData(serialized);
    res
      .set('Content-Type', 'text/html')
      .send(
        tokenTransferHtml +
          '<h3>Broadcasted transaction:</h3>' +
          `<a href="/tx/${txId}">${txId}</a>`
      );
  });

  const contractDeployHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      input, textarea {
        display: block;
        width: 100%;
        margin-bottom: 10;
      }
    </style>
    <form action="" method="post">
      <label for="origin_key">Sender key</label>
      <input list="origin_keys" name="origin_key" value="${testnetKeys[0].secretKey}">
      <datalist id="origin_keys">
        ${testnetKeys.map(k => '<option value="' + k.secretKey + '">').join('\n')}
      </datalist>

      <label for="fee_rate">uSTX tx fee</label>
      <input type="number" id="fee_rate" name="fee_rate" value="9">

      <label for="nonce">Nonce</label>
      <input type="number" id="nonce" name="nonce" value="0">

      <label for="contract_name">Contract name</label>
      <input type="text" id="contract_name" name="contract_name" value="${htmlEscape(
        SampleContracts[0].contractName
      )}" pattern="^[a-zA-Z]([a-zA-Z0-9]|[-_!?+&lt;&gt;=/*])*$|^[-+=/*]$|^[&lt;&gt;]=?$" maxlength="128">

      <label for="source_code">Contract Clarity source code</label>
      <textarea id="source_code" name="source_code" rows="40">${htmlEscape(
        SampleContracts[0].contractSource
      )}</textarea>

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/contract-deploy', (req, res) => {
    res.set('Content-Type', 'text/html').send(contractDeployHtml);
  });

  router.postAsync('/broadcast/contract-deploy', (req, res) => {
    const { origin_key, contract_name, source_code, fee_rate, nonce } = req.body;

    const normalized_contract_source = (source_code as string)
      .replace(/\r/g, '')
      .replace(/\t/g, ' ');
    const deployTx = makeSmartContractDeploy(
      contract_name,
      normalized_contract_source,
      new BN(fee_rate),
      origin_key,
      {
        nonce: new BN(nonce),
        version: TransactionVersion.Testnet,
        postConditionMode: PostConditionMode.Allow,
      }
    );
    const serialized = deployTx.serialize();
    const rawTx = readTransaction(new BufferReader(serialized));
    const senderAddress = Address.fromHashMode(
      rawTx.auth.originCondition.hashMode as number,
      rawTx.version as number,
      rawTx.auth.originCondition.signer.toString('hex')
    ).toC32AddressString();
    const contractId = senderAddress + '.' + contract_name;
    const txBinPath = createMempoolBinFilePath();
    fs.writeFileSync(txBinPath, serialized);
    const txId = '0x' + txidFromData(serialized);
    res
      .set('Content-Type', 'text/html')
      .send(
        contractDeployHtml +
          '<h3>Broadcasted transaction:</h3>' +
          `<a href="/tx/${txId}">${txId}</a>` +
          '<h3>Deployed contract:</h3>' +
          `<a href="contract-call/${contractId}">${contractId}</a>`
      );
  });

  const contractCallHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      textarea, input:not([type="radio"]) {
        display: block;
        width: 100%;
        margin-bottom: 5;
      }
      fieldset {
        margin: 10;
      }
    </style>
    <div>Contract ABI:</div>
    <textarea readonly rows="15">{contract_abi}</textarea>
    <hr/>
    <form action="" method="post" target="_blank">

      <label for="origin_key">Sender key</label>
      <input list="origin_keys" name="origin_key" value="${testnetKeys[0].secretKey}">
      <datalist id="origin_keys">
        ${testnetKeys.map(k => '<option value="' + k.secretKey + '">').join('\n')}
      </datalist>

      <label for="fee_rate">uSTX tx fee</label>
      <input type="number" id="fee_rate" name="fee_rate" value="9">

      <label for="nonce">Nonce</label>
      <input type="number" id="nonce" name="nonce" value="0">
      <hr/>

      {function_arg_controls}
      <hr/>

      <input type="submit" value="Submit">

    </form>
  `;

  router.getAsync('/broadcast/contract-call/:contract_id', async (req, res) => {
    const dbContract = await db.getSmartContract(req.params['contract_id']);
    const contractAbi: ClarityAbi = JSON.parse(dbContract.abi);
    let formHtml = contractCallHtml;
    let funcHtml = '';

    for (const fn of contractAbi.functions) {
      const fnName = htmlEscape(fn.name);

      let fnArgsHtml = '';
      for (const fnArg of fn.args) {
        const argName = htmlEscape(fn.name + ':' + fnArg.name);
        fnArgsHtml += `
          <label for="${argName}">${htmlEscape(fnArg.name)}</label>
          <input type="text" name="${argName}" id="${argName}" placeholder="${htmlEscape(
          getTypeString(fnArg.type)
        )}">`;
      }

      funcHtml += `
        <style>
          #${cssEscape(fn.name)}:not(:checked) ~ #${cssEscape(fn.name)}_args {
            pointer-events: none;
            opacity: 0.5;
          }
        </style>
        <input type="radio" name="fn_name" id="${fnName}" value="${fnName}">
        <label for="${fnName}">Function "${fnName}"</label>
        <fieldset id="${fnName}_args">
          ${fnArgsHtml}
        </fieldset>`;
    }

    formHtml = formHtml.replace(
      '{contract_abi}',
      htmlEscape(JSON.stringify(contractAbi, null, '  '))
    );
    formHtml = formHtml.replace('{function_arg_controls}', funcHtml);

    res.set('Content-Type', 'text/html').send(formHtml);
  });

  router.postAsync('/broadcast/contract-call/:contract_id', async (req, res) => {
    const contractId: string = req.params['contract_id'];
    const dbContract = await db.getSmartContract(contractId);
    const contractAbi: ClarityAbi = JSON.parse(dbContract.abi);

    const body = req.body as Record<string, string>;
    const feeRate = body['fee_rate'];
    const nonce = body['nonce'];
    const originKey = body['origin_key'];
    const functionName = body['fn_name'];
    const functionArgs = new Map<string, string>();
    for (const entry of Object.entries(body)) {
      const [fnName, argName] = entry[0].split(':', 2);
      if (fnName === functionName) {
        functionArgs.set(argName, entry[1]);
      }
    }

    const abiFunction = contractAbi.functions.find(f => f.name === functionName);
    if (abiFunction === undefined) {
      throw new Error(`Contract ${contractId} ABI does not have function "${functionName}"`);
    }

    const clarityValueArgs: ClarityValue[] = new Array(abiFunction.args.length);
    for (let i = 0; i < clarityValueArgs.length; i++) {
      const abiArg = abiFunction.args[i];
      const stringArg = assertNotNullish(functionArgs.get(abiArg.name));
      const clarityVal = encodeClarityValue(abiArg.type, stringArg);
      clarityValueArgs[i] = clarityVal;
    }
    const [contractAddr, contractName] = contractId.split('.');
    const contractCallTx = makeContractCall(
      contractAddr,
      contractName,
      functionName,
      clarityValueArgs,
      new BN(feeRate),
      originKey,
      {
        nonce: new BN(nonce),
        version: TransactionVersion.Testnet,
        postConditionMode: PostConditionMode.Allow,
      }
    );

    const serialized = contractCallTx.serialize();
    const txBinPath = createMempoolBinFilePath();
    fs.writeFileSync(txBinPath, serialized);
    const txId = '0x' + txidFromData(serialized);
    res
      .set('Content-Type', 'text/html')
      .send('<h3>Broadcasted transaction:</h3>' + `<a href="/tx/${txId}">${txId}</a>`);
  });

  const txWatchHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      p { white-space: pre-wrap; }
    </style>
    <script>
      const sse = new EventSource('/tx/stream?protocol=eventsource');
      sse.addEventListener('tx', e => {
        console.log(JSON.parse(e.data));
        const p = document.createElement('p');
        p.textContent = JSON.stringify(JSON.parse(e.data), null, '    ');
        document.body.append(p);
        document.body.append(document.createElement('hr'));
      });
    </script>
  `;

  router.getAsync('/watch-tx', (req, res) => {
    res.set('Content-Type', 'text/html').send(txWatchHtml);
  });

  return router;
}
