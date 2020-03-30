import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';
import * as BN from 'bn.js';
import { addAsync } from '@awaitjs/express';
import { htmlEscape } from 'escape-goat';
import { makeSTXTokenTransfer, TransactionVersion, makeSmartContractDeploy } from '@blockstack/stacks-transactions/src';
import { BufferReader } from '../../binary-reader';
import { readTransaction } from '../../p2p/tx';
import { txidFromData } from '@blockstack/stacks-transactions/src/utils';
import * as BroadcastContractDefault from '../../sample-data/broadcast-contract-default.json';

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

export function createDebugRouter(): express.Router {
  const router = addAsync(express.Router());

  router.use(express.urlencoded({ extended: true }));

  const tokenTransferHtml = `
    <style>
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
      <input list="recipient_addresses" name="recipient_address" value="${testnetKeys[1].stacksAddress}">
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

    const transferTx = makeSTXTokenTransfer(recipient_address, new BN(stx_amount), new BN(fee_rate), origin_key, {
      nonce: new BN(nonce),
      version: TransactionVersion.Testnet,
      memo: memo,
    });
    const serialized = transferTx.serialize();
    const mempoolPath = process.env['STACKS_CORE_MEMPOOL_PATH'];
    if (!mempoolPath) {
      throw new Error('STACKS_CORE_MEMPOOL_PATH not specified');
    }
    const txBinPath = path.join(mempoolPath, `tx_${Date.now()}.bin`);
    fs.writeFileSync(txBinPath, serialized);
    const txId = '0x' + txidFromData(serialized);
    res
      .set('Content-Type', 'text/html')
      .send(tokenTransferHtml + '<h3>Broadcasted transaction:</h3>' + `<a href="/tx/${txId}">${txId}</a>`);
  });

  const contractDeployHtml = `
    <style>
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
        BroadcastContractDefault.contract_name
      )}" pattern="^[a-zA-Z]([a-zA-Z0-9]|[-_!?+&lt;&gt;=/*])*$|^[-+=/*]$|^[&lt;&gt;]=?$" maxlength="128">

      <label for="source_code">Contract Clarity source code</label>
      <textarea id="source_code" name="source_code" rows="52">${htmlEscape(
        BroadcastContractDefault.contract_source
      )}</textarea>

      <input type="submit" value="Submit">
    </form>
  `;

  router.getAsync('/broadcast/contract-deploy', (req, res) => {
    res.set('Content-Type', 'text/html').send(contractDeployHtml);
  });

  router.postAsync('/broadcast/contract-deploy', (req, res) => {
    const { origin_key, contract_name, source_code, fee_rate, nonce } = req.body;

    const normalized_contract_source = (source_code as string).replace(/\r/g, '').replace(/\t/g, ' ');
    const deployTx = makeSmartContractDeploy(contract_name, normalized_contract_source, new BN(fee_rate), origin_key, {
      nonce: new BN(nonce),
      version: TransactionVersion.Testnet,
    });
    const serialized = deployTx.serialize();
    const mempoolPath = process.env['STACKS_CORE_MEMPOOL_PATH'];
    if (!mempoolPath) {
      throw new Error('STACKS_CORE_MEMPOOL_PATH not specified');
    }
    const txBinPath = path.join(mempoolPath, `tx_${Date.now()}.bin`);
    fs.writeFileSync(txBinPath, serialized);
    const txId = '0x' + txidFromData(serialized);
    res
      .set('Content-Type', 'text/html')
      .send(contractDeployHtml + '<h3>Broadcasted transaction:</h3>' + `<a href="/tx/${txId}">${txId}</a>`);
  });

  const txWatchHtml = `
    <script>
      const sse = new EventSource('/tx/stream?protocol=eventsource');
      sse.addEventListener('tx', e => {
        console.log(JSON.parse(e.data));
        const p = document.createElement('p');
        p.textContent = e.data;
        document.body.append(p);
      });
    </script>
  `;

  router.getAsync('/watch-tx', (req, res) => {
    res.set('Content-Type', 'text/html').send(txWatchHtml);
  });

  return router;
}
