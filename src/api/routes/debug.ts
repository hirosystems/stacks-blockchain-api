import * as express from 'express';
import * as BN from 'bn.js';
import * as cors from 'cors';
import * as bodyParser from 'body-parser';
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
  AddressHashMode,
  addressHashModeToVersion,
  StacksPublicKey,
} from '@blockstack/stacks-transactions';
import { SampleContracts } from '../../sample-data/broadcast-contract-default';
import { DataStore } from '../../datastore/common';
import { ClarityAbi, getTypeString, encodeClarityValue } from '../../event-stream/contract-abi';
import { cssEscape, assertNotNullish } from '../../helpers';
import { StacksCoreRpcClient } from '../../core-rpc/client';

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
  router.use(bodyParser.raw({ type: 'application/octet-stream' }));
  router.use(cors());

  async function sendCoreTx(serializedTx: Buffer): Promise<{ txId: string }> {
    const submitResult = await new StacksCoreRpcClient().sendTransaction(serializedTx);
    return submitResult;
  }

  function getAddressFromPrivateKey(privateKey: string): string {
    const addrVer = addressHashModeToVersion(
      AddressHashMode.SerializeP2PKH,
      TransactionVersion.Testnet
    );
    const pubKey = StacksPublicKey.fromPrivateKey(privateKey);
    const addr = Address.fromPublicKeys(addrVer, AddressHashMode.SerializeP2PKH, 1, [
      pubKey,
    ]).toC32AddressString();
    return addr;
  }

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
      <input type="number" id="fee_rate" name="fee_rate" value="123456">

      <label for="memo">Memo</label>
      <input type="text" id="memo" name="memo" value="hello" maxlength="34">

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/token-transfer', (req, res) => {
    res.set('Content-Type', 'text/html').send(tokenTransferHtml);
  });

  router.postAsync('/broadcast/token-transfer', async (req, res) => {
    const { origin_key, recipient_address, stx_amount, fee_rate, memo } = req.body;

    const senderAddress = getAddressFromPrivateKey(origin_key);
    const nonce = await new StacksCoreRpcClient().getAccountNonce(senderAddress);

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
    const { txId } = await sendCoreTx(serialized);
    res
      .set('Content-Type', 'text/html')
      .send(
        tokenTransferHtml +
          '<h3>Broadcasted transaction:</h3>' +
          `<a href="/tx/${txId}">${txId}</a>`
      );
  });

  router.postAsync('/v2/transactions', async (req, res) => {
    const data: Buffer = req.body;
    const { txId } = await sendCoreTx(data);
    res.json({
      success: true,
      txId,
    });
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
      <input type="number" id="fee_rate" name="fee_rate" value="123456">

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

  router.postAsync('/broadcast/contract-deploy', async (req, res) => {
    const { origin_key, contract_name, source_code, fee_rate } = req.body;

    const senderAddress = getAddressFromPrivateKey(origin_key);
    const nonce = await new StacksCoreRpcClient().getAccountNonce(senderAddress);

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
    const contractId = senderAddress + '.' + contract_name;
    const { txId } = await sendCoreTx(serialized);
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
      <input type="number" id="fee_rate" name="fee_rate" value="123456">

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

    const senderAddress = getAddressFromPrivateKey(originKey);
    const nonce = await new StacksCoreRpcClient().getAccountNonce(senderAddress);

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
    const { txId } = await sendCoreTx(serialized);
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
