import * as express from 'express';
import * as BN from 'bn.js';
import * as bodyParser from 'body-parser';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { htmlEscape } from 'escape-goat';
import * as listEndpoints from 'express-list-endpoints';
import {
  makeSTXTokenTransfer,
  makeContractDeploy,
  PostConditionMode,
  makeContractCall,
  ClarityValue,
  StacksTestnet,
  getAddressFromPrivateKey,
  sponsorTransaction,
  makeUnsignedSTXTokenTransfer,
  TransactionSigner,
  createStacksPrivateKey,
  pubKeyfromPrivKey,
  publicKeyToString,
  addressFromPublicKeys,
  AddressHashMode,
  createStacksPublicKey,
  TransactionVersion,
  AddressVersion,
  addressToString,
} from '@blockstack/stacks-transactions';
import { SampleContracts } from '../../sample-data/broadcast-contract-default';
import { DataStore, DbFaucetRequestCurrency } from '../../datastore/common';
import { ClarityAbi, getTypeString, encodeClarityValue } from '../../event-stream/contract-abi';
import { cssEscape, assertNotNullish, logger } from '../../helpers';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../../core-rpc/client';
import { deserializeTransaction } from '@blockstack/stacks-transactions/lib/transaction';
import { BufferReader } from '@blockstack/stacks-transactions/lib/bufferReader';

export const testnetKeys: { secretKey: string; stacksAddress: string }[] = [
  {
    secretKey: 'e2759f47af63ab1bd14d7df874559e15aa7ab4b60101e2e85606bda517923dbe01',
    stacksAddress: 'ST1WHW84WV9D67CQZV3NY5NM284GF9TXZ4CS7RDRF',
  },
  {
    secretKey: '1f31538f23c96defbba123db8957aa618d336423ca31871f2283d9d2d81c62c501',
    stacksAddress: 'ST2R464YCJEXD4WXR90XCEN5BKBFB7S37TZ207BSY',
  },
  {
    secretKey: 'd01802e876a5cea31af6fa0577276794c8333fde17bba48f790dabd41e7dc99301',
    stacksAddress: 'STRH5TEWEDRM14K4GWWF37FHDFC69ZKH90FMA6NF',
  },
  {
    secretKey: '803d1aca9d5f53c0a3905d14583ef537e110cb89c531de57d77d39febfec651501',
    stacksAddress: 'ST1XDVK637SACQG1TMBVSXVW3GK5K35R82KNMN2QG',
  }
];

export const testnetKeyMap: Record<
  string,
  { address: string; secretKey: string; pubKey: string }
> = Object.fromEntries(
  testnetKeys.map(t => [
    t.stacksAddress,
    {
      address: t.stacksAddress,
      secretKey: t.secretKey,
      pubKey: publicKeyToString(pubKeyfromPrivKey(t.secretKey)),
    },
  ])
);

export function GetStacksTestnetNetwork() {
  const stacksNetwork = new StacksTestnet();
  stacksNetwork.coreApiUrl = `http://${getCoreNodeEndpoint()}`;
  return stacksNetwork;
}

