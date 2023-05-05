import { CoreRpcPoxInfo } from '../core-rpc/client';
import { testnetKeys } from '../api/routes/debug';
import {
  Account,
  accountFromKey,
  fetchGet,
  readOnlyFnCall,
  standByForNextPoxCycle,
  standByForPoxCycle,
  standByForPoxCycleEnd,
  standByForTxSuccess,
  testEnv,
} from '../test-utils/test-helpers';
import { stxToMicroStx } from '../helpers';
import {
  AnchorMode,
  makeContractCall,
  makeSTXTokenTransfer,
  noneCV,
  someCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import { ClarityValueTuple, ClarityValueUInt } from 'stacks-encoding-native-js';
import { AddressStxBalanceResponse } from '@stacks/stacks-blockchain-api-types';

describe('PoX-3 - Delegate Stacking operations', () => {
  const seedKey = testnetKeys[4].secretKey;
  const delegatorKey = '72e8e3725324514c38c2931ed337ab9ab8d8abaae83ed2275456790194b1fd3101';
  const delegateeKey = '0d174cf0be276cedcf21727611ef2504aed093d8163f65985c07760fda12a7ea01';

  const stxToDelegateIncrease = 2000n;

  let seedAccount: Account;
  let delegatorAccount: Account;
  let delegateeAccount: Account;

  let poxInfo: CoreRpcPoxInfo;
  let contractAddress: string;
  let contractName: string;

  beforeAll(() => {
    seedAccount = accountFromKey(seedKey);
    delegatorAccount = accountFromKey(delegatorKey);
    delegateeAccount = accountFromKey(delegateeKey);
  });

  test('Import testing accounts to bitcoind', async () => {
    // register delegate accounts to bitcoind wallet
    // TODO: only one of these (delegatee ?) should be required..
    for (const account of [delegatorAccount, delegateeAccount]) {
      await testEnv.bitcoinRpcClient.importprivkey({
        privkey: account.wif,
        label: account.btcAddr,
        rescan: false,
      });
    }
  });

  test('Seed delegate accounts', async () => {
    poxInfo = await testEnv.client.getPox();

    // transfer 10 STX (for tx fees) from seed to delegator account
    const gasAmount = stxToMicroStx(100);
    const stxXfer1 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: delegatorAccount.stxAddr,
      amount: gasAmount,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 200,
    });
    const { txId: stxXferId1 } = await testEnv.client.sendTransaction(
      Buffer.from(stxXfer1.serialize())
    );

    // transfer pox "min_amount_ustx" from seed to delegatee account
    const stackingAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    const stxXfer2 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: delegateeAccount.stxAddr,
      amount: stackingAmount,
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 200,
      nonce: stxXfer1.auth.spendingCondition.nonce + 1n,
    });
    const { txId: stxXferId2 } = await testEnv.client.sendTransaction(
      Buffer.from(stxXfer2.serialize())
    );

    const stxXferTx1 = await standByForTxSuccess(stxXferId1);
    expect(stxXferTx1.token_transfer_recipient_address).toBe(delegatorAccount.stxAddr);

    const stxXferTx2 = await standByForTxSuccess(stxXferId2);
    expect(stxXferTx2.token_transfer_recipient_address).toBe(delegateeAccount.stxAddr);

    // ensure delegator account balance is correct
    const delegatorBalance = await testEnv.client.getAccountBalance(delegatorAccount.stxAddr);
    expect(delegatorBalance.toString()).toBe(gasAmount.toString());

    // ensure delegatee account balance is correct
    const delegateeBalance = await testEnv.client.getAccountBalance(delegateeAccount.stxAddr);
    expect(delegateeBalance.toString()).toBe(stackingAmount.toString());
  });

  test('Get pox-info', async () => {
    // wait until the start of the next cycle so we have enough blocks within the cycle to perform the various txs
    // poxInfo = await standByForPoxCycle();
    poxInfo = await standByForNextPoxCycle();

    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-3');
  });

  test('Perform delegate-stx operation', async () => {
    const txFee = 10000n;
    const balanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    const balanceTotal = BigInt(balanceInfo.balance);
    expect(balanceTotal).toBeGreaterThan(txFee);
    const balanceLocked = BigInt(balanceInfo.locked);
    expect(balanceLocked).toBe(0n);
    const delegateAmount = balanceTotal - txFee * 2n;
    const delegateStxTx = await makeContractCall({
      senderKey: delegateeAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stx',
      functionArgs: [
        uintCV(delegateAmount),
        standardPrincipalCV(delegatorAccount.stxAddr), // delegate-to
        noneCV(), // untilBurnBlockHeight
        someCV(delegateeAccount.poxAddrClar), // pox-addr
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStxTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStxTx.serialize())
    );
    const delegateStxDbTx = await standByForTxSuccess(delegateStxTxId);

    // validate delegate-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox3_events/tx/${delegateStxDbTx.tx_id}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stx',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegateeAccount.stxAddr,
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        amount_ustx: delegateAmount.toString(),
        delegate_to: delegatorAccount.stxAddr,
      })
    );

    // check delegatee locked amount is still zero
    const balanceInfo2 = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(balanceInfo2.locked)).toBe(0n);
  });

  test('Perform delegate-stack-stx operation', async () => {
    // get amount delegated
    const getDelegationInfo1 = await readOnlyFnCall<
      ClarityValueTuple<{ 'amount-ustx': ClarityValueUInt }>
    >(
      [contractAddress, contractName],
      'get-delegation-info',
      [standardPrincipalCV(delegateeAccount.stxAddr)],
      delegateeAccount.stxAddr
    );
    const amountDelegated = BigInt(getDelegationInfo1.data['amount-ustx'].value);
    expect(amountDelegated).toBeGreaterThan(0n);

    const amountToDelegateInitial = amountDelegated - stxToDelegateIncrease;

    const poxInfo2 = await testEnv.client.getPox();

    const startBurnHt = poxInfo2.current_burnchain_block_height as number;

    const txFee = 10000n;
    const delegateStackStxTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        standardPrincipalCV(delegateeAccount.stxAddr), // stacker
        uintCV(amountToDelegateInitial), // amount-ustx
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(startBurnHt), // start-burn-ht
        uintCV(1), // lock-period
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStackStxTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackStxTx.serialize())
    );
    const delegateStackStxDbTx = await standByForTxSuccess(delegateStackStxTxId);

    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(amountToDelegateInitial);
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

    // validate delegate-stack-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox3_events/tx/${delegateStackStxTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stack-stx',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegateeAccount.stxAddr,
        balance: BigInt(coreBalanceInfo.balance).toString(),
        locked: amountToDelegateInitial.toString(),
        burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        lock_period: '1',
        lock_amount: amountToDelegateInitial.toString(),
      })
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(amountToDelegateInitial));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
  });

  test('Perform delegate-stack-increase', async () => {
    const coreBalanceInfoPreIncrease = await testEnv.client.getAccount(delegateeAccount.stxAddr);

    const txFee = 10000n;
    const delegateStackIncreaseTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-increase',
      functionArgs: [
        standardPrincipalCV(delegateeAccount.stxAddr), // stacker
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(stxToDelegateIncrease), // increase-by
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStackIncreaseTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackIncreaseTx.serialize())
    );
    const delegateStackIncreaseDbTx = await standByForTxSuccess(delegateStackIncreaseTxId);

    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(
      BigInt(coreBalanceInfoPreIncrease.locked) + stxToDelegateIncrease
    );
    expect(BigInt(coreBalanceInfo.balance)).toBe(
      BigInt(coreBalanceInfoPreIncrease.balance) - stxToDelegateIncrease
    );
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

    // validate delegate-stack-stx pox2 event for this tx
    const res: any = await fetchGet(
      `/extended/v1/pox3_events/tx/${delegateStackIncreaseDbTx.tx_id}`
    );
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stack-increase',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegateeAccount.stxAddr,
        balance: BigInt(coreBalanceInfo.balance).toString(),
        locked: BigInt(coreBalanceInfo.locked).toString(),
        burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        delegator: delegatorAccount.stxAddr,
        increase_by: stxToDelegateIncrease.toString(),
        total_locked: BigInt(coreBalanceInfo.locked).toString(),
      })
    );

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(BigInt(coreBalanceInfo.locked)));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
  });

  test('Perform delegate-stack-extend', async () => {
    const coreBalanceInfoPreIncrease = await testEnv.client.getAccount(delegateeAccount.stxAddr);

    const txFee = 10000n;
    const extendCount = 1n;
    const delegateStackExtendTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-extend',
      functionArgs: [
        standardPrincipalCV(delegateeAccount.stxAddr), // stacker
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(extendCount), // extend-count
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStackExtendTxId } = await testEnv.client.sendTransaction(
      Buffer.from(delegateStackExtendTx.serialize())
    );
    const delegateStackExtendDbTx = await standByForTxSuccess(delegateStackExtendTxId);

    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBeGreaterThan(0n);
    expect(BigInt(coreBalanceInfo.balance)).toBeGreaterThan(0n);
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(coreBalanceInfoPreIncrease.unlock_height);

    // validate delegate-stack-extend pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox3_events/tx/${delegateStackExtendTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stack-extend',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegateeAccount.stxAddr,
        balance: BigInt(coreBalanceInfo.balance).toString(),
        locked: BigInt(coreBalanceInfo.locked).toString(),
        burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        delegator: delegatorAccount.stxAddr,
        extend_count: extendCount.toString(),
        unlock_burn_height: coreBalanceInfo.unlock_height.toString(),
      })
    );

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(BigInt(coreBalanceInfo.locked)));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
  });

  test('Perform stack-aggregation-commit - delegator commit to stacking operation', async () => {
    const poxInfo2 = await testEnv.client.getPox();
    const rewardCycle = BigInt(poxInfo2.next_cycle.id);
    const stackAggrCommitTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-commit',
      functionArgs: [
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(rewardCycle), // reward-cycle
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000,
      validateWithAbi: false,
    });
    const { txId: stackAggrCommitTxId } = await testEnv.client.sendTransaction(
      Buffer.from(stackAggrCommitTx.serialize())
    );
    const stackAggrCommmitDbTx = await standByForTxSuccess(stackAggrCommitTxId);

    // validate stack-aggregation-commit pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox3_events/tx/${stackAggrCommitTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-aggregation-commit',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegatorAccount.stxAddr,
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
    const coreBalanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(0n);
    expect(coreBalanceInfo.unlock_height).toBe(0);

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(BigInt(coreBalanceInfo.locked)));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
  });
});
