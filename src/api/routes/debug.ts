import * as express from 'express';
import * as BN from 'bn.js';
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

const testnetKeys: { secretKey: string; stacksAddress: string }[] = [
  {
    secretKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
    stacksAddress: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
  },
  {
    secretKey: '3a4e84abb8abe0c1ba37cef4b604e73c82b1fe8d99015cb36b029a65099d373601',
    stacksAddress: 'ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P',
  },
  {
    secretKey: '052cc5b8f25b1e44a65329244066f76c8057accd5316c889f476d0ea0329632c01',
    stacksAddress: 'ST3CECAKJ4BH08JYY7W53MC81BYDT4YDA5M7S5F53',
  },
  {
    secretKey: '9aef533e754663a453984b69d36f109be817e9940519cc84979419e2be00864801',
    stacksAddress: 'ST31HHVBKYCYQQJ5AQ25ZHA6W2A548ZADDQ6S16GP',
  },
];

export function createDebugRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.urlencoded({ extended: true }));
  router.use(bodyParser.raw({ type: 'application/octet-stream' }));

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

  router.postAsync('/faucet', async (req, res) => {
    try {
      const { address } = req.query;
      const { FAUCET_PRIVATE_KEY } = process.env;
      if (!FAUCET_PRIVATE_KEY) {
        res.json({
          success: false,
          error: 'Faucet not setup',
        });
        return;
      }

      const senderAddress = getAddressFromPrivateKey(FAUCET_PRIVATE_KEY);
      const nonce = await new StacksCoreRpcClient().getAccountNonce(senderAddress);

      const tx = makeSTXTokenTransfer(address, new BN(10e3), new BN(10), FAUCET_PRIVATE_KEY, {
        nonce: new BN(nonce),
        version: TransactionVersion.Testnet,
        memo: 'Faucet',
      });

      const hex = tx.serialize().toString('hex');

      res.json({
        success: true,
        tx: hex,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false });
    }
  });

  return router;
}
