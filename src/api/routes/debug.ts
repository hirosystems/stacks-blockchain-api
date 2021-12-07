import * as express from 'express';
import * as BN from 'bn.js';
import * as btc from 'bitcoinjs-lib';
import * as c32check from 'c32check';
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
  SignedContractCallOptions,
  uintCV,
  tupleCV,
  bufferCV,
  AnchorMode,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
import { SampleContracts } from '../../sample-data/broadcast-contract-default';
import { DataStore } from '../../datastore/common';
import { ClarityAbi, getTypeString, encodeClarityValue } from '../../event-stream/contract-abi';
import { cssEscape, assertNotNullish, logger, unwrapOptional } from '../../helpers';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from '../../core-rpc/client';

export const testnetKeys: { secretKey: string; stacksAddress: string }[] = [
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
  {
    secretKey: 'ce109fee08860bb16337c76647dcbc02df0c06b455dd69bcf30af74d4eedd19301',
    stacksAddress: 'STF9B75ADQAVXQHNEQ6KGHXTG7JP305J2GRWF3A2',
  },
  {
    secretKey: '08c14a1eada0dd42b667b40f59f7c8dedb12113613448dc04980aea20b268ddb01',
    stacksAddress: 'ST18MDW2PDTBSCR1ACXYRJP2JX70FWNM6YY2VX4SS',
  },
];

const testnetKeyMap: Record<
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

export function getStacksTestnetNetwork() {
  const stacksNetwork = new StacksTestnet();
  stacksNetwork.coreApiUrl = `http://${getCoreNodeEndpoint()}`;
  return stacksNetwork;
}

export function createDebugRouter(db: DataStore): RouterWithAsync {
  const defaultTxFee = 12345;
  const stacksNetwork = getStacksTestnetNetwork();

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
      anchorMode: AnchorMode.Any,
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
      anchorMode: AnchorMode.Any,
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

      <label for="nonce">Nonce (empty for auto)</label>
      <input type="number" id="nonce" name="nonce" value="">

      <label for="anchor_mode">Anchor mode</label>
      <select id="anchor_mode" name="anchor_mode" size="3">
        <option value="1">on chain only</option>
        <option value="2">off chain only</option>
        <option value="3" selected>any</option>
      </select>

      <input type="checkbox" id="sponsored" name="sponsored" value="sponsored" style="display:initial;width:auto">
      <label for="sponsored">Create sponsored transaction</label>

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/token-transfer', (req, res) => {
    res.set('Content-Type', 'text/html').send(tokenTransferHtml);
  });

  router.postAsync('/broadcast/token-transfer', async (req, res) => {
    const { origin_key, recipient_address, stx_amount, memo, nonce, anchor_mode } = req.body;
    const sponsored = !!req.body.sponsored;

    const senderAddress = getAddressFromPrivateKey(origin_key, TransactionVersion.Testnet);
    const rpcClient = new StacksCoreRpcClient();
    // const nonce = await rpcClient.getAccountNonce(senderAddress, true);
    let txNonce = 0;
    if (Number.isInteger(Number.parseInt(nonce))) {
      txNonce = Number.parseInt(nonce);
    } else {
      const latestNonces = await db.getAddressNonces({ stxAddress: senderAddress });
      txNonce = latestNonces.possibleNextNonce;
    }

    const anchorMode: AnchorMode = Number(anchor_mode);
    const transferTx = await makeSTXTokenTransfer({
      recipient: recipient_address,
      amount: new BN(stx_amount),
      senderKey: origin_key,
      network: stacksNetwork,
      memo: memo,
      sponsored: sponsored,
      nonce: new BN(txNonce),
      anchorMode: anchorMode,
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

  const sendPoxHtml = `
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

  router.getAsync('/broadcast/stack', (req, res) => {
    res.set('Content-Type', 'text/html').send(sendPoxHtml);
  });

  function convertBTCAddress(btcAddress: string): { hashMode: AddressHashMode; data: Buffer } {
    function getAddressHashMode(btcAddress: string) {
      if (btcAddress.startsWith('bc1') || btcAddress.startsWith('tb1')) {
        const { data } = btc.address.fromBech32(btcAddress);
        if (data.length === 32) {
          return AddressHashMode.SerializeP2WSH;
        } else {
          return AddressHashMode.SerializeP2WPKH;
        }
      } else {
        const { version } = btc.address.fromBase58Check(btcAddress);
        switch (version) {
          case 0:
            return AddressHashMode.SerializeP2PKH;
          case 111:
            return AddressHashMode.SerializeP2PKH;
          case 5:
            return AddressHashMode.SerializeP2SH;
          case 196:
            return AddressHashMode.SerializeP2SH;
          default:
            throw new Error('Invalid pox address version');
        }
      }
    }
    const hashMode = getAddressHashMode(btcAddress);
    if (btcAddress.startsWith('bc1') || btcAddress.startsWith('tb1')) {
      const { data } = btc.address.fromBech32(btcAddress);
      return {
        hashMode,
        data,
      };
    } else {
      const { hash } = btc.address.fromBase58Check(btcAddress);
      return {
        hashMode,
        data: hash,
      };
    }
  }

  router.postAsync('/broadcast/stack', async (req, res) => {
    const { origin_key, recipient_address, stx_amount, memo } = req.body;
    const client = new StacksCoreRpcClient();
    const coreInfo = await client.getInfo();
    const poxInfo = await client.getPox();
    const minStxAmount = BigInt(poxInfo.min_amount_ustx);
    const sender = testnetKeys.filter(t => t.secretKey === origin_key)[0];
    const accountBalance = await client.getAccountBalance(sender.stacksAddress);
    if (accountBalance < minStxAmount) {
      throw new Error(
        `Min requirement pox amount is ${minStxAmount} but account balance is only ${accountBalance}`
      );
    }
    const [contractAddress, contractName] = poxInfo.contract_id.split('.');
    const btcAddr = c32check.c32ToB58(sender.stacksAddress);
    const { hashMode, data } = convertBTCAddress(btcAddr);
    const cycles = 3;
    const txOptions: SignedContractCallOptions = {
      senderKey: sender.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-stx',
      functionArgs: [
        uintCV(minStxAmount.toString()),
        tupleCV({
          hashbytes: bufferCV(data),
          version: bufferCV(new BN(hashMode).toBuffer()),
        }),
        uintCV(coreInfo.burn_block_height),
        uintCV(cycles),
      ],
      network: stacksNetwork,
      anchorMode: AnchorMode.Any,
    };
    const tx = await makeContractCall(txOptions);
    const expectedTxId = tx.txid();
    const serializedTx = tx.serialize();
    const { txId } = await sendCoreTx(serializedTx);
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
      anchorMode: AnchorMode.Any,
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
      const stringArg = unwrapOptional(functionArgs.get(abiArg.name));
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
      anchorMode: AnchorMode.Any,
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
