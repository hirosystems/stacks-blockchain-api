


import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { createHash } from 'crypto';
import { DbTx, DbTxStatus } from '../datastore/common';
import { AnchorMode, ChainID, PostConditionMode, someCV } from '@stacks/transactions';
import { StacksMocknet } from '@stacks/network';

import {
  broadcastTransaction,
  bufferCV,
  FungibleConditionCode,
  makeContractCall,
  makeStandardSTXPostCondition,
  standardPrincipalCV,
  uintCV,
  SignedContractCallOptions,
  noneCV,
} from '@stacks/transactions';
import BigNum = require('bn.js');
import { logger } from '../helpers';
import { testnetKeys } from '../api/routes/debug';
import { importV1BnsData } from '../import-v1';
import * as assert from 'assert';
import { TestBlockBuilder } from '../test-utils/test-builders';

function hash160(bfr: Buffer): Buffer {
  const hash160 = createHash('ripemd160')
    .update(createHash('sha256').update(bfr).digest())
    .digest('hex');
  return Buffer.from(hash160, 'hex');
}

const network = new StacksMocknet();

const deployedTo = 'ST000000000000000000002AMW42H';
const deployedName = 'bns';
const salt = Buffer.from('60104ad42ed976f5b8cfd6341496476aa72d1101', 'hex'); // salt and pepper

type TestnetKey = {
  pkey: string;
  address: string;
}

