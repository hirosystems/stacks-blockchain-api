import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbMempoolTx, DbTx, DbTxStatus } from '../datastore/common';
import { ChainID, someCV } from '@stacks/transactions';
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
import ripemd160 = require('ripemd160');
import shajs = require('sha.js');
import BigNum = require('bn.js');
import { logger } from '../helpers';
import { testnetKeys } from '../api/routes/debug';

function hash160(bfr: Buffer): Buffer {
  const hash160 = new ripemd160().update(new shajs.sha256().update(bfr).digest()).digest('hex');
  return Buffer.from(hash160, 'hex');
}

const network = new StacksMocknet();

const deployedTo = 'ST000000000000000000002AMW42H';
const deployedName = 'bns';

const pkey = testnetKeys[0].secretKey;
const address = testnetKeys[0].stacksAddress;
const pkey1 = testnetKeys[1].secretKey;
const address1 = testnetKeys[1].stacksAddress;
const pkey2 = testnetKeys[2].secretKey;
const address2 = testnetKeys[2].stacksAddress;

const salt = Buffer.from('60104ad42ed976f5b8cfd6341496476aa72d1101', 'hex'); // salt and pepper
const namespace = 'foo';
const namespaceHash = hash160(Buffer.concat([Buffer.from(namespace), salt]));
const name = 'alice';
const name1 = 'bob';
const postConditions = [
  makeStandardSTXPostCondition(address, FungibleConditionCode.GreaterEqual, new BigNum(1)),
];

