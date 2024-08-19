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
  standByForAccountUnlock,
  testEnv,
  standByUntilBurnBlock,
} from '../test-utils/test-helpers';
import { stxToMicroStx } from '../helpers';
import {
  AnchorMode,
  StacksPrivateKey,
  bufferCV,
  makeContractCall,
  makeRandomPrivKey,
  makeSTXTokenTransfer,
  noneCV,
  someCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import {
  ClarityValueBoolTrue,
  ClarityValuePrincipalStandard,
  ClarityValueResponseOk,
  ClarityValueTuple,
  ClarityValueUInt,
  decodeClarityValue,
} from 'stacks-encoding-native-js';
import * as assert from 'assert';
import { hexToBytes } from '@stacks/common';
import { StackingClient } from '@stacks/stacking';
import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { AddressStxBalance } from '../api/schemas/entities/addresses';

describe('PoX-4 - Delegate aggregation increase operations', () => {
  const seedKey = testnetKeys[4].secretKey;
  const delegatorKey = '04608922f3ce63971bb120fa9c9454c5bd06370f61414040a737a6ee8ef8a10f01';
  const delegateeKey = 'b038e143cf4ee4c079b3c3605a8ed28732e5745c138b728408e80faf7a59b8c201';

  let seedAccount: Account;
  let delegatorAccount: Account;
  let delegateeAccount: Account;

  let poxInfo: CoreRpcPoxInfo;
  let contractAddress: string;
  let contractName: string;

  let poxCycleAddressIndex: bigint;

  let stackingClient: StackingClient;
  let signerPrivKey: StacksPrivateKey;
  let signerPubKey: string;

  beforeAll(() => {
    seedAccount = accountFromKey(seedKey);
    // delegatorKey = ECPair.makeRandom({ compressed: true }).privateKey!.toString('hex');
    // delegateeKey = ECPair.makeRandom({ compressed: true }).privateKey!.toString('hex');
    delegatorAccount = accountFromKey(delegatorKey);
    delegateeAccount = accountFromKey(delegateeKey);

    stackingClient = new StackingClient(delegatorAccount.stxAddr, testEnv.stacksNetwork);
    signerPrivKey = makeRandomPrivKey();
    signerPubKey = getPublicKeyFromPrivate(signerPrivKey.data);
  });

  test('Import testing accounts to bitcoind', async () => {
    // register delegatee account to bitcoind wallet
    await testEnv.bitcoinRpcClient.importaddress({
      address: delegateeAccount.btcAddr,
      label: delegateeAccount.btcAddr,
      rescan: false,
    });
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
    const stackingAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 2.1).toString());
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
    // wait until the start of the next cycle so we have enough blocks within the cycle to perform
    // the various txs
    poxInfo = await standByForNextPoxCycle();
    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-4');
  });

  test('Perform delegate-stx operation', async () => {
    const txFee = 10000n;
    const balanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    const balanceTotal = BigInt(balanceInfo.balance);
    expect(balanceTotal).toBeGreaterThan(txFee);
    const balanceLocked = BigInt(balanceInfo.locked);
    expect(balanceLocked).toBe(0n);

    const delegateAmount = 2n * BigInt(poxInfo.min_amount_ustx);
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

    // validate pool delegations
    const stackersRes: any = await fetchGet(
      `/extended/v1/pox4/${delegatorAccount.stxAddr}/delegations`
    );
    expect(stackersRes).toBeDefined();
    expect(stackersRes.total).toBe(1);
    expect(stackersRes.results).toHaveLength(1);
    expect(stackersRes.results[0]).toEqual({
      amount_ustx: delegateAmount.toString(),
      pox_addr: delegateeAccount.btcTestnetAddr,
      stacker: delegateeAccount.stxAddr,
      tx_id: delegateStxDbTx.tx_id,
      block_height: delegateStxDbTx.block_height,
    });

    // check delegatee locked amount is still zero
    const balanceInfo2 = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(balanceInfo2.locked)).toBe(0n);
  });

  let amountDelegated: bigint;
  let amountStackedInitial: bigint;
  test('Perform delegate-stack-stx operation', async () => {
    await standByForPoxCycle();
    // get amount delegated
    const getDelegationInfo1 = await readOnlyFnCall<
      ClarityValueTuple<{ 'amount-ustx': ClarityValueUInt }>
    >(
      [contractAddress, contractName],
      'get-delegation-info',
      [standardPrincipalCV(delegateeAccount.stxAddr)],
      delegateeAccount.stxAddr
    );
    amountDelegated = BigInt(getDelegationInfo1.data['amount-ustx'].value);
    expect(amountDelegated).toBeGreaterThan(0n);

    const poxInfo2 = await testEnv.client.getPox();
    const startBurnHt = poxInfo2.current_burnchain_block_height as number;

    amountStackedInitial = amountDelegated - 20000n;

    const txFee = 10000n;
    const delegateStackStxTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        standardPrincipalCV(delegateeAccount.stxAddr), // stacker
        uintCV(amountStackedInitial), // amount-ustx
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(startBurnHt), // start-burn-ht
        uintCV(6), // lock-period,
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
    expect(BigInt(coreBalanceInfo.locked)).toBe(amountStackedInitial);
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

    // validate delegate-stack-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStackStxTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stack-stx',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegateeAccount.stxAddr,
        balance: BigInt(coreBalanceInfo.balance).toString(),
        locked: amountStackedInitial.toString(),
        burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        lock_period: '6',
        lock_amount: amountStackedInitial.toString(),
      })
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(amountStackedInitial));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
  });

  test('Perform stack-aggregation-commit-indexed - delegator commit to stacking operation', async () => {
    await standByForPoxCycle();
    const poxInfo2 = await testEnv.client.getPox();
    const rewardCycle = BigInt(poxInfo2.next_cycle.id);
    const signerSig = hexToBytes(
      stackingClient.signPoxSignature({
        topic: 'agg-commit',
        poxAddress: delegateeAccount.btcAddr,
        rewardCycle: Number(rewardCycle),
        period: 1,
        signerPrivateKey: signerPrivKey,
        maxAmount: amountStackedInitial,
        authId: 0,
      })
    );
    const stackAggrCommitTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-commit-indexed',
      functionArgs: [
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(rewardCycle), // reward-cycle
        someCV(bufferCV(signerSig)), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(amountStackedInitial.toString()), // max-amount
        uintCV(0), // auth-id
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

    const commitIndexResult = decodeClarityValue<ClarityValueResponseOk<ClarityValueUInt>>(
      stackAggrCommmitDbTx.raw_result
    );
    console.log('stack-aggregation-commit-indexed result:', commitIndexResult.repr);

    // AKA `reward-cycle-index`, needs to be saved in order to use with the `stack-aggregation-increase` call
    poxCycleAddressIndex = BigInt(commitIndexResult.value.value);
    expect(poxCycleAddressIndex).toEqual(0n);

    // validate stack-aggregation-commit pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${stackAggrCommitTxId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-aggregation-commit-indexed',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegatorAccount.stxAddr,
        data: expect.objectContaining({
          signer_key: `0x${signerPubKey}`,
          end_cycle_id: expect.stringMatching(/\d+/),
          start_cycle_id: expect.stringMatching(/\d+/),
        }),
      })
    );

    const stackerRes: any = await fetchGet(`/extended/v1/pox4/stacker/${delegatorAccount.stxAddr}`);
    expect(stackerRes).toBeDefined();
    expect(stackerRes.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-aggregation-commit-indexed',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegatorAccount.stxAddr,
        data: expect.objectContaining({
          signer_key: `0x${signerPubKey}`,
          end_cycle_id: expect.stringMatching(/\d+/),
          start_cycle_id: expect.stringMatching(/\d+/),
        }),
      })
    );
  });

  test('Perform stack-aggregation-increase - delegator increase committed stacking amount', async () => {
    const coreBalanceInfoPreIncrease = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    const txFee = 10000n;

    // delegator must first lock increase amount with call to `delegate-stack-increase`
    const stxToDelegateIncrease = 2000n;
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
    const delegateStackIncreaseResult = decodeClarityValue<
      ClarityValueResponseOk<
        ClarityValueTuple<{
          stacker: ClarityValuePrincipalStandard;
          'total-locked': ClarityValueUInt;
        }>
      >
    >(delegateStackIncreaseDbTx.raw_result);
    const stackIncreaseTxTotalLocked = BigInt(
      delegateStackIncreaseResult.value.data['total-locked'].value
    );
    expect(stackIncreaseTxTotalLocked).toBeGreaterThan(0n);
    expect(delegateStackIncreaseResult.value.data.stacker.address).toBe(delegateeAccount.stxAddr);

    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(stackIncreaseTxTotalLocked);
    expect(BigInt(coreBalanceInfo.locked)).toBe(
      BigInt(coreBalanceInfoPreIncrease.locked) + stxToDelegateIncrease
    );
    expect(BigInt(coreBalanceInfo.balance)).toBe(
      BigInt(coreBalanceInfoPreIncrease.balance) - stxToDelegateIncrease
    );
    expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

    // validate delegate-stack-stx pox2 event for this tx
    const delegateStackIncreasePoxEvents: any = await fetchGet(
      `/extended/v1/pox4_events/tx/${delegateStackIncreaseDbTx.tx_id}`
    );
    expect(delegateStackIncreasePoxEvents).toBeDefined();
    expect(delegateStackIncreasePoxEvents.results).toHaveLength(1);
    expect(delegateStackIncreasePoxEvents.results[0]).toEqual(
      expect.objectContaining({
        name: 'delegate-stack-increase',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegateeAccount.stxAddr,
        balance: BigInt(coreBalanceInfo.balance).toString(),
        locked: BigInt(coreBalanceInfo.locked).toString(),
        burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
      })
    );
    expect(delegateStackIncreasePoxEvents.results[0].data).toEqual(
      expect.objectContaining({
        delegator: delegatorAccount.stxAddr,
        increase_by: stxToDelegateIncrease.toString(),
        total_locked: BigInt(coreBalanceInfo.locked).toString(),
      })
    );

    // then commit to increased amount with call to `stack-aggregation-increase`
    const poxInfo2 = await testEnv.client.getPox();
    const maxAmount = amountStackedInitial + stxToDelegateIncrease;
    const rewardCycle = BigInt(poxInfo2.next_cycle.id);
    const signerSig = hexToBytes(
      stackingClient.signPoxSignature({
        topic: 'agg-increase',
        poxAddress: delegateeAccount.btcAddr,
        rewardCycle: Number(rewardCycle),
        period: 1,
        signerPrivateKey: signerPrivKey,
        maxAmount: maxAmount,
        authId: 1,
      })
    );
    const stackAggrIncreaseTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-increase',
      functionArgs: [
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(rewardCycle), // reward-cycle
        uintCV(poxCycleAddressIndex), // reward-cycle-index
        someCV(bufferCV(signerSig)), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(maxAmount.toString()), // max-amount
        uintCV(1), // auth-id
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
      nonce: delegateStackIncreaseTx.auth.spendingCondition.nonce + 1n,
    });
    const { txId: stackAggrIncreaseTxId } = await testEnv.client.sendTransaction(
      Buffer.from(stackAggrIncreaseTx.serialize())
    );

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(BigInt(coreBalanceInfo.locked)));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);

    const stackAggrIncreaseDbTx = await standByForTxSuccess(stackAggrIncreaseTxId);
    const aggrIncreaseResult = decodeClarityValue<ClarityValueResponseOk<ClarityValueBoolTrue>>(
      stackAggrIncreaseDbTx.raw_result
    );
    expect(aggrIncreaseResult.value.value).toBe(true);

    // validate stack-aggregation-commit pox2 event for this tx
    const stackAggreIncreasePoxEvents: any = await fetchGet(
      `/extended/v1/pox4_events/tx/${stackAggrIncreaseTxId}`
    );
    expect(stackAggreIncreasePoxEvents).toBeDefined();
    expect(stackAggreIncreasePoxEvents.results).toHaveLength(1);
    expect(stackAggreIncreasePoxEvents.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-aggregation-increase',
        pox_addr: delegateeAccount.btcTestnetAddr,
        stacker: delegatorAccount.stxAddr,
      })
    );
  });

  test('Wait for current pox cycle to complete', async () => {
    const poxStatus1 = await standByForPoxCycle();
    const poxStatus2 = await standByForPoxCycle();
    console.log('___Wait for current pox cycle to complete___', {
      pox1: { height: poxStatus1.current_burnchain_block_height, ...poxStatus1.next_cycle },
      pox2: { height: poxStatus2.current_burnchain_block_height, ...poxStatus2.next_cycle },
    });
    await standByForPoxCycle();
  });

  test('Validate account balances are unlocked', async () => {
    await standByForAccountUnlock(delegateeAccount.stxAddr);

    // validate stacks-node balance
    const coreBalanceInfo = await testEnv.client.getAccount(delegateeAccount.stxAddr);
    expect(BigInt(coreBalanceInfo.locked)).toBe(0n);
    expect(coreBalanceInfo.unlock_height).toBe(0);

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(BigInt(coreBalanceInfo.locked)));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalanceInfo.unlock_height);
  });

  test('BTC stacking reward received', async () => {
    const curBlock = await testEnv.db.getCurrentBlock();
    assert(curBlock.found);
    await standByUntilBurnBlock(curBlock.result.burn_block_height + 1);

    const received: number = await testEnv.bitcoinRpcClient.getreceivedbyaddress({
      address: delegateeAccount.btcAddr,
      minconf: 0,
    });
    expect(received).toBeGreaterThan(0);
  });
});
