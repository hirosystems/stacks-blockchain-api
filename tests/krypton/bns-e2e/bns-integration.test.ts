import * as assert from 'node:assert/strict';
import supertest from 'supertest';
import { createHash } from 'crypto';
import { AnchorMode, ChainID, PostConditionMode, someCV } from '@stacks/transactions';
import {
  broadcastTransaction,
  bufferCV,
  ClarityAbi,
  FungibleConditionCode,
  getAddressFromPrivateKey,
  makeContractCall,
  makeStandardSTXPostCondition,
  standardPrincipalCV,
  uintCV,
  SignedContractCallOptions,
  noneCV,
  StacksTransaction,
  TransactionVersion,
} from '@stacks/transactions';
import { standByForTx as standByForTxShared } from '../../test-helpers.js';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/faucets.js';
import { logger } from '@stacks/api-toolkit';
import { getTestEnv, stopTestEnv, TestEnvContext } from '../test-env.js';
import { after, before, describe, test } from 'node:test';

function hash160(bfr: Buffer): Buffer {
  const hash160 = createHash('ripemd160')
    .update(createHash('sha256').update(bfr).digest())
    .digest('hex');
  return Buffer.from(hash160, 'hex');
}

const deployedTo = 'ST000000000000000000002AMW42H';
const deployedName = 'bns';
const salt = Buffer.from('60104ad42ed976f5b8cfd6341496476aa72d1101', 'hex'); // salt and pepper

type TestnetKey = {
  pkey: string;
  address: string;
};

