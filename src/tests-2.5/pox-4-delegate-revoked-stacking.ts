import { AddressStxBalanceResponse } from '@stacks/stacks-blockchain-api-types';
import {
  AnchorMode,
  makeContractCall,
  makeSTXTokenTransfer,
  noneCV,
  someCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import {
  ClarityValueOptionalNone,
  ClarityValueTuple,
  ClarityValueUInt,
  decodeClarityValue,
} from 'stacks-encoding-native-js';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbTxStatus } from '../datastore/common';
import { stxToMicroStx } from '../helpers';
import {
  Account,
  accountFromKey,
  fetchGet,
  readOnlyFnCall,
  standByForPoxCycle,
  standByForPoxCycleEnd,
  standByForTx,
  standByForTxSuccess,
  testEnv,
} from '../test-utils/test-helpers';

describe('PoX-4 - Delegate Revoked Stacking', () => {
  const seedKey = testnetKeys[4].secretKey;
  const delegatorKey = '72e8e3725324514c38c2931ed337ab9ab8d8abaae83ed2275456790194b1fd3101';
  const delegateeKey = '0d174cf0be276cedcf21727611ef2504aed093d8163f65985c07760fda12a7ea01';

  const DELEGATE_FULL_AMOUNT = 1_000_000_000_000_000n;
  const DELEGATE_HALF_AMOUNT = DELEGATE_FULL_AMOUNT / 2n;
  const DELEGATE_INCREASE_AMOUNT = 2_000n;

  let seedAccount: Account;
  let POOL: Account;
  let STACKER: Account;

  let poxInfo: CoreRpcPoxInfo;
  let contractAddress: string;
  let contractName: string;

  beforeAll(() => {
    seedAccount = accountFromKey(seedKey);
    POOL = accountFromKey(delegatorKey);
    STACKER = accountFromKey(delegateeKey);
  });

  test('Import testing accounts to bitcoind', async () => {
    for (const account of [POOL, STACKER]) {
      await testEnv.bitcoinRpcClient.importprivkey({
        privkey: account.wif,
        label: account.btcAddr,
        rescan: false,
      });
    }
  });

  test('Seed delegate accounts', async () => {
    poxInfo = await testEnv.client.getPox();

    // transfer 100 STX (for tx fees) from seed to delegator account
    const gasAmount = stxToMicroStx(100);
    const stxXfer1 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: POOL.stxAddr,
      amount: gasAmount,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: stxXferId1 } = await testEnv.client.sendTransaction(
      Buffer.from(stxXfer1.serialize())
    );

    // transfer pox "min_amount_ustx" from seed to delegatee account
    const stackingAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    const stxXfer2 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: STACKER.stxAddr,
      amount: stackingAmount,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      nonce: stxXfer1.auth.spendingCondition.nonce + 1n,
      fee: 10000n,
    });
    const { txId: stxXferId2 } = await testEnv.client.sendTransaction(
      Buffer.from(stxXfer2.serialize())
    );

    const stxXferTx1 = await standByForTxSuccess(stxXferId1);
    expect(stxXferTx1.token_transfer_recipient_address).toBe(POOL.stxAddr);

    const stxXferTx2 = await standByForTxSuccess(stxXferId2);
    expect(stxXferTx2.token_transfer_recipient_address).toBe(STACKER.stxAddr);

    // ensure delegator account balance is correct
    const delegatorBalance = await testEnv.client.getAccountBalance(POOL.stxAddr);
    expect(delegatorBalance.toString()).toBe(gasAmount.toString());

    // ensure delegatee account balance is correct
    const delegateeBalance = await testEnv.client.getAccountBalance(STACKER.stxAddr);
    expect(delegateeBalance.toString()).toBe(stackingAmount.toString());
  });

  test('Pre-checks', async () => {
    // wait until the start of the next cycle so we have enough blocks within the cycle to perform the various txs
    poxInfo = await standByForPoxCycle();

    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-4');

    const balanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
    expect(BigInt(balanceInfo.balance)).toBeGreaterThan(0n);
    expect(BigInt(balanceInfo.locked)).toBe(0n);
  });

  test('Try to perform delegate-stack-stx - without delegation', async () => {
    poxInfo = await testEnv.client.getPox();
    const startBurnHt = poxInfo.current_burnchain_block_height as number;

    const delegateStackTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        standardPrincipalCV(STACKER.stxAddr), // stacker
        uintCV(DELEGATE_HALF_AMOUNT), // amount-ustx
        STACKER.poxAddrClar, // pox-addr
        uintCV(startBurnHt), // start-burn-ht
        uintCV(1), // lock-period
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const delegateStackTxResult = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackTx.serialize())
    );
    const delegateStackDbTx = await standByForTx(delegateStackTxResult.txId);
    expect(delegateStackDbTx.status).not.toBe(DbTxStatus.Success);
    const delegateStackResult = decodeClarityValue(delegateStackDbTx.raw_result);
    expect(delegateStackResult.repr).toEqual('(err 9)'); // ERR_STACKING_PERMISSION_DENIED
  });

  test('Perform delegate-stx', async () => {
    // Only delegate half the amount first
    const delegateStxTx = await makeContractCall({
      senderKey: STACKER.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stx',
      functionArgs: [
        uintCV(DELEGATE_HALF_AMOUNT),
        standardPrincipalCV(POOL.stxAddr), // delegate-to
        noneCV(), // untilBurnBlockHeight
        someCV(STACKER.poxAddrClar), // pox-addr
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStxTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStxTx.serialize())
    );
    const delegateStxDbTx = await standByForTxSuccess(delegateStxTxId);

    // validate delegate-stx pox4 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStxDbTx.tx_id}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stx',
        pox_addr: STACKER.btcTestnetAddr,
        stacker: STACKER.stxAddr,
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        amount_ustx: DELEGATE_HALF_AMOUNT.toString(),
        delegate_to: POOL.stxAddr,
      })
    );

    // check locked amount is still zero (nothing is partially stacked or locked yet)
    const balanceInfo2 = await testEnv.client.getAccount(STACKER.stxAddr);
    expect(BigInt(balanceInfo2.locked)).toBe(0n);

    // check delegation readonly function
    const getDelegationInfo = await readOnlyFnCall<
      ClarityValueTuple<{ 'amount-ustx': ClarityValueUInt }>
    >(
      [contractAddress, contractName],
      'get-delegation-info',
      [standardPrincipalCV(STACKER.stxAddr)],
      STACKER.stxAddr
    );
    const delegatedAmount = BigInt(getDelegationInfo.data['amount-ustx'].value);
    expect(delegatedAmount).toBe(DELEGATE_HALF_AMOUNT);
  });

  test('Perform delegate-stack-stx', async () => {
    poxInfo = await testEnv.client.getPox();
    const startBurnHt = poxInfo.current_burnchain_block_height as number;

    const delegateStackStxTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        standardPrincipalCV(STACKER.stxAddr), // stacker
        uintCV(DELEGATE_HALF_AMOUNT), // amount-ustx
        STACKER.poxAddrClar, // pox-addr
        uintCV(startBurnHt), // start-burn-ht
        uintCV(3), // lock-period
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackStxTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackStxTx.serialize())
    );
    await standByForTxSuccess(delegateStackStxTxId);

    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(DELEGATE_HALF_AMOUNT);
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

    // validate delegate-stack-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStackStxTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stack-stx',
        pox_addr: STACKER.btcTestnetAddr,
        stacker: STACKER.stxAddr,
        balance: BigInt(coreBalanceInfo.balance).toString(),
        locked: DELEGATE_HALF_AMOUNT.toString(),
        burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        lock_period: '3',
        lock_amount: DELEGATE_HALF_AMOUNT.toString(),
      })
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${STACKER.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(DELEGATE_HALF_AMOUNT));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
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
      fee: 10000n,
    });
    const revokeTxResult = await testEnv.client.sendTransaction(Buffer.from(revokeTx.serialize()));
    const revokeStackDbTx = await standByForTxSuccess(revokeTxResult.txId);

    const revokeStackResult = decodeClarityValue(revokeStackDbTx.raw_result);
    expect(revokeStackResult.repr).toEqual('(ok true)');
    expect(revokeStackDbTx.status).toBe(DbTxStatus.Success);

    // revocation doesn't change anything for the previous delegate-stack-stx state
    const coreBalanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(DELEGATE_HALF_AMOUNT);
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);
  });

  test('Try to perform delegate-stack-stx - while revoked', async () => {
    poxInfo = await testEnv.client.getPox();
    const startBurnHt = poxInfo.current_burnchain_block_height as number;

    const delegateStackTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        standardPrincipalCV(STACKER.stxAddr), // stacker
        uintCV(DELEGATE_HALF_AMOUNT), // amount-ustx
        STACKER.poxAddrClar, // pox-addr
        uintCV(startBurnHt), // start-burn-ht
        uintCV(1), // lock-period
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const delegateStackTxResult = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackTx.serialize())
    );
    const delegateStackDbTx = await standByForTx(delegateStackTxResult.txId);
    expect(delegateStackDbTx.status).not.toBe(DbTxStatus.Success);
    const delegateStackResult = decodeClarityValue(delegateStackDbTx.raw_result);
    expect(delegateStackResult.repr).toEqual('(err 9)'); // ERR_STACKING_PERMISSION_DENIED
  });

  test('Try to perform delegate-stack-increase - without delegation', async () => {
    const delegateStackIncreaseTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-increase',
      functionArgs: [
        standardPrincipalCV(STACKER.stxAddr), // stacker
        STACKER.poxAddrClar, // pox-addr
        uintCV(DELEGATE_INCREASE_AMOUNT), // increase-by
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackIncreaseTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackIncreaseTx.serialize())
    );
    const delegateStackIncreaseTxResult = await standByForTx(delegateStackIncreaseTxId);
    const delegateStackIncreaseResult = decodeClarityValue(
      delegateStackIncreaseTxResult.raw_result
    );
    expect(delegateStackIncreaseResult.repr).toEqual('(err 9)'); // ERR_STACKING_PERMISSION_DENIED
    expect(delegateStackIncreaseTxResult.status).not.toBe(DbTxStatus.Success);
  });

  test('Try to perform delegate-stack-extend - without delegation', async () => {
    const delegateStackextendTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-extend',
      functionArgs: [
        standardPrincipalCV(STACKER.stxAddr), // stacker
        STACKER.poxAddrClar, // pox-addr
        uintCV(2), // extend-count
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackextendTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackextendTx.serialize())
    );
    const delegateStackextendTxResult = await standByForTx(delegateStackextendTxId);
    const delegateStackextendResult = decodeClarityValue(delegateStackextendTxResult.raw_result);
    expect(delegateStackextendResult.repr).toEqual('(err 9)'); // ERR_STACKING_PERMISSION_DENIED
    expect(delegateStackextendTxResult.status).not.toBe(DbTxStatus.Success);
  });

  test('Try to perform delegate-stack-stx - without delegation', async () => {
    poxInfo = await testEnv.client.getPox();
    const startBurnHt = poxInfo.current_burnchain_block_height as number;

    const delegateStackStxTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        standardPrincipalCV(STACKER.stxAddr), // stacker
        uintCV(DELEGATE_HALF_AMOUNT), // amount-ustx
        STACKER.poxAddrClar, // pox-addr
        uintCV(startBurnHt), // start-burn-ht
        uintCV(1), // lock-period
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackStxTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackStxTx.serialize())
    );
    const delegateStackStxTxResult = await standByForTx(delegateStackStxTxId);
    expect(delegateStackStxTxResult.status).not.toBe(DbTxStatus.Success);
    const delegateStackStxResult = decodeClarityValue(delegateStackStxTxResult.raw_result);
    expect(delegateStackStxResult.repr).toEqual('(err 9)'); // ERR_STACKING_PERMISSION_DENIED
  });

  test('Perform stack-aggregation-commit - delegator commit to stacking operation', async () => {
    poxInfo = await testEnv.client.getPox();
    const rewardCycle = BigInt(poxInfo.next_cycle.id);

    const stackAggrCommitTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-commit',
      functionArgs: [
        STACKER.poxAddrClar, // pox-addr
        uintCV(rewardCycle), // reward-cycle
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: stackAggrCommitTxId } = await testEnv.client.sendTransaction(
      Buffer.from(stackAggrCommitTx.serialize())
    );
    await standByForTxSuccess(stackAggrCommitTxId);

    // validate stack-aggregation-commit pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${stackAggrCommitTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-aggregation-commit',
        pox_addr: STACKER.btcTestnetAddr,
        stacker: POOL.stxAddr,
      })
    );
  });

  test('Wait for current two pox cycles to complete', async () => {
    await standByForPoxCycleEnd();
    await standByForPoxCycle();
    await standByForPoxCycle();
  });

  test('Validate account balances are unlocked', async () => {
    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(STACKER.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(0n);
    expect(coreBalanceInfo.unlock_height).toBe(0);

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${STACKER.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(BigInt(coreBalanceInfo.locked)));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
  });
});
