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
import { ClarityValueTuple, ClarityValueUInt } from '@stacks/codec';
import assert from 'node:assert/strict';
import { StackingClient } from '@stacks/stacking';
import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { hexToBytes } from '@stacks/common';
import { AddressStxBalance } from '../../../src/api/schemas/entities/addresses.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/faucets.ts';
import {
  Account,
  accountFromKey,
  fetchGet,
  getKryptonContext,
  KryptonContext,
  readOnlyFnCall,
  standByForNextPoxCycle,
  standByForPoxCycle,
  standByForTxSuccess,
  standByUntilBurnBlock,
  stopKryptonContext,
} from '../krypton-env.ts';
import { before, after, describe, test } from 'node:test';

describe('PoX-4 - Delegate Stacking operations', () => {
  let ctx: KryptonContext;
  const seedKey = FAUCET_TESTNET_KEYS[4].secretKey;
  const delegatorKey = '72e8e3725324514c38c2931ed337ab9ab8d8abaae83ed2275456790194b1fd3101';
  const delegateeKey = '0d174cf0be276cedcf21727611ef2504aed093d8163f65985c07760fda12a7ea01';

  const stxToDelegateIncrease = 2000n;

  let seedAccount: Account;
  let delegatorAccount: Account;
  let delegateeAccount: Account;

  let poxInfo: CoreRpcPoxInfo;
  let contractAddress: string;
  let contractName: string;

  let stackingClient: StackingClient;
  let signerPrivKey: string;
  let signerPubKey: string;

  before(async () => {
    ctx = await getKryptonContext();
    seedAccount = accountFromKey(seedKey);
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
    const { txId: stxXferId1 } = await ctx.client.sendTransaction(
      Buffer.from(stxXfer1.serialize())
    );

    // transfer pox "min_amount_ustx" from seed to delegatee account
    const stackingAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    const stxXfer2 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: delegateeAccount.stxAddr,
      amount: stackingAmount,
      network: ctx.stacksNetwork,
      fee: 200,
      nonce: stxXfer1.auth.spendingCondition.nonce + 1n,
    });
    const { txId: stxXferId2 } = await ctx.client.sendTransaction(
      Buffer.from(stxXfer2.serialize())
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
    // wait until the start of the next cycle so we have enough blocks within the cycle to perform the various txs
    // poxInfo = await standByForPoxCycle();
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
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStxTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStxTx.serialize())
    );
    const delegateStxDbTx = await standByForTxSuccess(delegateStxTxId, ctx);

    // validate delegate-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStxDbTx.tx_id}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'delegate-stx');
    assert.equal(res.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(res.results[0].stacker, delegateeAccount.stxAddr);
    assert.equal(res.results[0].data.amount_ustx, delegateAmount.toString());
    assert.equal(res.results[0].data.delegate_to, delegatorAccount.stxAddr);

    // validate pool delegations
    const stackersRes: any = await fetchGet(
      `/extended/v1/pox4/${delegatorAccount.stxAddr}/delegations`,
      ctx
    );
    assert.ok(stackersRes);
    assert.equal(stackersRes.total, 1);
    assert.equal(stackersRes.results.length, 1);
    assert.deepEqual(stackersRes.results[0], {
      amount_ustx: delegateAmount.toString(),
      pox_addr: delegateeAccount.btcTestnetAddr,
      stacker: delegateeAccount.stxAddr,
      tx_id: delegateStxDbTx.tx_id,
      block_height: delegateStxDbTx.block_height,
    });

    // validate pool delegations respects `after_block` limitter
    const stackersRes2: any = await fetchGet(
      `/extended/v1/pox4/${delegatorAccount.stxAddr}/delegations?after_block=${delegateStxDbTx.block_height}`,
      ctx
    );
    assert.ok(stackersRes2);
    assert.equal(stackersRes2.total, 0);
    assert.equal(stackersRes2.results.length, 0);

    // check delegatee locked amount is still zero
    const balanceInfo2 = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.equal(BigInt(balanceInfo2.locked), 0n);
  });

  test('Perform delegate-stack-stx operation', async () => {
    // get amount delegated
    await standByForPoxCycle(ctx);
    const getDelegationInfo1 = await readOnlyFnCall<
      ClarityValueTuple<{ 'amount-ustx': ClarityValueUInt }>
    >(
      [contractAddress, contractName],
      'get-delegation-info',
      ctx,
      [standardPrincipalCV(delegateeAccount.stxAddr)],
      delegateeAccount.stxAddr
    );
    const amountDelegated = BigInt(getDelegationInfo1.data['amount-ustx'].value);
    assert.ok(amountDelegated > 0n);

    const amountToDelegateInitial = amountDelegated - stxToDelegateIncrease;

    const poxInfo2 = await ctx.client.getPox();

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
        uintCV(1), // lock-period,
      ],
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStackStxTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackStxTx.serialize())
    );
    const delegateStackStxDbTx = await standByForTxSuccess(delegateStackStxTxId, ctx);

    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), amountToDelegateInitial);
    assert.ok(coreBalanceInfo.unlock_height > 0);

    // validate delegate-stack-stx pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStackStxTxId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'delegate-stack-stx');
    assert.equal(res.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(res.results[0].stacker, delegateeAccount.stxAddr);
    assert.equal(res.results[0].balance, BigInt(coreBalanceInfo.balance).toString());
    assert.equal(res.results[0].locked, amountToDelegateInitial.toString());
    assert.equal(res.results[0].burnchain_unlock_height, coreBalanceInfo.unlock_height.toString());
    assert.equal(res.results[0].data.lock_period, '1');
    assert.equal(res.results[0].data.lock_amount, amountToDelegateInitial.toString());

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(amountToDelegateInitial));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });

  test('Perform delegate-stack-increase', async () => {
    const coreBalanceInfoPreIncrease = await ctx.client.getAccount(delegateeAccount.stxAddr);

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
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStackIncreaseTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackIncreaseTx.serialize())
    );
    const delegateStackIncreaseDbTx = await standByForTxSuccess(delegateStackIncreaseTxId, ctx);

    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
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
    const res: any = await fetchGet(
      `/extended/v1/pox4_events/tx/${delegateStackIncreaseDbTx.tx_id}`,
      ctx
    );
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'delegate-stack-increase');
    assert.equal(res.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(res.results[0].stacker, delegateeAccount.stxAddr);
    assert.equal(res.results[0].balance, BigInt(coreBalanceInfo.balance).toString());
    assert.equal(res.results[0].locked, BigInt(coreBalanceInfo.locked).toString());
    assert.equal(res.results[0].burnchain_unlock_height, coreBalanceInfo.unlock_height.toString());
    assert.equal(res.results[0].data.delegator, delegatorAccount.stxAddr);
    assert.equal(res.results[0].data.increase_by, stxToDelegateIncrease.toString());
    assert.equal(res.results[0].data.total_locked, BigInt(coreBalanceInfo.locked).toString());

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(BigInt(coreBalanceInfo.locked)));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });

  test('Perform delegate-stack-extend', async () => {
    const coreBalanceInfoPreIncrease = await ctx.client.getAccount(delegateeAccount.stxAddr);

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
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const { txId: delegateStackExtendTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackExtendTx.serialize())
    );
    const delegateStackExtendDbTx = await standByForTxSuccess(delegateStackExtendTxId, ctx);

    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.ok(BigInt(coreBalanceInfo.locked) > 0n);
    assert.ok(BigInt(coreBalanceInfo.balance) > 0n);
    assert.ok(coreBalanceInfo.unlock_height > coreBalanceInfoPreIncrease.unlock_height);

    // validate delegate-stack-extend pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStackExtendTxId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'delegate-stack-extend');
    assert.equal(res.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(res.results[0].stacker, delegateeAccount.stxAddr);
    assert.equal(res.results[0].balance, BigInt(coreBalanceInfo.balance).toString());
    assert.equal(res.results[0].locked, BigInt(coreBalanceInfo.locked).toString());
    assert.equal(res.results[0].burnchain_unlock_height, coreBalanceInfo.unlock_height.toString());
    assert.equal(res.results[0].data.delegator, delegatorAccount.stxAddr);
    assert.equal(res.results[0].data.extend_count, extendCount.toString());
    assert.equal(res.results[0].data.unlock_burn_height, coreBalanceInfo.unlock_height.toString());

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(BigInt(coreBalanceInfo.locked)));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });

  test('Perform stack-aggregation-commit - delegator commit to stacking operation', async () => {
    await standByForPoxCycle(ctx);
    const poxInfo2 = await ctx.client.getPox();
    const rewardCycle = BigInt(poxInfo2.next_cycle.id);
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    const signerSig = hexToBytes(
      stackingClient.signPoxSignature({
        topic: 'agg-commit',
        poxAddress: delegateeAccount.btcAddr,
        rewardCycle: Number(rewardCycle),
        period: 1,
        signerPrivateKey: signerPrivKey,
        maxAmount: coreBalanceInfo.locked,
        authId: 0,
      })
    );
    const stackAggrCommitTx = await makeContractCall({
      senderKey: delegatorAccount.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-commit',
      functionArgs: [
        delegateeAccount.poxAddrClar, // pox-addr
        uintCV(rewardCycle), // reward-cycle
        someCV(bufferCV(signerSig)), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(coreBalanceInfo.locked.toString()), // max-amount
        uintCV(0), // auth-id
      ],
      network: ctx.stacksNetwork,
      fee: 10000,
      validateWithAbi: false,
    });
    const { txId: stackAggrCommitTxId } = await ctx.client.sendTransaction(
      Buffer.from(stackAggrCommitTx.serialize())
    );
    const stackAggrCommmitDbTx = await standByForTxSuccess(stackAggrCommitTxId, ctx);

    // validate stack-aggregation-commit pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${stackAggrCommitTxId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'stack-aggregation-commit');
    assert.equal(res.results[0].pox_addr, delegateeAccount.btcTestnetAddr);
    assert.equal(res.results[0].stacker, delegatorAccount.stxAddr);
  });

  test('Wait for current two pox cycles to complete', async () => {
    await standByForPoxCycle(ctx);
    await standByForPoxCycle(ctx);
  });

  test('Validate account balances are unlocked', async () => {
    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(delegateeAccount.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), 0n);
    assert.equal(coreBalanceInfo.unlock_height, 0);

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${delegateeAccount.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(BigInt(coreBalanceInfo.locked)));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });

  test('BTC stacking reward received', async () => {
    const curBlock = await ctx.db.getCurrentBlock();
    assert(curBlock.found);
    await standByUntilBurnBlock(curBlock.result.burn_block_height + 1, ctx);

    const received: number = await ctx.bitcoinRpcClient.getreceivedbyaddress({
      address: delegateeAccount.btcAddr,
      minconf: 0,
    });
    assert.ok(received > 0);
  });
});