describe('BNS API', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: Server;
  let api: ApiServer;

  function standByForTx(expectedTxId: string): Promise<DbTx> {
    const broadcastTx = new Promise<DbTx>(resolve => {
      const listener: (info: DbTx | DbMempoolTx) => void = info => {
        if (
          info.tx_id === expectedTxId &&
          (info.status === DbTxStatus.Success ||
            info.status === DbTxStatus.AbortByResponse ||
            info.status === DbTxStatus.AbortByPostCondition)
        ) {
          api.datastore.removeListener('txUpdate', listener);
          resolve(info as DbTx);
        }
      };
      api.datastore.addListener('txUpdate', listener);
    });

    return broadcastTx;
  }

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    eventServer = await startEventServer({ db, chainId: ChainID.Testnet });
    api = await startApiServer(db, ChainID.Testnet);

    //preorder and reveal namespace to the bns network
    while (true) {
      try {
        const txOptions: SignedContractCallOptions = {
          contractAddress: deployedTo,
          contractName: deployedName,
          functionName: 'namespace-preorder',
          functionArgs: [bufferCV(namespaceHash), uintCV(64000000000)],
          senderKey: pkey,
          validateWithAbi: true,
          postConditions: postConditions,
          network,
        };

        const transaction = await makeContractCall(txOptions);
        const submitResult = await broadcastTransaction(transaction, network);
        const preorder = await standByForTx('0x' + transaction.txid());
        if (preorder.status != 1) logger.error('Namespace preorder error');

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
            uintCV(6),
            standardPrincipalCV(address),
          ],
          senderKey: pkey,
          validateWithAbi: true,
          network,
        };

        const revealTransaction = await makeContractCall(revealTxOptions);
        await broadcastTransaction(revealTransaction, network);
        const reveal = await standByForTx('0x' + revealTransaction.txid());
        if (reveal.status != 1) logger.error('Namespace Reveal Error');

        break;
      } catch (e) {
        console.log('error connection', e);
      }
    }
  });

  test('name-import contract call', async () => {
    const zonefile = `$ORIGIN ${name}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name}.${namespace}"\n`;
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-import',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name)),
        standardPrincipalCV(address),
        bufferCV(hash160(Buffer.from(zonefile))),
      ],
      senderKey: pkey,
      validateWithAbi: true,
      network,
    };
    const transaction = await makeContractCall(txOptions);
    const body = {
      attachment: Buffer.from(zonefile).toString('hex'),
      tx: transaction.serialize().toString('hex'),
    };
    try {
      const apiResult = await fetch(network.getBroadcastApiUrl(), {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      const submitResult = await apiResult.json();
      const result = await standByForTx('0x' + transaction.txid());
      if (result.status != 1) logger.error('name-import error');
      const query1 = await supertest(api.server).get(`/v1/names/${name}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
    } catch (err) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('namespace-ready contract call', async () => {
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'namespace-ready',
      functionArgs: [bufferCV(Buffer.from(namespace))],
      senderKey: pkey,
      validateWithAbi: true,
      network,
    };

    const transaction = await makeContractCall(txOptions);

    const submitResult = await broadcastTransaction(transaction, network);

    const readyResult = await standByForTx('0x' + transaction.txid());
    if (readyResult.status != 1) logger.error('namespace-ready error');
    const query1 = await supertest(api.server).get('/v1/namespaces');
    const result = JSON.parse(query1.text);
    expect(result.namespaces.includes(namespace)).toBe(true);
  });

  test('name-update contract call', async () => {
    const zonefile = `$TTL 3600
    1yeardaily TXT "owner=1MwPD6dH4fE3gQ9mCov81L1DEQWT7E85qH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiAxeWVhcmRhaWx5CiRUVEwgMzYwMApfaHR0cC5fdGNwIFVSSSAxMCAxICJodHRwczovL3BoLmRvdHBvZGNhc3QuY28vMXllYXJkYWlseS9oZWFkLmpzb24iCg=="
    _http._tcp URI 10 1 "https://dotpodcast.co/"`;
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
    };

    const transaction = await makeContractCall(txOptions);
    const body = {
      attachment: Buffer.from(zonefile).toString('hex'),
      tx: transaction.serialize().toString('hex'),
    };

    try {
      const apiResult = await fetch(network.getBroadcastApiUrl(), {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const submitResult = await apiResult.json();

      const result = await standByForTx('0x' + transaction.txid());
      if (result.status != 1) logger.error('name-update error');
      const query1 = await supertest(api.server).get(`/v1/names/1yeardaily.${name}.${namespace}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      const query = await db.getSubdomainsList({ page: 0 });
      expect(query.results).toContain(`1yeardaily.${name}.${namespace}`);
    } catch (err) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('name-register contract call', async () => {
    const postConditions = [
      makeStandardSTXPostCondition(address1, FungibleConditionCode.GreaterEqual, new BigNum(1)),
    ];
    //name pre-order
    const saltName = '0000';
    const fqn = `${name1}.${namespace}${saltName}`;
    const nameSaltedHash = hash160(Buffer.from(fqn));
    const preOrderTxOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-preorder',
      functionArgs: [bufferCV(nameSaltedHash), uintCV(64000000000)],
      senderKey: pkey1,
      validateWithAbi: true,
      postConditions: postConditions,
      network,
    };

    const preOrderTransaction = await makeContractCall(preOrderTxOptions);
    const submitResult = await broadcastTransaction(preOrderTransaction, network);
    const preorderResult = await standByForTx('0x' + preOrderTransaction.txid());

    //name register
    const zonefile = `$ORIGIN ${name1}.${namespace}\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/${name1}.${namespace}"\n`;
    const txOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-register',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name1)),
        bufferCV(Buffer.from(saltName)),
        bufferCV(hash160(Buffer.from(zonefile))),
      ],
      senderKey: pkey1,
      validateWithAbi: true,
      network,
    };

    const transaction = await makeContractCall(txOptions);
    const body = {
      attachment: Buffer.from(zonefile).toString('hex'),
      tx: transaction.serialize().toString('hex'),
    };

    try {
      const apiResult = await fetch(network.getBroadcastApiUrl(), {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const submitResult = await apiResult.json();

      const result = await standByForTx('0x' + transaction.txid());
      if (result.status != 1) logger.error('name-register error');
      const query1 = await supertest(api.server).get(`/v1/names/${name1}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      const query = await db.getNamesList({ page: 0 });
      expect(query.results).toContain(name1);
    } catch (err) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('name-transfer contract call', async () => {
    //name transfer
    const txOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-transfer',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name)),
        standardPrincipalCV(address2),
        noneCV(),
      ],
      senderKey: pkey,
      validateWithAbi: true,
      postConditions: postConditions,
      network,
    };

    const transaction = await makeContractCall(txOptions);
    const body = {
      tx: transaction.serialize().toString('hex'),
    };

    try {
      const apiResult = await fetch(network.getBroadcastApiUrl(), {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const submitResult = await apiResult.json();

      const result = await standByForTx('0x' + transaction.txid());
      if (result.status != 1) logger.error('name-transfer error');
      const query1 = await supertest(api.server).get(`/v1/names/${name}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      expect(query1.body.zonefile).toBe('');
      expect(query1.body.status).toBe('name-transfer');
    } catch (err) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('name-revoke contract call', async () => {
    //name revoke
    const txOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-revoke',
      functionArgs: [bufferCV(Buffer.from(namespace)), bufferCV(Buffer.from(name))],
      senderKey: pkey,
      validateWithAbi: true,
      postConditions: postConditions,
      network,
    };

    const transaction = await makeContractCall(txOptions);
    const body = {
      tx: transaction.serialize().toString('hex'),
    };

    try {
      const apiResult = await fetch(network.getBroadcastApiUrl(), {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const submitResult = await apiResult.json();
      const result = await standByForTx('0x' + transaction.txid());
      if (result.status != 1) logger.error('name-revoke error');
      const query1 = await supertest(api.server).get(`/v1/names/${name}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      expect(query1.body.status).toBe('name-revoke');
    } catch (err) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  test('name-renewal contract call', async () => {
    const zonefile = `new zone file`;
    const postConditions1 = [
      makeStandardSTXPostCondition(address1, FungibleConditionCode.GreaterEqual, new BigNum(1)),
    ];
    //name renewal
    const txOptions: SignedContractCallOptions = {
      contractAddress: deployedTo,
      contractName: deployedName,
      functionName: 'name-renewal',
      functionArgs: [
        bufferCV(Buffer.from(namespace)),
        bufferCV(Buffer.from(name1)),
        uintCV(2560000),
        noneCV(),
        someCV(bufferCV(hash160(Buffer.from(zonefile)))),
      ],
      senderKey: pkey1,
      validateWithAbi: true,
      network,
    };

    const transaction = await makeContractCall(txOptions);
    const body = {
      attachment: Buffer.from(zonefile).toString('hex'),
      tx: transaction.serialize().toString('hex'),
    };

    try {
      const apiResult = await fetch(network.getBroadcastApiUrl(), {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const submitResult = await apiResult.json();
      console.log('name-renewal:  ', submitResult);

      const result = await standByForTx('0x' + transaction.txid());
      console.log('name-renewal result:  ', result);
      if (result.status != 1) logger.error('name-renewal: error');
      const query1 = await supertest(api.server).get(`/v1/names/${name1}`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      expect(query1.body.zonefile).toBe(zonefile);
      expect(query1.body.status).toBe('name-renewal');
    } catch (err) {
      throw new Error('Error post transaction: ' + err.message);
    }
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve(true)));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
