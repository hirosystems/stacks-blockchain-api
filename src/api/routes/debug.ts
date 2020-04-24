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
  ChainID,
  addressFromPublicKeys,
  addressToString,
} from '@blockstack/stacks-transactions';
import { SampleContracts } from '../../sample-data/broadcast-contract-default';
import { DataStore } from '../../datastore/common';
import { ClarityAbi, getTypeString, encodeClarityValue } from '../../event-stream/contract-abi';
import { cssEscape, assertNotNullish } from '../../helpers';
import { StacksCoreRpcClient } from '../../core-rpc/client';
import { pubKeyfromPrivKey } from '@blockstack/stacks-transactions/lib/src/keys';

const testnetKeys: { secretKey: string; stacksAddress: string }[] = [
  {
    secretKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
    stacksAddress: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
  },
  {
    secretKey: '21d43d2ae0da1d9d04cfcaac7d397a33733881081f0b2cd038062cf0ccbb752601',
    stacksAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
  },
  {
    secretKey: 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01',
    stacksAddress: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
  },
  {
    secretKey: 'e75dcb66f84287eaf347955e94fa04337298dbd95aa0dbb985771104ef1913db01',
    stacksAddress: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
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
    const pubKey = pubKeyfromPrivKey(privateKey);
    const addr = addressFromPublicKeys(addrVer, AddressHashMode.SerializeP2PKH, 1, [pubKey]);
    const addrString = addressToString(addr);
    return addrString;
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
        chainId: ChainID.Testnet,
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
          `<a href="/sidecar/v1/tx/${txId}">${txId}</a>`
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
        chainId: ChainID.Testnet,
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
          `<a href="/sidecar/v1/tx/${txId}">${txId}</a>` +
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
        chainId: ChainID.Testnet,
        postConditionMode: PostConditionMode.Allow,
      }
    );
    const serialized = contractCallTx.serialize();
    const { txId } = await sendCoreTx(serialized);
    res
      .set('Content-Type', 'text/html')
      .send('<h3>Broadcasted transaction:</h3>' + `<a href="/sidecar/v1/tx/${txId}">${txId}</a>`);
  });

  const txWatchHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      p { white-space: pre-wrap; }
    </style>
    <script>
      const sse = new EventSource('/sidecar/v1/tx/stream?protocol=eventsource');
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
      const address: string = req.query.address || req.body.address;

      const privateKey = process.env.FAUCET_PRIVATE_KEY || testnetKeys[0].secretKey;

      const senderAddress = getAddressFromPrivateKey(privateKey);
      const nonce = await new StacksCoreRpcClient().getAccountNonce(senderAddress);

      const tx = makeSTXTokenTransfer(address, new BN(10e3), new BN(200), privateKey, {
        nonce: new BN(nonce),
        version: TransactionVersion.Testnet,
        chainId: ChainID.Testnet,
        memo: 'Faucet',
      });

      const hex = tx.serialize().toString('hex');

      const { txId } = await sendCoreTx(tx.serialize());

      res.json({
        success: true,
        txId,
        txRaw: hex,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false });
    }
  });

  return router;
}
