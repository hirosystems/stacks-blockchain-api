import { CoreRpcPoxInfo } from '../../../src/core-rpc/client.ts';
import { stxToMicroStx } from '../../../src/helpers.ts';
import {
  bufferCV,
  makeContractCall,
  makeRandomPrivKey,
  makeSTXTokenTransfer,
  noneCV,
  someCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import codec from '@stacks/codec';
import * as assert from 'node:assert/strict';
import { hexToBytes } from '@stacks/common';
import { StackingClient } from '@stacks/stacking';
import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { AddressStxBalance } from '../../../src/api/schemas/entities/addresses.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/faucets.ts';
import {
  Account,
  accountFromKey,
  fetchGet,
  getKryptonContext,
  readOnlyFnCall,
  standByForAccountUnlock,
  standByForNextPoxCycle,
  standByForPoxCycle,
  standByForTxSuccess,
  standByUntilBurnBlock,
  stopKryptonContext,
  KryptonContext,
} from '../krypton-env.ts';
import { before, after, describe, test } from 'node:test';

describe('PoX-4 - Delegate aggregation increase operations', () => {
  let ctx: KryptonContext;
  const seedKey = FAUCET_TESTNET_KEYS[4].secretKey;
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
  let signerPrivKey: string;
  let signerPubKey: string;

  before(async () => {
    ctx = await getKryptonContext();
    seedAccount = accountFromKey(seedKey);
    // delegatorKey = ECPair.makeRandom({ compressed: true }).privateKey!.toString('hex');
    // delegateeKey = ECPair.makeRandom({ compressed: true }).privateKey!.toString('hex');
    delegatorAccount = accountFromKey(delegatorKey);
    delegateeAccount = accountFromKey(delegateeKey);

    stackingClient = new StackingClient({ address: delegatorAccount.stxAddr, network: ctx.stacksNetwork });
    signerPrivKey = makeRandomPrivKey();
    signerPubKey = getPublicKeyFromPrivate(signerPrivKey);
  });

  after(async () => {
    await stopKryptonContext(ctx);
  });

  test('Import testing accounts to bitcoind', async () => {
    // register delegatee account to bitcoind wallet
    await ctx.bitcoinRpcClient.importaddress({
      address: delegateeAccount.btcAddr,
      label: delegateeAccount.btcAddr,
      rescan: false,
    });
  });

  test('Seed delegate accounts', async () => {
    poxInfo = await ctx.client.getPox();

    // transfer 10 STX (for tx fees) from seed to delegator account
    const gasAmount = stxToMicroStx(100);
    const stxXfer1 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: delegatorAccount.stxAddr,
      amount: gasAmount,
      network: ctx.stacksNetwork,
      fee: 200,
    });
    const stxXfer1Hex = stxXfer1.serialize();
    const { txId: stxXferId1 } = await ctx.client.sendTransaction(
      Buffer.from(stxXfer1Hex, 'hex')
    );

    // transfer pox "min_amount_ustx" from seed to delegatee account
    const stackingAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 2.1).toString());
    const stxXfer2 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: delegateeAccount.stxAddr,
      amount: stackingAmount,
      network: ctx.stacksNetwork,
      fee: 200,
      nonce: stxXfer1.auth.spendingCondition.nonce + 1n,
    });
    const stxXfer2Hex = stxXfer2.serialize();
    const { txId: stxXferId2 } = await ctx.client.sendTransaction(
      Buffer.from(stxXfer2Hex, 'hex')
    );

    const stxXferTx1 = await standByForTxSuccess(stxXferId1, ctx);
    assert.equal(stxXferTx1.token_transfer_recipient_address, delegatorAccount.stxAddr);

    const stxXferTx2 = await standByForTxSuccess(stxXferId2, ctx);
    assert.equal(stxXferTx2.token_transfer_recipient_address, delegateeAccount.stxAddr);

    // ensure delegator account balance is correct
    const delegatorBalance = await ctx.client.getAccountBalance(delegatorAccount.stxAddr);
    assert.equal(delegatorBalance.toString(), gasAmount.toString());

    // ensure delegatee account balance is correct
    const delegateeBalance = await ctx.client.getAccountBalance(delegateeAccount.stxAddr);
    assert.equal(delegateeBalance.toString(), stackingAmount.toString());
  });

  test('Get pox-info', async () => {
    // wait until the start of the next cycle so we have enough blocks within the cycle to perform
    // the various txs
    poxInfo = await standByForNextPoxCycle(ctx);
    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    assert.equal(contractName, 'pox-4');
  });

  test('Perform delegate-stx operation', async () => {
    const txFee = 10000n;
    const balanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    const balanceTotal = BigInt(balanceInfo.balance);
    assert.ok(balanceTotal > txFee);
    const balanceLocked = BigInt(balanceInfo.locked);
    assert.equal(balanceLocked, 0n);

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
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const delegateStxTxHex = delegateStxTx.serialize();
    const { txId: delegateStxTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStxTxHex, 'hex')
    );
    const delegateStxDbTx = await standByForTxSuccess(delegateStxTxId, ctx);

    // validate pool delegations
    const stackersRes: any = await fetchGet(
      `/extended/v1/pox4/${delegatorAccount.stxAddr}/delegations`,
      ctx
    );
    assert.ok(stackersRes);
    assert.equal(stackersRes.total, 1);
    assert.equal(stackersRes.results.length, 1);
    assert.deepStrictEqual(stackersRes.results[0], {
      amount_ustx: delegateAmount.toString(),
      pox_addr: delegateeAccount.btcTestnetAddr,
      stacker: delegateeAccount.stxAddr,
      tx_id: delegateStxDbTx.tx_id,
      block_height: delegateStxDbTx.block_height,
    });

    // check delegatee locked amount is still zero
    const balanceInfo2 = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.equal(BigInt(balanceInfo2.locked), 0n);
  });

  let amountDelegated: bigint;
  let amountStackedInitial: bigint;
  test('Perform delegate-stack-stx operation', async () => {
    await standByForPoxCycle(ctx);
    // get amount delegated
    const getDelegationInfo1 = await readOnlyFnCall<
      codec.ClarityValueTuple<{ 'amount-ustx': codec.ClarityValueUInt }>
    >(
      [contractAddress, contractName],
      'get-delegation-info',
      ctx,
      [standardPrincipalCV(delegateeAccount.stxAddr)],
      delegateeAccount.stxAddr
    );
    amountDelegated = BigInt(getDelegationInfo1.data['amount-ustx'].value);
    assert.ok(amountDelegated > 0n);

    const poxInfo2 = await ctx.client.getPox();
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
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const delegateStackStxTxHex = delegateStackStxTx.serialize();
    const { txId: delegateStackStxTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackStxTxHex, 'hex')
    );
    const delegateStackStxDbTx = await standByForTxSuccess(delegateStackStxTxId, ctx);

    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), amountStackedInitial);
    assert.ok(coreBalanceInfo.unlock_height > 0);

    // validate delegate-stack-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStackStxTxId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'delegate-stack-stx');
    assert.equal(res.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(res.results[0].stacker, delegateeAccount.stxAddr);
    assert.equal(res.results[0].balance, BigInt(coreBalanceInfo.balance).toString());
    assert.equal(res.results[0].locked, amountStackedInitial.toString());
    assert.equal(res.results[0].burnchain_unlock_height, coreBalanceInfo.unlock_height.toString());
    assert.equal(res.results[0].data.lock_period, '6');
    assert.equal(res.results[0].data.lock_amount, amountStackedInitial.toString());

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(amountStackedInitial));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });

  test('Perform stack-aggregation-commit-indexed - delegator commit to stacking operation', async () => {
    await standByForPoxCycle(ctx);
    const poxInfo2 = await ctx.client.getPox();
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
      network: ctx.stacksNetwork,
      fee: 10000,
      validateWithAbi: false,
    });
    const stackAggrCommitTxHex = stackAggrCommitTx.serialize();
    const { txId: stackAggrCommitTxId } = await ctx.client.sendTransaction(
      Buffer.from(stackAggrCommitTxHex, 'hex')
    );
    const stackAggrCommmitDbTx = await standByForTxSuccess(stackAggrCommitTxId, ctx);

    const commitIndexResult = codec.decodeClarityValue<
      codec.ClarityValueResponseOk<codec.ClarityValueUInt>
    >(stackAggrCommmitDbTx.raw_result);
    console.log('stack-aggregation-commit-indexed result:', commitIndexResult.repr);

    // AKA `reward-cycle-index`, needs to be saved in order to use with the `stack-aggregation-increase` call
    poxCycleAddressIndex = BigInt(commitIndexResult.value.value);
    assert.equal(poxCycleAddressIndex, 0n);

    // validate stack-aggregation-commit pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${stackAggrCommitTxId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'stack-aggregation-commit-indexed');
    assert.equal(res.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(res.results[0].stacker, delegatorAccount.stxAddr);
    assert.equal(res.results[0].data.signer_key, `0x${signerPubKey}`);
    assert.match(res.results[0].data.end_cycle_id, /\d+/);
    assert.match(res.results[0].data.start_cycle_id, /\d+/);

    const stackerRes: any = await fetchGet(
      `/extended/v1/pox4/stacker/${delegatorAccount.stxAddr}`,
      ctx
    );
    assert.ok(stackerRes);
    assert.equal(stackerRes.results[0].name, 'stack-aggregation-commit-indexed');
    assert.equal(stackerRes.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(stackerRes.results[0].stacker, delegatorAccount.stxAddr);
    assert.equal(stackerRes.results[0].data.signer_key, `0x${signerPubKey}`);
    assert.match(stackerRes.results[0].data.end_cycle_id, /\d+/);
    assert.match(stackerRes.results[0].data.start_cycle_id, /\d+/);
  });

  test('Perform stack-aggregation-increase - delegator increase committed stacking amount', async () => {
    const coreBalanceInfoPreIncrease = await ctx.client.getAccount(delegateeAccount.stxAddr);
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
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const delegateStackIncreaseTxHex = delegateStackIncreaseTx.serialize();
    const { txId: delegateStackIncreaseTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackIncreaseTxHex, 'hex')
    );

    const delegateStackIncreaseDbTx = await standByForTxSuccess(delegateStackIncreaseTxId, ctx);
    const delegateStackIncreaseResult = codec.decodeClarityValue<
      codec.ClarityValueResponseOk<
        codec.ClarityValueTuple<{
          stacker: codec.ClarityValuePrincipalStandard;
          'total-locked': codec.ClarityValueUInt;
        }>
      >
    >(delegateStackIncreaseDbTx.raw_result);
    const stackIncreaseTxTotalLocked = BigInt(
      delegateStackIncreaseResult.value.data['total-locked'].value
    );
    assert.ok(stackIncreaseTxTotalLocked > 0n);
    assert.equal(delegateStackIncreaseResult.value.data.stacker.address, delegateeAccount.stxAddr);

    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), stackIncreaseTxTotalLocked);
    assert.equal(
      BigInt(coreBalanceInfo.locked),
      BigInt(coreBalanceInfoPreIncrease.locked) + stxToDelegateIncrease
    );
    assert.equal(
      BigInt(coreBalanceInfo.balance),
      BigInt(coreBalanceInfoPreIncrease.balance) - stxToDelegateIncrease
    );
    assert.ok(coreBalanceInfo.unlock_height > 0);

    // validate delegate-stack-stx pox2 event for this tx
    const delegateStackIncreasePoxEvents: any = await fetchGet(
      `/extended/v1/pox4_events/tx/${delegateStackIncreaseDbTx.tx_id}`,
      ctx
    );
    assert.ok(delegateStackIncreasePoxEvents);
    assert.equal(delegateStackIncreasePoxEvents.results.length, 1);
    assert.equal(delegateStackIncreasePoxEvents.results[0].name, 'delegate-stack-increase');
    assert.equal(
      delegateStackIncreasePoxEvents.results[0].pox_addr,
      delegateeAccount.btcTestnetAddr
    );
    assert.equal(delegateStackIncreasePoxEvents.results[0].stacker, delegateeAccount.stxAddr);
    assert.equal(
      delegateStackIncreasePoxEvents.results[0].balance,
      BigInt(coreBalanceInfo.balance).toString()
    );
    assert.equal(
      delegateStackIncreasePoxEvents.results[0].locked,
      BigInt(coreBalanceInfo.locked).toString()
    );
    assert.equal(
      delegateStackIncreasePoxEvents.results[0].burnchain_unlock_height,
      coreBalanceInfo.unlock_height.toString()
    );
    assert.equal(
      delegateStackIncreasePoxEvents.results[0].data.delegator,
      delegatorAccount.stxAddr
    );
    assert.equal(
      delegateStackIncreasePoxEvents.results[0].data.increase_by,
      stxToDelegateIncrease.toString()
    );
    assert.equal(
      delegateStackIncreasePoxEvents.results[0].data.total_locked,
      BigInt(coreBalanceInfo.locked).toString()
    );

    // then commit to increased amount with call to `stack-aggregation-increase`
    const poxInfo2 = await ctx.client.getPox();
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
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
      nonce: delegateStackIncreaseTx.auth.spendingCondition.nonce + 1n,
    });
    const stackAggrIncreaseTxHex = stackAggrIncreaseTx.serialize();
    const { txId: stackAggrIncreaseTxId } = await ctx.client.sendTransaction(
      Buffer.from(stackAggrIncreaseTxHex, 'hex')
    );

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(coreBalanceInfo.locked));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);

    const stackAggrIncreaseDbTx = await standByForTxSuccess(stackAggrIncreaseTxId, ctx);
    const aggrIncreaseResult = codec.decodeClarityValue<
      codec.ClarityValueResponseOk<codec.ClarityValueBoolTrue>
    >(stackAggrIncreaseDbTx.raw_result);
    assert.equal(aggrIncreaseResult.value.value, true);

    // validate stack-aggregation-commit pox2 event for this tx
    const stackAggreIncreasePoxEvents: any = await fetchGet(
      `/extended/v1/pox4_events/tx/${stackAggrIncreaseTxId}`,
      ctx
    );
    assert.ok(stackAggreIncreasePoxEvents);
    assert.equal(stackAggreIncreasePoxEvents.results.length, 1);
    assert.equal(stackAggreIncreasePoxEvents.results[0].name, 'stack-aggregation-increase');
    assert.equal(stackAggreIncreasePoxEvents.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(stackAggreIncreasePoxEvents.results[0].stacker, delegatorAccount.stxAddr);
  });

  test('Wait for current pox cycle to complete', async () => {
    const poxStatus1 = await standByForPoxCycle(ctx);
    const poxStatus2 = await standByForPoxCycle(ctx);
    console.log('___Wait for current pox cycle to complete___', {
      pox1: { height: poxStatus1.current_burnchain_block_height, ...poxStatus1.next_cycle },
      pox2: { height: poxStatus2.current_burnchain_block_height, ...poxStatus2.next_cycle },
    });
    await standByForPoxCycle(ctx);
  });

  test('Validate account balances are unlocked', async () => {
    await standByForAccountUnlock(delegateeAccount.stxAddr, ctx);

    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), 0n);
    assert.equal(coreBalanceInfo.unlock_height, 0);

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(coreBalanceInfo.locked));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });

  test('BTC stacking reward received', async () => {
    const curBlock = await ctx.db.getCurrentBlock();
    assert.ok(curBlock.found);
    await standByUntilBurnBlock(curBlock.result.burn_block_height + 1, ctx);

    const received: number = await ctx.bitcoinRpcClient.getreceivedbyaddress({
      address: delegateeAccount.btcAddr,
      minconf: 0,
    });
    assert.ok(received > 0);
  });
});