export function createDebugRouter(db: DataStore): RouterWithAsync {
  const defaultTxFee = 12345;
  const stacksNetwork = GetStacksTestnetNetwork();

  const router = addAsync(express.Router());
  router.use(express.urlencoded({ extended: true }));
  router.use(bodyParser.raw({ type: 'application/octet-stream' }));

  async function sendCoreTx(serializedTx: Buffer): Promise<{ txId: string }> {
    const submitResult = await new StacksCoreRpcClient().sendTransaction(serializedTx);
    return submitResult;
  }

  router.get('/broadcast', (req, res) => {
    const endpoints = listEndpoints((router as unknown) as express.Express);
    const paths: Set<string> = new Set();
    endpoints.forEach(e => {
      if (e.methods.includes('GET')) {
        paths.add(req.baseUrl + e.path);
      }
    });
    const links = [...paths].map(e => {
      return `<a href="${e}">${e}</a>`;
    });
    const html = links.join('</br>');
    res.set('Content-Type', 'text/html').send(html);
  });

  const tokenTransferFromMultisigHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      input, select {
        display: block;
        width: 100%;
        margin-bottom: 10;
      }
    </style>
    <form action="" method="post">
      <label for="signers">Signers</label>
      <select name="signers" id="signers" multiple>
        ${testnetKeys
          .map(k => `<option value="${k.stacksAddress}">${k.stacksAddress}</option>`)
          .join('\n')}
      </select>

      <label for="signatures_required">Signatures required</label>
      <input type="number" id="signatures_required" name="signatures_required" value="1">

      <label for="recipient_address">Recipient address</label>
      <input list="recipient_addresses" name="recipient_address" value="${
        testnetKeys[1].stacksAddress
      }">
      <datalist id="recipient_addresses">
        ${testnetKeys.map(k => '<option value="' + k.stacksAddress + '">').join('\n')}
      </datalist>

      <label for="stx_amount">uSTX amount</label>
      <input type="number" id="stx_amount" name="stx_amount" value="5000">

      <label for="memo">Memo</label>
      <input type="text" id="memo" name="memo" value="hello" maxlength="34">

      <input type="checkbox" id="sponsored" name="sponsored" value="sponsored" style="display:initial;width:auto">
      <label for="sponsored">Create sponsored transaction</label>

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/token-transfer-from-multisig', (req, res) => {
    res.set('Content-Type', 'text/html').send(tokenTransferFromMultisigHtml);
  });

  router.postAsync('/broadcast/token-transfer-from-multisig', async (req, res) => {
    const {
      signers: signersInput,
      signatures_required,
      recipient_address,
      stx_amount,
      memo,
    } = req.body as {
      signers: string[] | string;
      signatures_required: string;
      recipient_address: string;
      stx_amount: string;
      memo: string;
    };
    const sponsored = !!req.body.sponsored;
    const sigsRequired = parseInt(signatures_required);

    const signers = Array.isArray(signersInput) ? signersInput : [signersInput];
    const signerPubKeys = signers.map(addr => testnetKeyMap[addr].pubKey);
    const signerPrivateKeys = signers.map(addr => testnetKeyMap[addr].secretKey);

    /*
    const transferTx1 = await makeSTXTokenTransfer({
      recipient: recipient_address,
      amount: new BN(stx_amount),
      memo: memo,
      network: stacksNetwork,
      sponsored: sponsored,
      numSignatures: sigsRequired,
      // TODO: should this field be named `signerPublicKeys`?
      publicKeys: signerPubKeys,
      // TODO: should this field be named `signerPrivateKeys`?
      signerKeys: signerPrivateKeys,
    });
    */

    const transferTx = await makeUnsignedSTXTokenTransfer({
      recipient: recipient_address,
      amount: new BN(stx_amount),
      memo: memo,
      network: stacksNetwork,
      numSignatures: sigsRequired,
      publicKeys: signerPubKeys,
      sponsored: sponsored,
      fee: new BN(500),
    });

    const signer = new TransactionSigner(transferTx);
    let i = 0;
    for (; i < sigsRequired; i++) {
      signer.signOrigin(createStacksPrivateKey(signerPrivateKeys[i]));
    }
    for (; i < signers.length; i++) {
      signer.appendOrigin(createStacksPublicKey(signerPubKeys[i]));
    }

    let serialized: Buffer;
    let expectedTxId: string;
    if (sponsored) {
      const sponsorKey = testnetKeys[testnetKeys.length - 1].secretKey;
      const sponsoredTx = await sponsorTransaction({
        network: stacksNetwork,
        transaction: transferTx,
        sponsorPrivateKey: sponsorKey,
      });
      serialized = sponsoredTx.serialize();
      expectedTxId = sponsoredTx.txid();
    } else {
      serialized = transferTx.serialize();
      expectedTxId = transferTx.txid();
    }

    const { txId } = await sendCoreTx(serialized);
    if (txId !== '0x' + expectedTxId) {
      throw new Error(`Expected ${expectedTxId}, core ${txId}`);
    }
    res
      .set('Content-Type', 'text/html')
      .send(
        tokenTransferFromMultisigHtml +
          '<h3>Broadcasted transaction:</h3>' +
          `<a href="/extended/v1/tx/${txId}">${txId}</a>`
      );
  });

  const tokenTransferMultisigHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      input, select {
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

      <label for="recipient_addresses">Recipient addresses</label>
      <select name="recipient_addresses" id="recipient_addresses" multiple>
        ${testnetKeys
          .map(k => `<option value="${k.stacksAddress}">${k.stacksAddress}</option>`)
          .join('\n')}
      </select>

      <label for="signatures_required">Signatures required</label>
      <input type="number" id="signatures_required" name="signatures_required" value="1">

      <label for="stx_amount">uSTX amount</label>
      <input type="number" id="stx_amount" name="stx_amount" value="5000">

      <label for="memo">Memo</label>
      <input type="text" id="memo" name="memo" value="hello" maxlength="34">

      <input type="checkbox" id="sponsored" name="sponsored" value="sponsored" style="display:initial;width:auto">
      <label for="sponsored">Create sponsored transaction</label>

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/token-transfer-multisig', (req, res) => {
    res.set('Content-Type', 'text/html').send(tokenTransferMultisigHtml);
  });

  router.postAsync('/broadcast/token-transfer-multisig', async (req, res) => {
    const {
      origin_key,
      recipient_addresses: recipientInput,
      signatures_required,
      stx_amount,
      memo,
    } = req.body as {
      origin_key: string;
      recipient_addresses: string[] | string;
      signatures_required: string;
      stx_amount: string;
      memo: string;
    };
    const sponsored = !!req.body.sponsored;

    const recipientAddresses = Array.isArray(recipientInput) ? recipientInput : [recipientInput];
    const recipientPubKeys = recipientAddresses
      .map(s => testnetKeyMap[s].pubKey)
      .map(k => createStacksPublicKey(k));
    const sigRequired = parseInt(signatures_required);
    const recipientAddress = addressToString(
      addressFromPublicKeys(
        stacksNetwork.version === TransactionVersion.Testnet
          ? AddressVersion.TestnetMultiSig
          : AddressVersion.MainnetMultiSig,
        AddressHashMode.SerializeP2SH,
        sigRequired,
        recipientPubKeys
      )
    );

    const transferTx = await makeSTXTokenTransfer({
      recipient: recipientAddress,
      amount: new BN(stx_amount),
      memo: memo,
      network: stacksNetwork,
      senderKey: origin_key,
      sponsored: sponsored,
    });

    let serialized: Buffer;
    let expectedTxId: string;
    if (sponsored) {
      const sponsorKey = testnetKeys[testnetKeys.length - 1].secretKey;
      const sponsoredTx = await sponsorTransaction({
        network: stacksNetwork,
        transaction: transferTx,
        sponsorPrivateKey: sponsorKey,
      });
      serialized = sponsoredTx.serialize();
      expectedTxId = sponsoredTx.txid();
    } else {
      serialized = transferTx.serialize();
      expectedTxId = transferTx.txid();
    }

    const { txId } = await sendCoreTx(serialized);
    if (txId !== '0x' + expectedTxId) {
      throw new Error(`Expected ${expectedTxId}, core ${txId}`);
    }
    res
      .set('Content-Type', 'text/html')
      .send(
        tokenTransferMultisigHtml +
          '<h3>Broadcasted transaction:</h3>' +
          `<a href="/extended/v1/tx/${txId}">${txId}</a>`
      );
  });

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
      <input type="number" id="stx_amount" name="stx_amount" value="5000">

      <label for="memo">Memo</label>
      <input type="text" id="memo" name="memo" value="hello" maxlength="34">

      <input type="checkbox" id="sponsored" name="sponsored" value="sponsored" style="display:initial;width:auto">
      <label for="sponsored">Create sponsored transaction</label>

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/token-transfer', (req, res) => {
    res.set('Content-Type', 'text/html').send(tokenTransferHtml);
  });

  router.postAsync('/broadcast/token-transfer', async (req, res) => {
    const { origin_key, recipient_address, stx_amount, memo } = req.body;
    const sponsored = !!req.body.sponsored;

    const transferTx = await makeSTXTokenTransfer({
      recipient: recipient_address,
      amount: new BN(stx_amount),
      senderKey: origin_key,
      network: stacksNetwork,
      memo: memo,
      sponsored: sponsored,
    });

    let serialized: Buffer;
    let expectedTxId: string;
    if (sponsored) {
      const sponsorKey = testnetKeys[testnetKeys.length - 1].secretKey;
      const sponsoredTx = await sponsorTransaction({
        network: stacksNetwork,
        transaction: transferTx,
        sponsorPrivateKey: sponsorKey,
      });
      serialized = sponsoredTx.serialize();
      expectedTxId = sponsoredTx.txid();
    } else {
      serialized = transferTx.serialize();
      expectedTxId = transferTx.txid();
    }

    const { txId } = await sendCoreTx(serialized);
    if (txId !== '0x' + expectedTxId) {
      throw new Error(`Expected ${expectedTxId}, core ${txId}`);
    }
    res
      .set('Content-Type', 'text/html')
      .send(
        tokenTransferHtml +
          '<h3>Broadcasted transaction:</h3>' +
          `<a href="/extended/v1/tx/${txId}">${txId}</a>`
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

      <label for="contract_name">Contract name</label>
      <input type="text" id="contract_name" name="contract_name" value="${htmlEscape(
        SampleContracts[0].contractName
      )}" pattern="^[a-zA-Z]([a-zA-Z0-9]|[-_!?+&lt;&gt;=/*])*$|^[-+=/*]$|^[&lt;&gt;]=?$" maxlength="128">

      <label for="source_code">Contract Clarity source code</label>
      <textarea id="source_code" name="source_code" rows="40">${htmlEscape(
        SampleContracts[0].contractSource
      )}</textarea>

      <input type="checkbox" id="sponsored" name="sponsored" value="sponsored" style="display:initial;width:auto">
      <label for="sponsored">Create sponsored transaction</label>

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/contract-deploy', (req, res) => {
    res.set('Content-Type', 'text/html').send(contractDeployHtml);
  });

  router.postAsync('/broadcast/contract-deploy', async (req, res) => {
    const { origin_key, contract_name, source_code } = req.body;
    const sponsored = !!req.body.sponsored;

    const senderAddress = getAddressFromPrivateKey(origin_key, stacksNetwork.version);

    const normalized_contract_source = (source_code as string)
      .replace(/\r/g, '')
      .replace(/\t/g, ' ');
    const contractDeployTx = await makeContractDeploy({
      contractName: contract_name,
      codeBody: normalized_contract_source,
      senderKey: origin_key,
      network: stacksNetwork,
      fee: new BN(defaultTxFee),
      postConditionMode: PostConditionMode.Allow,
      sponsored: sponsored,
    });

    let serializedTx: Buffer;
    let expectedTxId: string;
    if (sponsored) {
      const sponsorKey = testnetKeys[testnetKeys.length - 1].secretKey;
      const sponsoredTx = await sponsorTransaction({
        network: stacksNetwork,
        transaction: contractDeployTx,
        sponsorPrivateKey: sponsorKey,
      });
      serializedTx = sponsoredTx.serialize();
      expectedTxId = sponsoredTx.txid();
    } else {
      serializedTx = contractDeployTx.serialize();
      expectedTxId = contractDeployTx.txid();
    }

    const contractId = senderAddress + '.' + contract_name;
    const { txId } = await sendCoreTx(serializedTx);
    if (txId !== '0x' + expectedTxId) {
      throw new Error(`Expected ${expectedTxId}, core ${txId}`);
    }
    res
      .set('Content-Type', 'text/html')
      .send(
        contractDeployHtml +
          '<h3>Broadcasted transaction:</h3>' +
          `<a href="/extended/v1/tx/${txId}">${txId}</a>` +
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

      <hr/>

      {function_arg_controls}
      <hr/>

      <input type="checkbox" id="sponsored" name="sponsored" value="sponsored" style="display:initial;width:auto">
      <label for="sponsored">Create sponsored transaction</label>

      <input type="submit" value="Submit">

    </form>
  `;

  router.getAsync('/broadcast/contract-call/:contract_id', async (req, res) => {
    const { contract_id } = req.params;
    const dbContractQuery = await db.getSmartContract(contract_id);
    if (!dbContractQuery.found) {
      res.status(404).json({ error: `cannot find contract by ID ${contract_id}` });
      return;
    }
    const contractAbi: ClarityAbi = JSON.parse(dbContractQuery.result.abi);
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
    const dbContractQuery = await db.getSmartContract(contractId);
    if (!dbContractQuery.found) {
      res.status(404).json({ error: `could not find contract by ID ${contractId}` });
      return;
    }
    const contractAbi: ClarityAbi = JSON.parse(dbContractQuery.result.abi);

    const body = req.body as Record<string, string>;
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

    const sponsored = !!req.body.sponsored;

    const contractCallTx = await makeContractCall({
      contractAddress: contractAddr,
      contractName: contractName,
      functionName: functionName,
      functionArgs: clarityValueArgs,
      senderKey: originKey,
      network: stacksNetwork,
      fee: new BN(defaultTxFee),
      postConditionMode: PostConditionMode.Allow,
      sponsored: sponsored,
    });

    let serialized: Buffer;
    let expectedTxId: string;
    if (sponsored) {
      const sponsorKey = testnetKeys[testnetKeys.length - 1].secretKey;
      const sponsoredTx = await sponsorTransaction({
        network: stacksNetwork,
        transaction: contractCallTx,
        sponsorPrivateKey: sponsorKey,
      });
      serialized = sponsoredTx.serialize();
      expectedTxId = sponsoredTx.txid();
    } else {
      serialized = contractCallTx.serialize();
      expectedTxId = contractCallTx.txid();
    }

    const { txId } = await sendCoreTx(serialized);
    if (txId !== '0x' + expectedTxId) {
      throw new Error(`Expected ${expectedTxId}, core ${txId}`);
    }
    res
      .set('Content-Type', 'text/html')
      .send('<h3>Broadcasted transaction:</h3>' + `<a href="/extended/v1/tx/${txId}">${txId}</a>`);
  });

  const txWatchHtml = `
    <style>
      * { font-family: "Lucida Console", Monaco, monospace; }
      p { white-space: pre-wrap; }
    </style>
    <script>
      const sse = new EventSource('/extended/v1/tx/stream?protocol=eventsource');
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

  router.postAsync('/faucet', (req, res) => {
    // Redirect with 307 because: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/307
    // "... the difference between 307 and 302 is that 307 guarantees that the method and the body
    //  will not be changed when the redirected request is made ... the behavior with non-GET
    //  methods and 302 is then unpredictable on the Web."
    const address: string = req.query.address || req.body.address;
    res.redirect(307, `../faucets/stx?address=${encodeURIComponent(address)}`);
  });

  return router;
}
