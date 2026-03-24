import { StackingClient, poxAddressToTuple } from '@stacks/stacking';
import {
  AnchorMode,
  Cl,
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
import codec from '@stacks/codec';
import { CoreRpcPoxInfo } from '../../../src/core-rpc/client.ts';
import { DbTxStatus } from '../../../src/datastore/common.ts';
import { stxToMicroStx } from '../../../src/helpers.ts';
import { hexToBytes } from '@stacks/common';
import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { AddressStxBalance } from '../../../src/api/schemas/entities/addresses.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/faucets.ts';
import {
  Account,
  accountFromKey,
  fetchGet,
  getKryptonContext,
  KryptonContext,
  readOnlyFnCall,
  standByForPoxCycle,
  standByForTx,
  standByForTxSuccess,
  standByUntilBurnBlock,
  stopKryptonContext,
} from '../krypton-env.ts';
import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';

describe('PoX-4 - Delegate Revoked Stacking', () => {
  let ctx: KryptonContext;
  const seedKey = FAUCET_TESTNET_KEYS[4].secretKey;
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

  let stackingClient: StackingClient;
  let signerPrivKey: StacksPrivateKey;
  let signerPubKey: string;

  before(async () => {
    ctx = await getKryptonContext();
    seedAccount = accountFromKey(seedKey);
    POOL = accountFromKey(delegatorKey);
    STACKER = accountFromKey(delegateeKey);

    stackingClient = new StackingClient(POOL.stxAddr, ctx.stacksNetwork);
    signerPrivKey = makeRandomPrivKey();
    signerPubKey = getPublicKeyFromPrivate(signerPrivKey.data);
  });

  after(async () => {
    await stopKryptonContext(ctx);
  });

  test('Seed delegate accounts', async () => {
    poxInfo = await ctx.client.getPox();

    // transfer 100 STX (for tx fees) from seed to delegator account
    const gasAmount = stxToMicroStx(100);
    const stxXfer1 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: POOL.stxAddr,
      amount: gasAmount,
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: stxXferId1 } = await ctx.client.sendTransaction(
      Buffer.from(stxXfer1.serialize())
    );

    // transfer pox "min_amount_ustx" from seed to delegatee account
    const stackingAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    const stxXfer2 = await makeSTXTokenTransfer({
      senderKey: seedAccount.secretKey,
      recipient: STACKER.stxAddr,
      amount: stackingAmount,
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      nonce: stxXfer1.auth.spendingCondition.nonce + 1n,
      fee: 10000n,
    });
    const { txId: stxXferId2 } = await ctx.client.sendTransaction(
      Buffer.from(stxXfer2.serialize())
    );

    const stxXferTx1 = await standByForTxSuccess(stxXferId1, ctx);
    assert.equal(stxXferTx1.token_transfer_recipient_address, POOL.stxAddr);

    const stxXferTx2 = await standByForTxSuccess(stxXferId2, ctx);
    assert.equal(stxXferTx2.token_transfer_recipient_address, STACKER.stxAddr);

    // ensure delegator account balance is correct
    const delegatorBalance = await ctx.client.getAccountBalance(POOL.stxAddr);
    assert.equal(delegatorBalance.toString(), gasAmount.toString());

    // ensure delegatee account balance is correct
    const delegateeBalance = await ctx.client.getAccountBalance(STACKER.stxAddr);
    assert.equal(delegateeBalance.toString(), stackingAmount.toString());
  });

  test('Pre-checks', async () => {
    // wait until the start of the next cycle so we have enough blocks within the cycle to perform the various txs
    poxInfo = await standByForPoxCycle(ctx);

    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    assert.equal(contractName, 'pox-4');

    const balanceInfo = await ctx.client.getAccount(STACKER.stxAddr);
    assert.ok(BigInt(balanceInfo.balance) > 0n);
    assert.equal(BigInt(balanceInfo.locked), 0n);
  });

  test('Try to perform delegate-stack-stx - without delegation', async () => {
    poxInfo = await ctx.client.getPox();
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
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const delegateStackTxResult = await ctx.client.sendTransaction(
      Buffer.from(delegateStackTx.serialize())
    );
    const delegateStackDbTx = await standByForTx(delegateStackTxResult.txId, ctx);
    assert.notEqual(delegateStackDbTx.status, DbTxStatus.Success);
    const delegateStackResult = codec.decodeClarityValue(delegateStackDbTx.raw_result);
    assert.equal(delegateStackResult.repr, '(err 9)'); // ERR_STACKING_PERMISSION_DENIED
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
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStxTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStxTx.serialize())
    );
    const delegateStxDbTx = await standByForTxSuccess(delegateStxTxId, ctx);

    // validate delegate-stx pox4 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStxDbTx.tx_id}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'delegate-stx');
    assert.equal(res.results[0].pox_addr, STACKER.btcTestnetAddr);
    assert.equal(res.results[0].stacker, STACKER.stxAddr);
    assert.equal(res.results[0].data.amount_ustx, DELEGATE_HALF_AMOUNT.toString());
    assert.equal(res.results[0].data.delegate_to, POOL.stxAddr);

    // check locked amount is still zero (nothing is partially stacked or locked yet)
    const balanceInfo2 = await ctx.client.getAccount(STACKER.stxAddr);
    assert.equal(BigInt(balanceInfo2.locked), 0n);

    // check delegation readonly function
    const getDelegationInfo = await readOnlyFnCall<
      codec.ClarityValueTuple<{ 'amount-ustx': codec.ClarityValueUInt }>
    >(
      [contractAddress, contractName],
      'get-delegation-info',
      ctx,
      [standardPrincipalCV(STACKER.stxAddr)],
      STACKER.stxAddr
    );
    const delegatedAmount = BigInt(getDelegationInfo.data['amount-ustx'].value);
    assert.equal(delegatedAmount, DELEGATE_HALF_AMOUNT);

    // validate pool delegations
    const stackersRes: any = await fetchGet(`/extended/v1/pox4/${POOL.stxAddr}/delegations`, ctx);
    assert.ok(stackersRes);
    assert.equal(stackersRes.total, 1);
    assert.equal(stackersRes.results.length, 1);
    assert.deepEqual(stackersRes.results[0], {
      amount_ustx: DELEGATE_HALF_AMOUNT.toString(),
      pox_addr: STACKER.btcTestnetAddr,
      stacker: STACKER.stxAddr,
      tx_id: delegateStxDbTx.tx_id,
      block_height: delegateStxDbTx.block_height,
    });
  });

  test('Perform delegate-stack-stx', async () => {
    poxInfo = await ctx.client.getPox();
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
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackStxTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackStxTx.serialize())
    );
    await standByForTxSuccess(delegateStackStxTxId, ctx);

    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(STACKER.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), DELEGATE_HALF_AMOUNT);
    assert.ok(coreBalanceInfo.unlock_height > 0);

    // validate delegate-stack-stx pox event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${delegateStackStxTxId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'delegate-stack-stx');
    assert.equal(res.results[0].pox_addr, STACKER.btcTestnetAddr);
    assert.equal(res.results[0].stacker, STACKER.stxAddr);
    assert.equal(res.results[0].balance, BigInt(coreBalanceInfo.balance).toString());
    assert.equal(res.results[0].locked, DELEGATE_HALF_AMOUNT.toString());
    assert.equal(res.results[0].burnchain_unlock_height, coreBalanceInfo.unlock_height.toString());
    assert.equal(res.results[0].data.lock_period, '3');
    assert.equal(res.results[0].data.lock_amount, DELEGATE_HALF_AMOUNT.toString());

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${STACKER.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(DELEGATE_HALF_AMOUNT));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });

  test('Perform revoke-delegate-stx', async () => {
    const revokeTx = await makeContractCall({
      senderKey: STACKER.secretKey,
      contractAddress,
      contractName,
      functionName: 'revoke-delegate-stx',
      functionArgs: [],
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const revokeTxResult = await ctx.client.sendTransaction(Buffer.from(revokeTx.serialize()));
    const revokeStackDbTx = await standByForTx(revokeTxResult.txId, ctx);

    assert.equal(revokeStackDbTx.status, DbTxStatus.Success);
    assert.deepEqual(
      Cl.deserialize(revokeStackDbTx.raw_result),
      Cl.ok(
        Cl.some(
          Cl.tuple({
            'amount-ustx': Cl.uint(DELEGATE_HALF_AMOUNT),
            'delegated-to': Cl.standardPrincipal(POOL.stxAddr),
            'pox-addr': Cl.some(poxAddressToTuple(STACKER.btcTestnetAddr)),
            'until-burn-ht': Cl.none(),
          })
        )
      )
    );

    // validate revoke-delegate-stx pox event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${revokeTxResult.txId}`, ctx);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'revoke-delegate-stx');
    assert.equal(res.results[0].stacker, STACKER.stxAddr);
    assert.equal(res.results[0].data.delegate_to, POOL.stxAddr);

    // revocation doesn't change anything for the previous delegate-stack-stx state
    const coreBalanceInfo = await ctx.client.getAccount(STACKER.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), DELEGATE_HALF_AMOUNT);
    assert.ok(coreBalanceInfo.unlock_height > 0);

    // validate pool delegation no longer exists
    const stackersRes: any = await fetchGet(`/extended/v1/pox4/${POOL.stxAddr}/delegations`, ctx);
    assert.ok(stackersRes);
    assert.equal(stackersRes.total, 0);
    assert.equal(stackersRes.results.length, 0);
  });

  test('Try to perform delegate-stack-stx - while revoked', async () => {
    await standByForPoxCycle(ctx);
    poxInfo = await ctx.client.getPox();
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
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const delegateStackTxResult = await ctx.client.sendTransaction(
      Buffer.from(delegateStackTx.serialize())
    );
    const delegateStackDbTx = await standByForTx(delegateStackTxResult.txId, ctx);
    assert.notEqual(delegateStackDbTx.status, DbTxStatus.Success);
    const delegateStackResult = codec.decodeClarityValue(delegateStackDbTx.raw_result);
    assert.equal(delegateStackResult.repr, '(err 9)'); // ERR_STACKING_PERMISSION_DENIED
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
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackIncreaseTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackIncreaseTx.serialize())
    );
    const delegateStackIncreaseTxResult = await standByForTx(delegateStackIncreaseTxId, ctx);
    const delegateStackIncreaseResult = codec.decodeClarityValue(
      delegateStackIncreaseTxResult.raw_result
    );
    assert.equal(delegateStackIncreaseResult.repr, '(err 9)'); // ERR_STACKING_PERMISSION_DENIED
    assert.notEqual(delegateStackIncreaseTxResult.status, DbTxStatus.Success);
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
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackextendTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackextendTx.serialize())
    );
    const delegateStackextendTxResult = await standByForTx(delegateStackextendTxId, ctx);
    const delegateStackextendResult = codec.decodeClarityValue(
      delegateStackextendTxResult.raw_result
    );
    assert.equal(delegateStackextendResult.repr, '(err 9)'); // ERR_STACKING_PERMISSION_DENIED
    assert.notEqual(delegateStackextendTxResult.status, DbTxStatus.Success);
  });

  test('Try to perform delegate-stack-stx - without delegation', async () => {
    poxInfo = await ctx.client.getPox();
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
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: delegateStackStxTxId } = await ctx.client.sendTransaction(
      Buffer.from(delegateStackStxTx.serialize())
    );
    const delegateStackStxTxResult = await standByForTx(delegateStackStxTxId, ctx);
    assert.notEqual(delegateStackStxTxResult.status, DbTxStatus.Success);
    const delegateStackStxResult = codec.decodeClarityValue(delegateStackStxTxResult.raw_result);
    assert.equal(delegateStackStxResult.repr, '(err 9)'); // ERR_STACKING_PERMISSION_DENIED
  });

  test('Perform stack-aggregation-commit - delegator commit to stacking operation', async () => {
    poxInfo = await ctx.client.getPox();
    const rewardCycle = BigInt(poxInfo.next_cycle.id);
    const signerSig = hexToBytes(
      stackingClient.signPoxSignature({
        topic: 'agg-commit',
        poxAddress: STACKER.btcAddr,
        rewardCycle: Number(rewardCycle),
        period: 1,
        signerPrivateKey: signerPrivKey,
        maxAmount: DELEGATE_HALF_AMOUNT,
        authId: 0,
      })
    );
    const stackAggrCommitTx = await makeContractCall({
      senderKey: POOL.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-commit',
      functionArgs: [
        STACKER.poxAddrClar, // pox-addr
        uintCV(rewardCycle), // reward-cycle
        someCV(bufferCV(signerSig)), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(DELEGATE_HALF_AMOUNT.toString()), // max-amount
        uintCV(0), // auth-id
      ],
      network: ctx.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: 10000n,
    });
    const { txId: stackAggrCommitTxId } = await ctx.client.sendTransaction(
      Buffer.from(stackAggrCommitTx.serialize())
    );
    await standByForTxSuccess(stackAggrCommitTxId, ctx);

    // validate stack-aggregation-commit pox event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${stackAggrCommitTxId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'stack-aggregation-commit');
    assert.equal(res.results[0].pox_addr, STACKER.btcTestnetAddr);
    assert.equal(res.results[0].stacker, POOL.stxAddr);
  });

  test('Wait for stack lock to reach unlock block', async () => {
    const coreBalanceInfo = await ctx.client.getAccount(STACKER.stxAddr);
    assert.ok(coreBalanceInfo.unlock_height > 0);
    await standByUntilBurnBlock(coreBalanceInfo.unlock_height + 1, ctx);
  });

  test('Validate account balances are unlocked', async () => {
    // validate stacks-node balance
    const coreBalanceInfo = await ctx.client.getAccount(STACKER.stxAddr);
    assert.equal(BigInt(coreBalanceInfo.locked), 0n);
    assert.equal(coreBalanceInfo.unlock_height, 0);

    // validate API endpoint balance state for account
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${STACKER.stxAddr}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(BigInt(coreBalanceInfo.locked)));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalanceInfo.unlock_height);
  });
});