describe('BNS integration tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: Server;
  let api: ApiServer;

  function standByForTx(expectedTxId: string): Promise<DbTx> {
    const broadcastTx = new Promise<DbTx>(resolve => {
      const listener: (txId: string) => void = async txId => {
        const dbTxQuery = await api.datastore.getTx({ txId: txId, includeUnanchored: true });
        if (!dbTxQuery.found) {
          return;
        }
        const dbTx = dbTxQuery.result as DbTx;
        if (
          dbTx.tx_id === expectedTxId &&
          (dbTx.status === DbTxStatus.Success ||
            dbTx.status === DbTxStatus.AbortByResponse ||
            dbTx.status === DbTxStatus.AbortByPostCondition)
        ) {
          api.datastore.removeListener('txUpdate', listener);
          resolve(dbTx);
        }
      };
      api.datastore.addListener('txUpdate', listener);
    });

    return broadcastTx;
  }
  function standbyBnsName(expectedTxId: string): Promise<string> {
    const broadcastTx = new Promise<string>(resolve => {
      const listener: (txId: string) => void = txId => {
        if (txId === expectedTxId) {
          api.datastore.removeListener('nameUpdate', listener);
          resolve(txId);
        }
      };
      api.datastore.addListener('nameUpdate', listener);
    });

    return broadcastTx;
  }
  async function getContractTransaction(txOptions: SignedContractCallOptions, zonefile?: string) {
    const transaction = await makeContractCall(txOptions);
    const body: {tx: string, attachment?: string} = {
      tx: transaction.serialize().toString('hex'),
    };
    if(zonefile) body.attachment = Buffer.from(zonefile).toString('hex');
    const apiResult = await fetch(network.getBroadcastApiUrl(), {
      method: 'post',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    const submitResult = await apiResult.json();
    const expectedTxId = '0x' + transaction.txid();
    const result = await standByForTx(expectedTxId);
    if (result.status != 1) logger.error('name-import error');
    await standbyBnsName(expectedTxId);
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
      postConditions: [makeStandardSTXPostCondition(testnetKey.address, FungibleConditionCode.GreaterEqual, new BigNum(1))],
      network,
      anchorMode: AnchorMode.Any
    };

    const transaction = await makeContractCall(txOptions);
    await broadcastTransaction(transaction, network);
    const preorder = await standByForTx('0x' + transaction.txid());
    if (preorder.status != 1) logger.error('Namespace preorder error');

    return transaction;
  }
  async function namespaceReveal(namespace: string, salt: Buffer, testnetKey: TestnetKey, expiration: number) {
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
      network,
      anchorMode: AnchorMode.Any
    };
    const revealTransaction = await makeContractCall(revealTxOptions);
    await broadcastTransaction(revealTransaction, network);
    const reveal = await standByForTx('0x' + revealTransaction.txid());
    if (reveal.status != 1) logger.error('Namespace Reveal Error');
    return revealTransaction;
  }
  async function initiateNamespaceNetwork(namespace: string, salt: Buffer, namespaceHash: Buffer, testnetKey: TestnetKey, expiration: number){
    while (true) {
      try {
        const preorderTransaction = await namespacePreorder(namespaceHash, testnetKey);

        const revealTransaction = await namespaceReveal(namespace, salt, testnetKey, expiration);

        break;
      } catch (e) {
        console.log('error connection', e);
      }
    }
  }
  async function namespaceReady(namespace: string, pkey: string) {
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'namespace-ready',
      functionArgs: [bufferCV(Buffer.from(namespace))],
      senderKey: pkey,
      validateWithAbi: true,
      network,
      anchorMode: AnchorMode.Any
    };

    const transaction = await makeContractCall(txOptions);
    await broadcastTransaction(transaction, network);

    const readyResult = await standByForTx('0x' + transaction.txid());
    if (readyResult.status != 1) logger.error('namespace-ready error');

    return transaction;
  }
  async function nameImport(namespace: string, zonefile: string, name: string, testnetKey: TestnetKey) {
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
      network,
      anchorMode: AnchorMode.Any
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
      network,
      anchorMode: AnchorMode.Any
    };

    return await getContractTransaction(txOptions, zonefile);
  }
  async function namePreorder(namespace: string, saltName: string, testnetKey: TestnetKey, name: string) {
    const postConditions = [
      makeStandardSTXPostCondition(testnetKey.address, FungibleConditionCode.GreaterEqual, new BigNum(1)),
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
      network,
      anchorMode: AnchorMode.Any
    };

    const preOrderTransaction = await makeContractCall(preOrderTxOptions);
    await broadcastTransaction(preOrderTransaction, network);
    const preorderResult = await standByForTx('0x' + preOrderTransaction.txid());
    return preOrderTransaction;
  }
  async function nameRegister(namespace: string, saltName: string, zonefile: string, testnetKey: TestnetKey, name: string) {
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
      network,
      anchorMode: AnchorMode.Any
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
      network,
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
      network,
      anchorMode: AnchorMode.Any
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
      network,
      anchorMode: AnchorMode.Any
    };
    return await getContractTransaction(txOptions);
  }

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect({ usageName: 'tests' });
    client = await db.pool.connect();
    eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });

    const block = new TestBlockBuilder().build();
    await db.update(block);
  });

  test('name-import/ready/update contract call', async () => {
    const namespace = 'name-import';
    const name = 'alice';
    const importZonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = { pkey: testnetKeys[0].secretKey, address: testnetKeys[0].stacksAddress};

    // initalizing namespace network - preorder and reveal
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 12);

    // testing name import
    await nameImport(namespace, importZonefile, name, testnetKey);

    const importQuery = await db.getName({ name: `${name}.${namespace}`, includeUnanchored: false });
    const importQuery1 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
    expect(importQuery1.status).toBe(200);
    expect(importQuery1.type).toBe('application/json');
    expect(importQuery.found).toBe(true);
    if (importQuery.found) {
      expect(importQuery.result.zonefile).toBe(importZonefile);
    }

    // testing namespace ready
    await namespaceReady(namespace, testnetKey.pkey);

    const readyQuery1 = await supertest(api.server).get('/v1/namespaces');
    const readyResult = JSON.parse(readyQuery1.text);
    expect(readyResult.namespaces.includes(namespace)).toBe(true);
  });

  test('name-update contract call', async () => {
    const namespace = 'name-update';
    const name = 'update';
    const importZonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = { pkey: testnetKeys[1].secretKey, address: testnetKeys[1].stacksAddress};

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
      const query1 = await supertest(api.server).get(`/v1/names/1yeardaily.${name}.${namespace}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      const query2 = await db.getSubdomain({ subdomain: `1yeardaily.${name}.${namespace}`, includeUnanchored: false });
      expect(query2.found).toBe(true);
      if(query2.result)
        expect(query2.result.resolver).toBe('');

      const query3 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
      expect(query3.status).toBe(200);
      expect(query3.type).toBe('application/json');
      expect(query3.body.zonefile).toBe(zonefile);
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
    const query1 = await supertest(api.server).get(`/v1/names/2dopequeens.${name}.${namespace}`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');

    const query2 = await db.getSubdomainsList({ page: 0, includeUnanchored: false });
    expect(
      query2.results.filter(function (value) {
        return value === `1yeardaily.${name}.${namespace}`;
      }).length
    ).toBe(1);
    const query3 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
    expect(query3.status).toBe(200);
    expect(query3.type).toBe('application/json');
    expect(query3.body.zonefile).toBe(zonefile); //zone file updated of same name

    const query4 = await supertest(api.server).get(
      `/v1/names/36questionsthepodcastmusical.${name}.${namespace}`
    );
    expect(query4.status).toBe(200);

    const query5 = await supertest(api.server).get(`/v1/names/excluded.${name}.${namespace}`);
    expect(query5.status).toBe(404);
    expect(query5.type).toBe('application/json');

    // testing nameupdate 3
    zonefile = `$TTL 3600
    _http._tcp URI 10 1 "https://dotpodcast.co/"`;
    await nameUpdate(namespace, zonefile, name, testnetKey.pkey);

    try {
      const query6 = await supertest(api.server).get(`/v1/names/2dopequeens.${name}.${namespace}`); //check if previous sobdomains are still there
      expect(query6.status).toBe(200);
      expect(query6.type).toBe('application/json');
      const query7 = await db.getSubdomainsList({ page: 0, includeUnanchored: false });
      expect(query7.results).toContain(`1yeardaily.${name}.${namespace}`);
      const query8 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
      expect(query8.status).toBe(200);
      expect(query8.type).toBe('application/json');
      expect(query8.body.zonefile).toBe(zonefile);
    } catch (err: any) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('name-register/transfer contract call', async () => {
    const saltName = '0000';
    const name = 'bob';
    const namespace = 'name-register';
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const zonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const importZonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const testnetKey = { pkey: testnetKeys[2].secretKey, address: testnetKeys[2].stacksAddress};
    // initializing namespace network 
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 12);
    await namespaceReady(namespace, testnetKey.pkey);

    // testing name register
    await nameRegister(namespace, saltName, zonefile, testnetKey, name);
    const query1 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    const query = await db.getName({ name: `${name}.${namespace}`, includeUnanchored: false });
    expect(query.found).toBe(true);
    if (query.found) {
      expect(query.result.zonefile).toBe(zonefile);
    }
    // testing name transfer
    const transferTestnetKey = { pkey: testnetKeys[2].secretKey, address: testnetKeys[3].stacksAddress};
    await nameTransfer(namespace, name, transferTestnetKey);

    try {
      const query1 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      expect(query1.body.zonefile).toBe('');
      expect(query1.body.status).toBe('name-transfer');
    } catch (err: any) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('name-revoke contract call', async () => {
    //name revoke
    const namespace = 'name-revoke';
    const name = 'foo';
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = { pkey: testnetKeys[4].secretKey, address: testnetKeys[4].stacksAddress};
    const zonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    
    // initializing namespace network
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 12);
    await nameImport(namespace, zonefile, name, testnetKey);
    await namespaceReady(namespace, testnetKey.pkey);

    // testing name revoke
    const transaction = await nameRevoke(namespace, name, testnetKey.pkey);
    const query1 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(query1.body.status).toBe('name-revoke');
  });

  test('name-renewal contract call', async () => {
    const zonefile = `new zone file`;
    const namespace = 'name-renewal';
    const name = 'renewal';
    const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
    const testnetKey = { pkey: testnetKeys[5].secretKey, address: testnetKeys[5].stacksAddress};
    
    // initializing namespace network
    await initiateNamespaceNetwork(namespace, salt, namespaceHash, testnetKey, 1);
    await nameImport(namespace, zonefile, name, testnetKey);
    await namespaceReady(namespace, testnetKey.pkey);

    //name renewal
    await nameRenewal(namespace, zonefile, testnetKey.pkey, name);
    try {
      const query1 = await supertest(api.server).get(`/v1/names/${name}.${namespace}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      expect(query1.body.zonefile).toBe(zonefile);
      expect(query1.body.status).toBe('name-renewal');
    } catch (err: any) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('bns v1-import', async () => {
    await importV1BnsData(db, 'src/tests-bns/import-test-files');

    // test on-chain name import
    const query1 = await supertest(api.server).get(`/v1/names/zumrai.id`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(query1.body).toEqual({
      address: 'SP29EJ0SVM2TRZ3XGVTZPVTKF4SV1VMD8C0GA5SK5',
      blockchain: 'stacks',
      expire_block: 52595,
      last_txid: '',
      status: 'name-register',
      zonefile:
        '$ORIGIN zumrai.id\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1EPno1VcdGx89ukN2we4iVpnFtkHzw8i5d/profile.json"\n\n',
      zonefile_hash: '853cd126478237bc7392e65091f7ffa5a1556a33',
    });

    // test subdomain import
    const query2 = await supertest(api.server).get(`/v1/names/flushreset.id.blockstack`);
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(query2.body).toEqual({
      address: 'SP2S2F9TCAT43KEJT02YTG2NXVCPZXS1426T63D9H',
      blockchain: 'stacks',
      last_txid: '',
      resolver: 'https://registrar.blockstack.org',
      status: 'registered_subdomain',
      zonefile:
        '$ORIGIN flushreset.id.blockstack\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1HEznKZ7mK5fmibweM7eAk8SwRgJ1bWY92/profile.json"\n\n',
      zonefile_hash: '14dc091ebce8ea117e1276d802ee903cc0fdde81',
    });

    const dbquery = await db.getSubdomain({ subdomain: `flushreset.id.blockstack`, includeUnanchored: false });
    assert(dbquery.found)
    if (dbquery.result){
    expect(dbquery.result.name).toBe('id.blockstack');}
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});

