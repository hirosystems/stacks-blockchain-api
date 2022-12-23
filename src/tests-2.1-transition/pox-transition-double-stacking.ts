/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StacksNetwork } from '@stacks/network';
import { poxAddressToTuple, StackingClient } from '@stacks/stacking';
import { PoxOperationPeriod } from '@stacks/stacking/dist/constants';
import { AnchorMode, makeContractCall, serializePayload, uintCV } from '@stacks/transactions';
import { RPCClient } from 'rpc-bitcoin';
import { decodeClarityValue } from 'stacks-encoding-native-js';
import { ApiServer } from '../api/init';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { DbEventTypeId, DbStxLockEvent, DbTxStatus } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import {
  standByForAccountUnlock,
  standByForTx,
  standByForTxSuccess,
  standByUntilBlock,
  standByUntilBurnBlock,
} from '../test-utils/test-helpers';
import type { TestEnvContext } from './env-setup';

describe('PoX Transition - Double stacking', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;
  let bitcoinRpcClient: RPCClient;

  let poxInfo: CoreRpcPoxInfo;
  let ustxAmount: bigint;
  let stackingClient: StackingClient;

  const cycles = 1;
  const account = testnetKeys[1];
  const btcAddr = '2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o';

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork, bitcoinRpcClient } = testEnv);

    stackingClient = new StackingClient(account.stacksAddress, stacksNetwork);

    await Promise.resolve();
  });

  describe('PoX-1 double stacking', () => {
    test('Stack to PoX-1 twice in Period 1 (before fork)', async () => {
      poxInfo = await client.getPox();
      ustxAmount = BigInt(poxInfo.current_cycle.min_threshold_ustx * 1.2);

      const poxOperationInfo = await stackingClient.getPoxOperationInfo();
      expect(poxOperationInfo.period).toBe(PoxOperationPeriod.Period1); // before fork

      const { pox1 } = poxOperationInfo as any;

      // POX-1
      poxInfo = await client.getPox();
      const tx1 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress: pox1.contract_id.split('.')[0],
        contractName: pox1.contract_id.split('.')[1],
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()),
          poxAddressToTuple(btcAddr),
          uintCV(poxInfo.current_burnchain_block_height as number),
          uintCV(cycles),
        ],
        anchorMode: AnchorMode.OnChainOnly,
        network: stacksNetwork,
        fee: 10000n,
      });

      const txResult1 = await client.sendTransaction(Buffer.from(tx1.serialize()));
      expect(txResult1.txId).toBe('0x' + tx1.txid());

      const dbTx1 = await standByForTxSuccess(txResult1.txId);

      // POX-1 AGAIN (during same cycle)
      poxInfo = await client.getPox();
      const tx2 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress: pox1.contract_id.split('.')[0],
        contractName: pox1.contract_id.split('.')[1],
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()),
          poxAddressToTuple(btcAddr),
          uintCV(poxInfo.current_burnchain_block_height as number),
          uintCV(cycles),
        ],
        anchorMode: AnchorMode.OnChainOnly,
        network: stacksNetwork,
        fee: 10000n,
      });

      const txResult2 = await client.sendTransaction(Buffer.from(tx2.serialize()));
      expect(txResult2.txId).toBe('0x' + tx2.txid());

      const dbTx2 = await standByForTx(txResult2.txId);
      expect(decodeClarityValue(dbTx2.raw_result).repr).toBe('(err 3)'); // ALREADY_STACKED
      expect(dbTx2.status).toBe(DbTxStatus.AbortByResponse);

      const tx1Events = await api.datastore.getTxEvents({
        txId: txResult1.txId,
        indexBlockHash: dbTx1.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx1Events.results).toBeTruthy();
      const lockEventTx1 = tx1Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEventTx1).toBeDefined();
      expect(lockEventTx1.locked_address).toBe(account.stacksAddress);
      expect(lockEventTx1.locked_amount).toBe(ustxAmount);

      const tx2Events = await api.datastore.getTxEvents({
        txId: txResult2.txId,
        indexBlockHash: dbTx2.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx2Events.results).toBeTruthy();
      const lockEventTx2 = tx2Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEventTx2).toBeUndefined();

      await standByForAccountUnlock(account.stacksAddress);

      poxInfo = await client.getPox();
    });
  });

  describe('Mixed double stacking', () => {
    test('Stack to both PoXs in Period 1 (before fork)', async () => {
      poxInfo = await client.getPox();
      ustxAmount = BigInt(poxInfo.current_cycle.min_threshold_ustx * 1.2);

      const poxOperationInfo = await stackingClient.getPoxOperationInfo();
      expect(poxOperationInfo.period).toBe(PoxOperationPeriod.Period1); // before fork

      const { pox1, pox2 } = poxOperationInfo as any;

      // POX-1
      poxInfo = await client.getPox();
      const txToPox1 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress: pox1.contract_id.split('.')[0],
        contractName: pox1.contract_id.split('.')[1],
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()),
          poxAddressToTuple(btcAddr),
          uintCV(poxInfo.current_burnchain_block_height as number),
          uintCV(cycles),
        ],
        anchorMode: AnchorMode.OnChainOnly,
        network: stacksNetwork,
        fee: 10000n,
      });

      const txResultPox1 = await client.sendTransaction(Buffer.from(txToPox1.serialize()));
      expect(txResultPox1.txId).toBe('0x' + txToPox1.txid());

      const dbTxPox1 = await standByForTxSuccess(txResultPox1.txId);

      // POX-2
      poxInfo = await client.getPox();
      const txToPox2 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress: pox2.contract_id.split('.')[0],
        contractName: pox2.contract_id.split('.')[1],
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()),
          poxAddressToTuple(btcAddr),
          uintCV(poxInfo.current_burnchain_block_height as number),
          uintCV(cycles),
        ],
        anchorMode: AnchorMode.OnChainOnly,
        network: stacksNetwork,
        fee: 10000n,
      });

      // PoX-2 doesn't exist yet, so sending the tx should throw
      await expect(async () => {
        await client.sendTransaction(Buffer.from(txToPox2.serialize()));
      }).rejects.toThrow();

      const txPox1Events = await api.datastore.getTxEvents({
        txId: txResultPox1.txId,
        indexBlockHash: dbTxPox1.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(txPox1Events.results).toBeTruthy();
      const lockEvent = txPox1Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent).toBeDefined();
      expect(lockEvent.locked_address).toBe(account.stacksAddress);
      expect(lockEvent.locked_amount).toBe(ustxAmount);

      const expectedUnlockHeight =
        poxInfo.next_cycle.reward_phase_start_block_height + cycles * poxInfo.reward_cycle_length;
      expect(lockEvent.unlock_height).toBe(expectedUnlockHeight);

      await standByForAccountUnlock(account.stacksAddress);

      poxInfo = await client.getPox();
      expect(poxInfo.current_burnchain_block_height).toBe(expectedUnlockHeight + 1); // todo: is it intended that unlocks are 1 block late?
    });

    test('Stack to both PoXs in Period 2a', async () => {
      // Assuming the following ENV from `zone117x/stacks-api-e2e:stacks2.1-transition-feat-segwit-events-8fb6fad`
      // STACKS_21_HEIGHT=120
      // STACKS_POX2_HEIGHT = 136

      await standByUntilBurnBlock(120); // wait until in 2.1 fork

      poxInfo = await client.getPox();
      ustxAmount = BigInt(poxInfo.current_cycle.min_threshold_ustx * 1.2);

      const poxOperationInfo = await stackingClient.getPoxOperationInfo();
      expect(poxOperationInfo.period).toBe(PoxOperationPeriod.Period2a);
      if (poxOperationInfo.period !== PoxOperationPeriod.Period2a) throw Error;
      const { pox1, pox2 } = poxOperationInfo;

      // POX-1
      poxInfo = await client.getPox();
      const txToPox1 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress: pox1.contract_id.split('.')[0],
        contractName: pox1.contract_id.split('.')[1],
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()),
          poxAddressToTuple(btcAddr),
          uintCV(poxInfo.current_burnchain_block_height as number),
          uintCV(cycles),
        ],
        anchorMode: AnchorMode.OnChainOnly,
        network: stacksNetwork,
        fee: 10000n,
      });

      const txResultPox1 = await client.sendTransaction(Buffer.from(txToPox1.serialize()));
      expect(txResultPox1.txId).toBe('0x' + txToPox1.txid());

      const dbTxPox1 = await standByForTxSuccess(txResultPox1.txId);

      // POX-2
      poxInfo = await client.getPox();
      const txToPox2 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress: pox2.contract_id.split('.')[0],
        contractName: pox2.contract_id.split('.')[1],
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()),
          poxAddressToTuple(btcAddr),
          uintCV(poxInfo.current_burnchain_block_height as number),
          uintCV(cycles),
        ],
        anchorMode: AnchorMode.OnChainOnly,
        network: stacksNetwork,
        fee: 10000n,
      });

      const txResultPox2 = await client.sendTransaction(Buffer.from(txToPox2.serialize()));
      expect(txResultPox2.txId).toBe('0x' + txToPox2.txid());

      const txPox2Db = await standByForTx(txResultPox2.txId);
      expect(txPox2Db.status).toBe(DbTxStatus.AbortByResponse);
      expect(decodeClarityValue(txPox2Db.raw_result).repr).toBe('(err none)'); // ALREADY_STACKED

      // check balance
      const balanceLocked = await stackingClient.getAccountBalanceLocked();
      expect(balanceLocked).toBe(ustxAmount); // lock should include both pox-contracts

      const tx1Events = await api.datastore.getTxEvents({
        txId: txResultPox1.txId,
        indexBlockHash: dbTxPox1.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx1Events.results).toBeTruthy();
      const lockEventTx1 = tx1Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEventTx1).toBeDefined();
      expect(lockEventTx1.locked_address).toBe(account.stacksAddress);
      expect(lockEventTx1.locked_amount).toBe(ustxAmount);

      const tx2Events = await api.datastore.getTxEvents({
        txId: txResultPox2.txId,
        indexBlockHash: txPox2Db.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx2Events.results).toBeTruthy();
      const lockEventTx2 = tx2Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEventTx2).toBeUndefined();
    });

    test('Check that node is still running', async () => {
      // wait a couple blocks to ensure node doesn't panic
      const info = await client.getInfo();
      await standByUntilBlock(info.stacks_tip_height + 2);
    });
  });
});
