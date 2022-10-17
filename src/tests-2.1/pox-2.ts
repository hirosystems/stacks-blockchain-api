/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { TestEnvContext } from './env-setup';
import { ApiServer } from '../api/init';
import * as supertest from 'supertest';
import { Server } from 'net';
import { DbBlock, DbEventTypeId, DbStxLockEvent, DbTx, DbTxStatus } from '../datastore/common';
import { AnchorMode, bufferCV, makeContractCall, tupleCV, uintCV } from '@stacks/transactions';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { testnetKeys } from '../api/routes/debug';
import * as poxHelpers from '../pox-helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { StacksNetwork } from '@stacks/network';
import * as btcLib from 'bitcoinjs-lib';

describe('PoX-2 tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork } = testEnv);
    await Promise.resolve();
  });

  function standByForTx(expectedTxId: string): Promise<DbTx> {
    return new Promise<DbTx>(resolve => {
      const listener: (txId: string) => void = async txId => {
        if (txId !== expectedTxId) {
          return;
        }
        const dbTxQuery = await api.datastore.getTx({ txId: txId, includeUnanchored: false });
        if (!dbTxQuery.found) {
          return;
        }
        api.datastore.eventEmitter.removeListener('txUpdate', listener);
        resolve(dbTxQuery.result);
      };
      api.datastore.eventEmitter.addListener('txUpdate', listener);
    });
  }

  function standByUntilBlock(blockHeight: number): Promise<DbBlock> {
    return new Promise<DbBlock>(async resolve => {
      const curHeight = await api.datastore.getCurrentBlockHeight();
      if (curHeight.found && curHeight.result >= blockHeight) {
        const dbBlock = await api.datastore.getBlock({ height: curHeight.result });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        resolve(dbBlock.result);
        return;
      }
      const listener: (blockHash: string) => void = async blockHash => {
        const dbBlockQuery = await api.datastore.getBlock({ hash: blockHash });
        if (!dbBlockQuery.found || dbBlockQuery.result.block_height < blockHeight) {
          return;
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlockQuery.result);
      };
      api.datastore.eventEmitter.addListener('blockUpdate', listener);
    });
  }

  async function fetchPost<TPostBody, TRes>(endpoint: string, body: TPostBody) {
    const result = await supertest(api.server)
      .post(endpoint)
      .send(body as any);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
  }

  async function fetchGet<TRes>(endpoint: string) {
    const result = await supertest(api.server).get(endpoint);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
  }

  test('PoX-2 - stack-stx', async () => {
    const account = testnetKeys[1];

    const btcAccount = btcLib.ECPair.makeRandom({
      compressed: true,
      network: btcLib.networks.testnet,
    });
    const btcAddr = btcLib.payments.p2pkh({
      pubkey: btcAccount.publicKey,
      network: btcLib.networks.testnet,
    }).address!;

    const cycleCount = 5;
    const poxInfo = await client.getPox();
    const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

    const [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-2');

    const decodedBtcAddr = poxHelpers.decodeBtcAddress(btcAddr);
    const burnBlockHeight = poxInfo.current_burnchain_block_height as number;
    const tx1 = await makeContractCall({
      senderKey: account.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-stx',
      functionArgs: [
        uintCV(ustxAmount.toString()),
        tupleCV({
          hashbytes: bufferCV(decodedBtcAddr.data),
          version: bufferCV(Buffer.from([decodedBtcAddr.version])),
        }),
        uintCV(burnBlockHeight),
        uintCV(cycleCount),
      ],
      network: stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 10000,
      validateWithAbi: false,
    });
    const expectedTxId1 = '0x' + tx1.txid();
    const txStandby1 = standByForTx(expectedTxId1);
    const sendResult1 = await client.sendTransaction(tx1.serialize());
    expect(sendResult1.txId).toBe(expectedTxId1);

    const dbTx1 = await txStandby1;
    expect(dbTx1.status).toBe(DbTxStatus.Success);
    const tx1Events = await api.datastore.getTxEvents({
      txId: dbTx1.tx_id,
      indexBlockHash: dbTx1.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    expect(tx1Events.results).toBeTruthy();
    const lockEvent1 = tx1Events.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    expect(lockEvent1).toBeDefined();

    await standByUntilBlock(dbTx1.block_height + 1);

    const nextPoxInfo = await client.getPox();
    expect(nextPoxInfo.next_reward_cycle_in).toBeTruthy();

    const stackExtendCycleCount = 3;
    const tx2 = await makeContractCall({
      senderKey: account.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-increase',
      functionArgs: [uintCV(stackExtendCycleCount)],
      network: stacksNetwork,
      anchorMode: AnchorMode.Any,
      fee: 10000,
      validateWithAbi: false,
    });
    const expectedTxId2 = '0x' + tx2.txid();
    const txStandby2 = standByForTx(expectedTxId2);
    const sendResult2 = await client.sendTransaction(tx2.serialize());
    expect(sendResult2.txId).toBe(expectedTxId2);

    const dbTx2 = await txStandby2;
    expect(dbTx2.status).toBe(DbTxStatus.Success);
    const tx2Events = await api.datastore.getTxEvents({
      txId: dbTx2.tx_id,
      indexBlockHash: dbTx2.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    expect(tx2Events.results).toBeTruthy();
    const lockEvent2 = tx2Events.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    expect(lockEvent2).toBeDefined();
  });
});