describe('BNS integration tests', () => {
  let testEnv: TestEnvContext;
  let bnsContractAbi: ClarityAbi | undefined;

  const standByForTx = (expectedTxId: string) => standByForTxShared(expectedTxId, testEnv.api);

  async function getBnsContractAbi(): Promise<ClarityAbi> {
    if (bnsContractAbi) return bnsContractAbi;
    const contractId = `${deployedTo}.${deployedName}`;
    const contractResp = await supertest(testEnv.api.server).get(
      `/extended/v1/contract/${contractId}`
    );
    if (contractResp.status === 200 && contractResp.body?.abi) {
      const apiAbi =
        typeof contractResp.body.abi === 'string'
          ? JSON.parse(contractResp.body.abi)
          : contractResp.body.abi;
      if (apiAbi?.functions) {
        bnsContractAbi = apiAbi as ClarityAbi;
        return bnsContractAbi;
      }
    }

    const abiUrl = testEnv.stacksNetwork.getAbiApiUrl(deployedTo, deployedName);
    const response = await fetch(abiUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch BNS ABI from API and ${abiUrl}: ${response.status} ${response.statusText}`
      );
    }
    const payload = JSON.parse(await response.text());
    const abiCandidate = payload?.functions ?? payload?.abi ?? payload?.contract_interface;
    if (!abiCandidate?.functions) {
      const debugShape = JSON.stringify(Object.keys(payload ?? {}));
      throw new Error(
        `Unexpected ABI response shape from ${abiUrl}. Top-level keys: ${debugShape}`
      );
    }
    bnsContractAbi = abiCandidate as ClarityAbi;
    return bnsContractAbi;
  }
  async function makeBnsContractCall(
    txOptions: SignedContractCallOptions
  ): Promise<StacksTransaction> {
    const abi = await getBnsContractAbi();
    const senderAddress = getAddressFromPrivateKey(txOptions.senderKey, TransactionVersion.Testnet);
    const nonces = await testEnv.db.getAddressNonces({ stxAddress: senderAddress });
    const options = {
      ...txOptions,
      validateWithAbi: abi,
      nonce: txOptions.nonce ?? BigInt(nonces.possibleNextNonce),
    };
    return await makeContractCall(options);
  }
  async function standbyBnsName(expectedTxId: string): Promise<string> {
    const broadcastTx = new Promise<string>(resolve => {
      const listener: (txId: string) => void = txId => {
        if (txId === expectedTxId) {
          testEnv.api.datastore.eventEmitter.removeListener('nameUpdate', listener);
          resolve(txId);
        }
      };
      testEnv.api.datastore.eventEmitter.addListener('nameUpdate', listener);
    });

    const txid = await broadcastTx;
    return txid;
  }
  async function getContractTransaction(txOptions: SignedContractCallOptions, zonefile?: string) {
    const transaction = await makeBnsContractCall(txOptions);
    const body: { tx: string; attachment?: string } = {
      tx: Buffer.from(transaction.serialize()).toString('hex'),
    };
    if (zonefile) body.attachment = Buffer.from(zonefile).toString('hex');
    const apiResult = await fetch(testEnv.stacksNetwork.getBroadcastApiUrl(), {
      method: 'post',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    await apiResult.json();
    const expectedTxId = '0x' + transaction.txid();
    const standByNamePromise = standbyBnsName(expectedTxId);
    const result = await standByForTx(expectedTxId);
    if (result.status != 1) throw new Error('result status error');
    await standByNamePromise;
    return transaction;
  }
  async function namespacePreorder(namespaceHash: Buffer, testnetKey: TestnetKey) {
    const txOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'namespace-preorder',
      functionArgs: [bufferCV(namespaceHash), uintCV(64000000000)],
      senderKey: testnetKey.pkey,
      validateWithAbi: true,
      postConditions: [
        makeStandardSTXPostCondition(testnetKey.address, FungibleConditionCode.GreaterEqual, 1),
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };

    const transaction = await makeBnsContractCall(txOptions);
    await broadcastTransaction(transaction, testEnv.stacksNetwork);
    const preorder = await standByForTx('0x' + transaction.txid());
    if (preorder.status != 1) logger.error('Namespace preorder error');

    return transaction;
  }
  async function namespaceReveal(
    namespace: string,
    salt: Buffer,
    testnetKey: TestnetKey,
    expiration: number
  ) {
    const revealTxOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'namespace-reveal',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(salt),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(1),
        uintCV(expiration), //this number is set to expire the name before calling name-revewal
        standardPrincipalCV(testnetKey.address),
      ],
      senderKey: testnetKey.pkey,
      validateWithAbi: true,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };
    const revealTransaction = await makeBnsContractCall(revealTxOptions);
    await broadcastTransaction(revealTransaction, testEnv.stacksNetwork);
    const reveal = await standByForTx('0x' + revealTransaction.txid());
    if (reveal.status != 1) logger.error('Namespace Reveal Error');
    return revealTransaction;
  }
  async function initiateNamespaceNetwork(
    namespace: string,
    salt: Buffer,
    namespaceHash: Buffer,
    testnetKey: TestnetKey,
    expiration: number
  ) {
    await namespacePreorder(namespaceHash, testnetKey);
    await namespaceReveal(namespace, salt, testnetKey, expiration);
  }
  async function namespaceReady(namespace: string, pkey: string) {
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'namespace-ready',
      functionArgs: [bufferCV(Buffer.from(namespace))],
      senderKey: pkey,
      validateWithAbi: true,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };
    const transaction = await makeBnsContractCall(txOptions);
    await broadcastTransaction(transaction, testEnv.stacksNetwork);
    const readyResult = await standByForTx('0x' + transaction.txid());
    if (readyResult.status != 1) logger.error('namespace-ready error');
    return transaction;
  }
  async function nameImport(
    namespace: string,
    zonefile: string,
    name: string,
    testnetKey: TestnetKey
  ) {
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-import',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name)),
        standardPrincipalCV(testnetKey.address),
        bufferCV(hash160(Buffer.from(zonefile))),
      ],
      senderKey: testnetKey.pkey,
      validateWithAbi: true,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };
    return await getContractTransaction(txOptions, zonefile);
  }
  async function nameUpdate(namespace: string, zonefile: string, name: string, pkey: string) {
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-update',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name)),
        bufferCV(hash160(Buffer.from(zonefile))),
      ],
      senderKey: pkey,
      validateWithAbi: true,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };

    return await getContractTransaction(txOptions, zonefile);
  }
  async function namePreorder(
    namespace: string,
    saltName: string,
    testnetKey: TestnetKey,
    name: string
  ) {
    const postConditions = [
      makeStandardSTXPostCondition(testnetKey.address, FungibleConditionCode.GreaterEqual, 1),
    ];
    const fqn = `${name}.${namespace}${saltName}`;
    const nameSaltedHash = hash160(Buffer.from(fqn));
    const preOrderTxOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-preorder',
      functionArgs: [bufferCV(nameSaltedHash), uintCV(64000000000)],
      senderKey: testnetKey.pkey,
      validateWithAbi: true,
      postConditions: postConditions,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };

    const preOrderTransaction = await makeBnsContractCall(preOrderTxOptions);
    await broadcastTransaction(preOrderTransaction, testEnv.stacksNetwork);
    const preorderResult = await standByForTx('0x' + preOrderTransaction.txid());
    return preOrderTransaction;
  }
  async function nameRegister(
    namespace: string,
    saltName: string,
    zonefile: string,
    testnetKey: TestnetKey,
    name: string
  ) {
    await namePreorder(namespace, saltName, testnetKey, name);
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-register',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name)),
        bufferCV(Buffer.from(saltName)),
        bufferCV(hash160(Buffer.from(zonefile))),
      ],
      senderKey: testnetKey.pkey,
      validateWithAbi: true,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };
    return await getContractTransaction(txOptions, zonefile);
  }
  async function nameTransfer(namespace: string, name: string, testnetKey: TestnetKey) {
    const txOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-transfer',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name)),
        standardPrincipalCV(testnetKey.address),
        noneCV(),
      ],
      senderKey: testnetKey.pkey,
      validateWithAbi: true,
      postConditionMode: PostConditionMode.Allow,
      anchorMode: AnchorMode.Any,
      network: testEnv.stacksNetwork,
      fee: 100000,
    };

    return await getContractTransaction(txOptions);
  }
  async function nameRevoke(namespace: string, name: string, pkey: string) {
    const txOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-revoke',
      functionArgs: [bufferCV(Buffer.from(namespace)), bufferCV(Buffer.from(name))],
      senderKey: pkey,
      validateWithAbi: true,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };
    return await getContractTransaction(txOptions);
  }
  async function nameRenewal(namespace: string, zonefile: string, pkey: string, name: string) {
    const txOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-renewal',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name)),
        uintCV(2560000),
        noneCV(),
        someCV(bufferCV(hash160(Buffer.from(zonefile)))),
      ],
      senderKey: pkey,
      validateWithAbi: true,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 100000,
    };
    return await getContractTransaction(txOptions);
  }

  before(async () => {
    testEnv = await getTestEnv();
  });

  after(async () => {
    await stopTestEnv(testEnv);
  });

  test('name-import/ready/update contract call', async () => {
    const namespace = 'name-import';
    const name = 'alice';
    const importZonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = {
      pkey: FAUCET_TESTNET_KEYS[0].secretKey,
      address: FAUCET_TESTNET_KEYS[0].stacksAddress,
    };

    // initalizing namespace network - preorder and reveal
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 12);

    // testing name import
    await nameImport(namespace, importZonefile, name, testnetKey);

    const importQuery = await testEnv.db.getName({
      name: `${name}.${namespace}`,
      includeUnanchored: false,
    });
    const importQuery1 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(importQuery1.status, 200);
    assert.equal(importQuery1.type, 'application/json');
    assert.equal(importQuery.found, true);
    if (importQuery.found) {
      assert.equal(importQuery.result.zonefile, importZonefile);
    }

    // testing namespace ready
    await namespaceReady(namespace, testnetKey.pkey);

    const readyQuery1 = await supertest(testEnv.api.server).get('/v1/namespaces');
    const readyResult = JSON.parse(readyQuery1.text);
    assert.ok(readyResult.namespaces.includes(namespace));
  });

  test('name-update contract call', async () => {
    const namespace = 'name-update';
    const name = 'update';
    const importZonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = {
      pkey: FAUCET_TESTNET_KEYS[1].secretKey,
      address: FAUCET_TESTNET_KEYS[1].stacksAddress,
    };

    // initalizing namespace network - preorder and reveal
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 12);

    // testing name import
    await nameImport(namespace, importZonefile, name, testnetKey);

    await namespaceReady(namespace, testnetKey.pkey);

    // testing name update 1
    let zonefile = `$TTL 3600
    1yeardaily TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAxeWVhcmRhaWx5CiRUVEwgMzYwMApfaHR0cC5fdGNwIFVSSSAxMCAxICJodHRwczovL3BoLmRvdHBvZGNhc3QuY28vMXllYXJkYWlseS9oZWFkLmpzb24iCg=="
    _http._tcp URI 10 1 "https://dotpodcast.co/"`;

    try {
      // testing name update
      await nameUpdate(namespace, zonefile, name, testnetKey.pkey);
      const query1 = await supertest(testEnv.api.server).get(
        `/v1/names/1yeardaily.${name}.${namespace}`
      );
      assert.equal(query1.status, 200);
      assert.equal(query1.type, 'application/json');
      const query2 = await testEnv.db.getSubdomain({
        subdomain: `1yeardaily.${name}.${namespace}`,
        includeUnanchored: false,
        chainId: ChainID.Testnet,
      });
      assert.equal(query2.found, true);
      if (query2.result) assert.equal(query2.result.resolver, '');

      const query3 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
      assert.equal(query3.status, 200);
      assert.equal(query3.type, 'application/json');
      assert.equal(query3.body.zonefile, zonefile);
    } catch (err: any) {
      throw new Error('Error post transaction: ' + err.message);
    }
    // testing name update 2
    zonefile = `$TTL 3600
    1yeardaily TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAxeWVhcmRhaWx5CiRUVEwgMzYwMApfaHR0cC5fdGNwIFVSSSAxMCAxICJodHRwczovL3BoLmRvdHBvZGNhc3QuY28vMXllYXJkYWlseS9oZWFkLmpzb24iCg=="Í
    2dopequeens TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAyZG9wZXF1ZWVucwokVFRMIDM2MDAKX2h0dHAuX3RjcCBVUkkgMTAgMSAiaHR0cHM6Ly9waC5kb3Rwb2RjYXN0LmNvLzJkb3BlcXVlZW5zL2hlYWQuanNvbiIK"
    10happier TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAxMGhhcHBpZXIKJFRUTCAzNjAwCl9odHRwLl90Y3AgVVJJIDEwIDEgImh0dHBzOi8vcGguZG90cG9kY2FzdC5jby8xMGhhcHBpZXIvaGVhZC5qc29uIgo="
    31thoughts TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAzMXRob3VnaHRzCiRUVEwgMzYwMApfaHR0cC5fdGNwIFVSSSAxMCAxICJodHRwczovL3BoLmRvdHBvZGNhc3QuY28vMzF0aG91Z2h0cy9oZWFkLmpzb24iCg=="
    359 TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAzNTkKJFRUTCAzNjAwCl9odHRwLl90Y3AgVVJJIDEwIDEgImh0dHBzOi8vcGguZG90cG9kY2FzdC5jby8zNTkvaGVhZC5qc29uIgo="
    30for30 TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAzMGZvcjMwCiRUVEwgMzYwMApfaHR0cC5fdGNwIFVSSSAxMCAxICJodHRwczovL3BoLmRvdHBvZGNhc3QuY28vMzBmb3IzMC9oZWFkLmpzb24iCg=="
    excluded TXT "subdomain should not include"
    10minuteteacher TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAxMG1pbnV0ZXRlYWNoZXIKJFRUTCAzNjAwCl9odHRwLl90Y3AgVVJJIDEwIDEgImh0dHBzOi8vcGguZG90cG9kY2FzdC5jby8xMG1pbnV0ZXRlYWNoZXIvaGVhZC5qc29uIgo="
    36questionsthepodcastmusical TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAzNnF1ZXN0aW9uc3RoZXBvZGNhc3RtdXNpY2FsCiRUVEwgMzYwMApfaHR0cC5fdGNwIFVSSSAxMCAxICJodHRwczovL3BoLmRvdHBvZGNhc3QuY28vMzZxdWVzdGlvbnN0aGVwb2RjYXN0bXVzaWNhbC9oZWFkLmpzb24iCg=="
    _http._tcp URI 10 1 "https://dotpodcast.co/"`;
    await nameUpdate(namespace, zonefile, name, testnetKey.pkey);
    const query1 = await supertest(testEnv.api.server).get(
      `/v1/names/2dopequeens.${name}.${namespace}`
    );
    assert.equal(query1.status, 200);
    assert.equal(query1.type, 'application/json');

    const query2 = await testEnv.db.getSubdomainsList({ page: 0, includeUnanchored: false });
    assert.equal(
      query2.results.filter(function (value: string) {
        return value === `1yeardaily.${name}.${namespace}`;
      }).length,
      1
    );
    const query3 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query3.status, 200);
    assert.equal(query3.type, 'application/json');
    assert.equal(query3.body.zonefile, zonefile); //zone file updated of same name

    const query4 = await supertest(testEnv.api.server).get(
      `/v1/names/36questionsthepodcastmusical.${name}.${namespace}`
    );
    assert.equal(query4.status, 200);

    const query5 = await supertest(testEnv.api.server).get(
      `/v1/names/excluded.${name}.${namespace}`
    );
    assert.equal(query5.status, 404);
    assert.equal(query5.type, 'application/json');

    // testing nameupdate 3
    zonefile = `$TTL 3600
    _http._tcp URI 10 1 "https://dotpodcast.co/"`;
    await nameUpdate(namespace, zonefile, name, testnetKey.pkey);

    const query6 = await supertest(testEnv.api.server).get(
      `/v1/names/2dopequeens.${name}.${namespace}`
    ); //check if previous sobdomains are still there
    assert.equal(query6.status, 200);
    assert.equal(query6.type, 'application/json');
    const query7 = await testEnv.db.getSubdomainsList({ page: 0, includeUnanchored: false });
    assert.ok(query7.results.includes(`1yeardaily.${name}.${namespace}`));
    const query8 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query8.status, 200);
    assert.equal(query8.type, 'application/json');
    assert.equal(query8.body.zonefile, zonefile);
  });

  test('name-register/transfer contract call', async () => {
    const saltName = '0000';
    const name = 'bob';
    const namespace = 'name-register';
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const zonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const importZonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const testnetKey = {
      pkey: FAUCET_TESTNET_KEYS[2].secretKey,
      address: FAUCET_TESTNET_KEYS[2].stacksAddress,
    };
    // initializing namespace network
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 12);
    await namespaceReady(namespace, testnetKey.pkey);

    // testing name register
    await nameRegister(namespace, saltName, zonefile, testnetKey, name);
    const query1 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query1.status, 200);
    assert.equal(query1.type, 'application/json');
    const query = await testEnv.db.getName({
      name: `${name}.${namespace}`,
      includeUnanchored: false,
    });
    assert.equal(query.found, true);
    if (query.found) {
      assert.equal(query.result.zonefile, zonefile);
    }
    // testing name transfer
    const transferTestnetKey = {
      pkey: FAUCET_TESTNET_KEYS[2].secretKey,
      address: FAUCET_TESTNET_KEYS[3].stacksAddress,
    };
    await nameTransfer(namespace, name, transferTestnetKey);

    const query2 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query2.status, 200);
    assert.equal(query2.type, 'application/json');
    assert.equal(query2.body.zonefile, '');
    assert.equal(query2.body.status, 'name-transfer');
  });

  test('name-revoke contract call', async () => {
    //name revoke
    const namespace = 'name-revoke';
    const name = 'foo';
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = {
      pkey: FAUCET_TESTNET_KEYS[4].secretKey,
      address: FAUCET_TESTNET_KEYS[4].stacksAddress,
    };
    const zonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;

    // initializing namespace network
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 12);
    await nameImport(namespace, zonefile, name, testnetKey);
    await namespaceReady(namespace, testnetKey.pkey);

    // testing name revoke
    await nameRevoke(namespace, name, testnetKey.pkey);
    const query1 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query1.status, 404);
    assert.equal(query1.type, 'application/json');
  });

  test('name-import/name-renewal contract call', async () => {
    const zonefile = `new zone file`;
    const namespace = 'name-renewal';
    const name = 'renewal';
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = {
      pkey: FAUCET_TESTNET_KEYS[5].secretKey,
      address: FAUCET_TESTNET_KEYS[5].stacksAddress,
    };

    // initializing namespace network
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 1);
    await nameImport(namespace, zonefile, name, testnetKey);
    await namespaceReady(namespace, testnetKey.pkey);

    // check expiration block
    const query0 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query0.status, 200);
    assert.equal(query0.type, 'application/json');
    assert.equal(query0.body.expire_block, 0); // Imported names don't know about their namespaces

    // name renewal
    await nameRenewal(namespace, zonefile, testnetKey.pkey, name);
    const query1 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query1.status, 200);
    assert.equal(query1.type, 'application/json');
    assert.equal(query1.body.zonefile, zonefile);
    assert.equal(query1.body.status, 'name-renewal');

    // Name should appear only once in namespace list
    const query2 = await supertest(testEnv.api.server).get(`/v1/namespaces/${namespace}/names`);
    assert.equal(query2.status, 200);
    assert.equal(query2.type, 'application/json');
    assert.deepStrictEqual(query2.body, ['renewal.name-renewal']);

    // check new expiration block, should not be 0
    const query3 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query3.status, 200);
    assert.equal(query3.type, 'application/json');
    assert.notEqual(query3.body.expire_block, 0);
  });

  test('name-register/name-renewal contract call', async () => {
    const saltName = '0000';
    const zonefile = `new zone file`;
    const namespace = 'name-renewal2';
    const name = 'renewal2';
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = {
      pkey: FAUCET_TESTNET_KEYS[5].secretKey,
      address: FAUCET_TESTNET_KEYS[5].stacksAddress,
    };

    // initializing namespace network
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 1);
    await namespaceReady(namespace, testnetKey.pkey);
    await nameRegister(namespace, saltName, zonefile, testnetKey, name);

    // check expiration block, should not be 0
    const query0 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query0.status, 200);
    assert.equal(query0.type, 'application/json');
    assert.notEqual(query0.body.expire_block, 0);
    const prevExpiration = query0.body.expire_block;

    // name renewal
    await nameRenewal(namespace, zonefile, testnetKey.pkey, name);
    const query1 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query1.status, 200);
    assert.equal(query1.type, 'application/json');
    assert.equal(query1.body.zonefile, zonefile);
    assert.equal(query1.body.status, 'name-renewal');

    // check new expiration block, should be greater than the previous one
    const query3 = await supertest(testEnv.api.server).get(`/v1/names/${name}.${namespace}`);
    assert.equal(query3.status, 200);
    assert.equal(query3.type, 'application/json');
    assert.ok(query3.body.expire_block > prevExpiration);
  });
});
