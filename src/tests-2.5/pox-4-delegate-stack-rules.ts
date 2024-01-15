// Tests based on the following rules:
// https://github.com/stacks-network/stacks-core/blob/de8129cced156bb180bd19e42ac4ad1b2bca8d53/stackslib/src/chainstate/stacks/boot/pox-4.clar#L662-L666
//
// ;; delegate-stack-* functions assert that
// ;; 1. users can't swim in two pools at the same time.
// ;; 2. users can't switch pools without cool down cycle.
// ;;    Other pool admins can't increase or extend.
// ;; 3. users can't join a pool while already directly stacking.

import { AnchorMode, Cl, makeContractCall } from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import {
  TestEnvContext,
  accountFromKey,
  readOnlyFnCall,
  standByForPoxCycle,
  standByForTx,
  standByForTxSuccess,
  standByUntilBurnBlock,
} from '../test-utils/test-helpers';
import { ClarityValueTuple, ClarityValueUInt, decodeClarityValue } from 'stacks-encoding-native-js';
import { DbTxStatus } from '../datastore/common';

describe('PoX-4 - Delegate Stack Rules', () => {
  let testEnv: TestEnvContext;

  const STACKER = accountFromKey(testnetKeys[1].secretKey);

  const POOL1 = accountFromKey(testnetKeys[2].secretKey);
  const POOL2 = accountFromKey(testnetKeys[3].secretKey);

  let poxInfo: CoreRpcPoxInfo;
  let contractAddress: string;
  let contractName: string;

  beforeAll(async () => {
    testEnv = (global as any).testEnv;

    poxInfo = await standByForPoxCycle();
    [contractAddress, contractName] = poxInfo.contract_id.split('.');

    expect(contractName).toBe('pox-4');
  });

  describe('Users cannot swim in two pools at the same time', () => {
    test('Perform delegate-stx to first pool', async () => {
      const delegateStxTx = await makeContractCall({
        senderKey: STACKER.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stx',
        functionArgs: [
          Cl.uint(10_000_000), // amount-ustx
          Cl.standardPrincipal(POOL1.stxAddr), // delegate-to
          Cl.none(), // until-burn-ht
          Cl.some(STACKER.poxAddrClar), // pox-addr
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(Buffer.from(delegateStxTx.serialize()));
      await standByForTxSuccess(txId);

      // check locked amount is still zero (nothing is partially stacked or locked yet)
      const balanceInfo2 = await testEnv.client.getAccount(STACKER.stxAddr);
      expect(BigInt(balanceInfo2.locked)).toBe(0n);

      // check delegation info
      const getDelegationInfo = await readOnlyFnCall<
        ClarityValueTuple<{ 'amount-ustx': ClarityValueUInt }>
      >(
        [contractAddress, contractName],
        'get-delegation-info',
        [Cl.standardPrincipal(STACKER.stxAddr)],
        STACKER.stxAddr
      );
      const delegatedAmount = BigInt(getDelegationInfo.data['amount-ustx'].value);
      expect(delegatedAmount).toBe(10_000_000n);
    });

    test('Try delegate-stx to pool 2 - should fail', async () => {
      const delegateStxTx = await makeContractCall({
        senderKey: STACKER.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stx',
        functionArgs: [
          Cl.uint(10_000_000), // amount-ustx
          Cl.standardPrincipal(POOL2.stxAddr), // delegate-to
          Cl.none(), // until-burn-ht
          Cl.some(STACKER.poxAddrClar), // pox-addr
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(Buffer.from(delegateStxTx.serialize()));
      const tx = await standByForTx(txId);

      expect(tx.status).not.toBe(DbTxStatus.Success);
      expect(decodeClarityValue(tx.raw_result).repr).toEqual('(err 20)'); // ERR_STACKING_ALREADY_DELEGATED
    });
  });

  describe('Users cannot switch pools without cool down cycle', () => {
    test('Perform delegate-stx to first pool', async () => {
      const delegateStxTx = await makeContractCall({
        senderKey: STACKER.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stx',
        functionArgs: [
          Cl.uint(10_000_000), // amount-ustx
          Cl.standardPrincipal(POOL1.stxAddr), // delegate-to
          Cl.none(), // until-burn-ht
          Cl.some(STACKER.poxAddrClar), // pox-addr
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(Buffer.from(delegateStxTx.serialize()));
      await standByForTxSuccess(txId);

      // check delegation info
      const getDelegationInfo = await readOnlyFnCall(
        [contractAddress, contractName],
        'get-delegation-info',
        [Cl.standardPrincipal(STACKER.stxAddr)]
      );
      const delegatedAmount = BigInt((getDelegationInfo as any).data['amount-ustx'].value);
      expect(delegatedAmount).toBe(10_000_000n);
    });

    test('Perform delegate-stack-stx for stacker (in first pool)', async () => {
      poxInfo = await testEnv.client.getPox();
      const startBurnHt = poxInfo.current_burnchain_block_height as number;

      const delegateStackStxTx = await makeContractCall({
        senderKey: POOL1.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stack-stx',
        functionArgs: [
          Cl.standardPrincipal(STACKER.stxAddr), // stacker
          Cl.uint(10_000_000), // amount-ustx
          STACKER.poxAddrClar, // pox-addr
          Cl.uint(startBurnHt), // start-burn-ht
          Cl.uint(1), // lock-period
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(
        Buffer.from(delegateStackStxTx.serialize())
      );
      await standByForTxSuccess(txId);

      const balanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
      expect(BigInt(balanceInfo.locked)).toBe(10_000_000n);
    });

    test('Wait until next cycle (locked period)', async () => {
      poxInfo = await standByForPoxCycle(); // wait until next cycle

      const balanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
      expect(BigInt(balanceInfo.locked)).toBe(10_000_000n); // locked
    });

    test('Perform delegate-stack-stx again (works without cool down)', async () => {
      poxInfo = await standByForPoxCycle(); // wait until next cycle (unlocked again)

      let balanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
      expect(BigInt(balanceInfo.locked)).toBe(0n); // unlocked

      const startBurnHt = poxInfo.current_burnchain_block_height as number;
      const delegateStackStxTx = await makeContractCall({
        senderKey: POOL1.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stack-stx',
        functionArgs: [
          Cl.standardPrincipal(STACKER.stxAddr), // stacker
          Cl.uint(10_000_000), // amount-ustx
          STACKER.poxAddrClar, // pox-addr
          Cl.uint(startBurnHt), // start-burn-ht
          Cl.uint(1), // lock-period
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(
        Buffer.from(delegateStackStxTx.serialize())
      );
      await standByForTxSuccess(txId);

      balanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
      expect(BigInt(balanceInfo.locked)).toBe(10_000_000n);
    });

    test('Perform revoke-delegate-stx', async () => {
      const revokeTx = await makeContractCall({
        senderKey: STACKER.secretKey,
        contractAddress,
        contractName,
        functionName: 'revoke-delegate-stx',
        functionArgs: [],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(Buffer.from(revokeTx.serialize()));
      await standByForTxSuccess(txId);

      // check delegation info
      await expect(
        readOnlyFnCall([contractAddress, contractName], 'get-delegation-info', [
          Cl.standardPrincipal(STACKER.stxAddr),
        ])
      ).rejects.toThrow('OptionNone');
    });

    test('Wait until next cycle (locked period)', async () => {
      poxInfo = await standByForPoxCycle(); // wait until next cycle

      const balanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
      expect(BigInt(balanceInfo.locked)).toBe(10_000_000n); // locked
    });

    test('Perform delegate-stx to second pool', async () => {
      poxInfo = await standByForPoxCycle(); // wait until next cycle (unlocked again)

      const delegateStxTx = await makeContractCall({
        senderKey: STACKER.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stx',
        functionArgs: [
          Cl.uint(10_000_000), // amount-ustx
          Cl.standardPrincipal(POOL2.stxAddr), // delegate-to
          Cl.none(), // until-burn-ht
          Cl.some(STACKER.poxAddrClar), // pox-addr
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(Buffer.from(delegateStxTx.serialize()));
      await standByForTxSuccess(txId);

      // check delegation info
      const getDelegationInfo = await readOnlyFnCall(
        [contractAddress, contractName],
        'get-delegation-info',
        [Cl.standardPrincipal(STACKER.stxAddr)]
      );
      const delegatedAmount = BigInt((getDelegationInfo as any).data['amount-ustx'].value);
      expect(delegatedAmount).toBe(10_000_000n);
    });

    test('Perform delegate-stack-stx for stacker (in second pool) - should fail', async () => {
      poxInfo = await testEnv.client.getPox();
      const startBurnHt = poxInfo.current_burnchain_block_height as number;

      const delegateStackStxTx = await makeContractCall({
        senderKey: POOL2.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stack-stx',
        functionArgs: [
          Cl.standardPrincipal(STACKER.stxAddr), // stacker
          Cl.uint(10_000_000), // amount-ustx
          STACKER.poxAddrClar, // pox-addr
          Cl.uint(startBurnHt), // start-burn-ht
          Cl.uint(1), // lock-period
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(
        Buffer.from(delegateStackStxTx.serialize())
      );
      const tx = await standByForTx(txId);

      expect(tx.status).not.toBe(DbTxStatus.Success);
      expect(decodeClarityValue(tx.raw_result).repr).toEqual('(err 9)'); // ERR_STACKING_PERMISSION_DENIED
    });

    test('Perform delegate-stack-stx to second pool after cool down - should succeed', async () => {
      poxInfo = await standByForPoxCycle(); // wait until next cycle
      const startBurnHt = poxInfo.current_burnchain_block_height as number;

      const delegateStackStxTx = await makeContractCall({
        senderKey: POOL2.secretKey,
        contractAddress,
        contractName,
        functionName: 'delegate-stack-stx',
        functionArgs: [
          Cl.standardPrincipal(STACKER.stxAddr), // stacker
          Cl.uint(10_000_000), // amount-ustx
          STACKER.poxAddrClar, // pox-addr
          Cl.uint(startBurnHt), // start-burn-ht
          Cl.uint(1), // lock-period
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 1000,
      });
      const { txId } = await testEnv.client.sendTransaction(
        Buffer.from(delegateStackStxTx.serialize())
      );
      await standByForTxSuccess(txId);

      const balanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
      expect(BigInt(balanceInfo.locked)).toBe(10_000_000n);
    });
  });

  test('Other pool admins cannot increase or extend', async () => {
    // test code
  });

  test('Users cannot join a pool while already directly stacking', async () => {
    // test code
  });
});
