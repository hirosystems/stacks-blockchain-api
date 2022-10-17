/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { TestEnvContext } from './env-setup';
import { ApiServer } from '../api/init';
import * as supertest from 'supertest';
import { Server } from 'net';
import { DbBlock, DbEventTypeId, DbStxLockEvent, DbTx, DbTxStatus } from '../datastore/common';
import { AnchorMode, bufferCV, makeContractCall, tupleCV, uintCV } from '@stacks/transactions';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { testnetKeys } from '../api/routes/debug';
import * as poxHelpers from '../pox-helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { StacksNetwork } from '@stacks/network';
import * as btcLib from 'bitcoinjs-lib';
import { AddressStxBalanceResponse } from '@stacks/stacks-blockchain-api-types';

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

  describe('PoX-2 - Stacking operations', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let decodedBtcAddr: { version: number; data: Buffer };
    let poxInfo: CoreRpcPoxInfo;
    let burnBlockHeight: number;
    let cycleBlockLength: number;
    let contractAddress: string;
    let contractName: string;
    let ustxAmount: bigint;
    const cycleCount = 5;

    beforeAll(async () => {
      const btcAccount = btcLib.ECPair.makeRandom({
        compressed: true,
        network: btcLib.networks.testnet,
      });
      btcAddr = btcLib.payments.p2pkh({
        pubkey: btcAccount.publicKey,
        network: btcLib.networks.testnet,
      }).address!;
      decodedBtcAddr = poxHelpers.decodeBtcAddress(btcAddr);

      poxInfo = await client.getPox();
      burnBlockHeight = poxInfo.current_burnchain_block_height as number;

      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;

      [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox-2');
    });

    test('stack-stx tx', async () => {
      // Create and broadcast a `stack-stx` tx
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

      // Wait for API to receive and ingest tx
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
      expect(lockEvent1.locked_address).toBe(account.stacksAddress);
      expect(lockEvent1.locked_amount).toBe(ustxAmount);

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
      const expectedUnlockHeight1 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(lockEvent1.unlock_height).toBe(expectedUnlockHeight1);

      // Test the API address balance data after a `stack-stx` operation
      const addrBalance1 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance1.locked).toBe(ustxAmount.toString());
      expect(addrBalance1.burnchain_unlock_height).toBe(expectedUnlockHeight1);
      expect(addrBalance1.lock_height).toBe(dbTx1.block_height);
      expect(addrBalance1.lock_tx_id).toBe(dbTx1.tx_id);

      await standByUntilBlock(dbTx1.block_height + 1);
    });

    test('stack-increase tx', async () => {
      // Create and broadcast a `stack-increase` tx
      const stackIncreaseAmount = 123n;
      const tx2 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-increase',
        functionArgs: [uintCV(stackIncreaseAmount)],
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

      // Test that the locked STX amount has increased
      const expectedLockedAmount2 = ustxAmount + stackIncreaseAmount;
      expect(lockEvent2.locked_amount).toBe(expectedLockedAmount2);

      // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
      const rpcAccountInfo2 = await client.getAccount(account.stacksAddress);
      const expectedUnlockHeight2 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(BigInt(rpcAccountInfo2.locked)).toBe(expectedLockedAmount2);
      expect(rpcAccountInfo2.unlock_height).toBe(expectedUnlockHeight2);

      // Test the API address balance data after a `stack-increase` operation
      const addrBalance2 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance2.locked).toBe(expectedLockedAmount2.toString());
      expect(addrBalance2.burnchain_unlock_height).toBe(expectedUnlockHeight2);
      expect(addrBalance2.lock_height).toBe(dbTx2.block_height);
      expect(addrBalance2.lock_tx_id).toBe(dbTx2.tx_id);
    });

    test('stack-extend tx', async () => {
      // Create and broadcast a `stack-extend` tx
      const extendCycleAmount = 1;
      const tx3 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-extend',
        functionArgs: [
          uintCV(extendCycleAmount),
          tupleCV({
            hashbytes: bufferCV(decodedBtcAddr.data),
            version: bufferCV(Buffer.from([decodedBtcAddr.version])),
          }),
        ],
        network: stacksNetwork,
        anchorMode: AnchorMode.Any,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId3 = '0x' + tx3.txid();
      const txStandby3 = standByForTx(expectedTxId3);
      const sendResult3 = await client.sendTransaction(tx3.serialize());
      expect(sendResult3.txId).toBe(expectedTxId3);

      const dbTx3 = await txStandby3;
      expect(dbTx3.status).toBe(DbTxStatus.Success);
      const tx3Events = await api.datastore.getTxEvents({
        txId: dbTx3.tx_id,
        indexBlockHash: dbTx3.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx3Events.results).toBeTruthy();
      const lockEvent3 = tx3Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent3).toBeDefined();

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle amount specified in the `stack-extend` tx.
      const extendBlockCount = extendCycleAmount * poxInfo.reward_cycle_length;
      const expectedUnlockHeight2 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height + extendBlockCount;
      expect(lockEvent3.unlock_height).toBe(expectedUnlockHeight2);

      // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
      const rpcAccountInfo3 = await client.getAccount(account.stacksAddress);
      expect(rpcAccountInfo3.unlock_height).toBe(expectedUnlockHeight2);

      // Test the API address balance data after a `stack-extend` operation
      const addrBalance3 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance3.burnchain_unlock_height).toBe(expectedUnlockHeight2);
      expect(addrBalance3.lock_height).toBe(dbTx3.block_height);
      expect(addrBalance3.lock_tx_id).toBe(dbTx3.tx_id);
    });

    test.skip('stacking rewards', () => {
      // TODO: wait for reward cycle block and check for burnchain rewards, the /v2/accounts/<addr> info, and the bitcoin-rpc balance if possible
      console.log('TODO');
    });
  });

  test.skip('PoX-2 - stack to P2TR address', () => {
    // TODO
  });

  test.skip('PoX-2 - stack to P2WPKH address', () => {
    // TODO
  });

  test.skip('PoX-2 - stack to P2WSH address', () => {
    // TODO
  });
});
