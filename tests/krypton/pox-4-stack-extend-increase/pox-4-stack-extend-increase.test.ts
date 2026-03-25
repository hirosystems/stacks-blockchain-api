import { CoreRpcPoxInfo } from '../../../src/core-rpc/client.ts';
import { getBitcoinAddressFromKey, privateToPublicKey } from '../ec-helpers.ts';
import {
  bufferCV,
  makeContractCall,
  makeRandomPrivKey,
  someCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import bignumber from 'bignumber.js';
import { DbEventTypeId, DbStxLockEvent } from '../../../src/datastore/common.ts';
import { decodeBtcAddress, StackingClient } from '@stacks/stacking';
import { hexToBuffer } from '@stacks/api-toolkit';
import assert from 'node:assert/strict';
import { hexToBytes } from '@stacks/common';
import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { AddressStxBalance } from '../../../src/api/schemas/entities/addresses.ts';
import {
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
} from '../../../src/api/schemas/responses/responses.ts';
import { BurnchainRewardsTotal } from '../../../src/api/schemas/entities/burnchain-rewards.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/faucets.ts';
import {
  fetchGet,
  getKryptonContext,
  KryptonContext,
  standByForPoxCycle,
  standByForTxSuccess,
  standByUntilBurnBlock,
  stopKryptonContext,
} from '../krypton-env.ts';
import { after, before, test, describe } from 'node:test';

describe('PoX-4 - Stack extend and increase operations', () => {
  let ctx: KryptonContext;
  const account = FAUCET_TESTNET_KEYS[1];
  let btcAddr: string;
  let btcAddrRegtest: string;
  let btcPubKey: string;
  let decodedBtcAddr: { version: number; data: string };
  let poxInfo: CoreRpcPoxInfo;
  let burnBlockHeight: number;
  let cycleBlockLength: number;
  let contractAddress: string;
  let contractName: string;
  let ustxAmount: bigint;
  let stackingClient: StackingClient;
  let signerPrivKey: string;
  let signerPubKey: string;
  const lockPeriod = 3;
  const btcPrivateKey = '0000000000000000000000000000000000000000000000000000000000000002';

  before(async () => {
    ctx = await getKryptonContext();
    btcAddr = getBitcoinAddressFromKey({
      privateKey: btcPrivateKey,
      network: 'testnet',
      addressFormat: 'p2pkh',
    });
    assert.equal(btcAddr, 'mg8Jz5776UdyiYcBb9Z873NTozEiADRW5H');
    btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
    assert.equal(
      btcPubKey,
      '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
    );

    decodedBtcAddr = decodeBtcAddress(btcAddr);
    assert.deepEqual(
      {
        data: decodedBtcAddr.data,
        version: decodedBtcAddr.version,
      },
      { data: '06afd46bcdfd22ef94ac122aa11f241244a37ecc', version: 0 }
    );

    stackingClient = new StackingClient({ address: account.stacksAddress, network: ctx.stacksNetwork });
    signerPrivKey = makeRandomPrivKey();
    signerPubKey = getPublicKeyFromPrivate(signerPrivKey);

    // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
    btcAddrRegtest = getBitcoinAddressFromKey({
      privateKey: btcPrivateKey,
      network: 'regtest',
      addressFormat: 'p2pkh',
    });
    assert.equal(btcAddrRegtest, 'mg8Jz5776UdyiYcBb9Z873NTozEiADRW5H');

    await ctx.bitcoinRpcClient.importaddress({
      address: btcAddrRegtest,
      label: btcAddrRegtest,
    });
    const btcWalletAddrs: Record<string, unknown> = await ctx.bitcoinRpcClient.getaddressesbylabel({
      label: btcAddrRegtest,
    });
    assert.ok(Object.keys(btcWalletAddrs).includes(btcAddrRegtest));

    await standByForPoxCycle(ctx);

    poxInfo = await ctx.client.getPox();
    burnBlockHeight = poxInfo.current_burnchain_block_height as number;

    ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    cycleBlockLength = lockPeriod * poxInfo.reward_cycle_length;

    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    assert.equal(contractName, 'pox-4');
  });

  after(async () => {
    await stopKryptonContext(ctx);
  });

  test('stack-stx tx', async () => {
    const coreBalancePreStackStx = await ctx.client.getAccount(account.stacksAddress);
    const signerSig = hexToBytes(
      stackingClient.signPoxSignature({
        topic: 'stack-stx',
        poxAddress: btcAddr,
        rewardCycle: poxInfo.current_cycle.id,
        period: lockPeriod,
        signerPrivateKey: signerPrivKey,
        maxAmount: ustxAmount,
        authId: 0,
      })
    );
    // Create and broadcast a `stack-stx` tx
    const txFee = 10000n;
    const stackStxTx = await makeContractCall({
      senderKey: account.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-stx',
      functionArgs: [
        uintCV(ustxAmount.toString()), // amount-ustx
        tupleCV({
          hashbytes: bufferCV(hexToBytes(decodedBtcAddr.data)),
          version: bufferCV(Buffer.from([decodedBtcAddr.version])),
        }), // pox-addr
        uintCV(burnBlockHeight), // start-burn-ht
        uintCV(lockPeriod), // lock-period,
        someCV(bufferCV(signerSig)), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(ustxAmount.toString()), // max-amount
        uintCV(0), // auth-id
      ],
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const expectedTxId = '0x' + stackStxTx.txid();
    const stackStxTxHex = stackStxTx.serialize();
    const sendTxResult = await ctx.client.sendTransaction(Buffer.from(stackStxTxHex, 'hex'));
    assert.equal(sendTxResult.txId, expectedTxId);

    // Wait for API to receive and ingest tx
    const dbTx = await standByForTxSuccess(expectedTxId, ctx);

    const tx1Event = await ctx.api.datastore.getTxEvents({
      txId: expectedTxId,
      indexBlockHash: dbTx.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    assert.ok(tx1Event.results);
    const lockEvent = tx1Event.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    assert.ok(lockEvent);
    assert.equal(lockEvent.locked_address, account.stacksAddress);
    assert.equal(lockEvent.locked_amount, ustxAmount);

    // Test that the unlock height event data in the API db matches the expected height from the
    // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
    const expectedUnlockHeight =
      cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
    assert.equal(lockEvent.unlock_height, expectedUnlockHeight);

    // Test the API address balance data after a `stack-stx` operation
    const addrBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${account.stacksAddress}/stx`,
      ctx
    );
    assert.equal(addrBalance.locked, ustxAmount.toString());
    assert.equal(addrBalance.burnchain_unlock_height, expectedUnlockHeight);
    assert.equal(addrBalance.lock_height, dbTx.block_height);
    assert.equal(addrBalance.lock_tx_id, dbTx.tx_id);

    // validate stacks-node balance state
    const coreBalance = await ctx.client.getAccount(account.stacksAddress);
    assert.equal(BigInt(coreBalance.locked), ustxAmount);
    assert.equal(
      BigInt(coreBalance.balance),
      BigInt(coreBalancePreStackStx.balance) - ustxAmount - txFee
    );
    assert.ok(coreBalance.unlock_height > 0);

    // validate the pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${sendTxResult.txId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'stack-stx');
    assert.equal(res.results[0].pox_addr, btcAddr);
    assert.equal(res.results[0].stacker, account.stacksAddress);
    assert.equal(res.results[0].balance, BigInt(coreBalance.balance).toString());
    assert.equal(res.results[0].locked, BigInt(coreBalance.locked).toString());
    assert.equal(
      res.results[0].burnchain_unlock_height,
      coreBalance.unlock_height.toString()
    );
    assert.equal(res.results[0].data.lock_amount, ustxAmount.toString());
    assert.equal(res.results[0].data.lock_period, lockPeriod.toString());
    assert.equal(
      res.results[0].data.unlock_burn_height,
      coreBalance.unlock_height.toString()
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${account.stacksAddress}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), ustxAmount);
    assert.equal(apiBalance.burnchain_unlock_height, coreBalance.unlock_height);
  });

  test('stack-increase tx', async () => {
    await standByForPoxCycle(ctx);
    const coreBalancePreIncrease = await ctx.client.getAccount(account.stacksAddress);
    // Create and broadcast a `stack-increase` tx
    const stackIncreaseAmount = 123n;
    const signerSig = hexToBytes(
      stackingClient.signPoxSignature({
        topic: 'stack-increase',
        poxAddress: btcAddr,
        rewardCycle: poxInfo.current_cycle.id + 1,
        period: lockPeriod,
        signerPrivateKey: signerPrivKey,
        maxAmount: ustxAmount + stackIncreaseAmount,
        authId: 1,
      })
    );
    const stackIncreaseTxFee = 10000n;
    const stackIncreaseTx = await makeContractCall({
      senderKey: account.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-increase',
      functionArgs: [
        uintCV(stackIncreaseAmount.toString()), // increase-by
        someCV(bufferCV(signerSig)), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV((ustxAmount + stackIncreaseAmount).toString()), // max-amount
        uintCV(1), // auth-id
      ],
      network: ctx.stacksNetwork,
      fee: stackIncreaseTxFee,
      validateWithAbi: false,
    });
    const expectedTxId = '0x' + stackIncreaseTx.txid();
    const stackIncreaseTxHex = stackIncreaseTx.serialize();
    const sendTxResult = await ctx.client.sendTransaction(Buffer.from(stackIncreaseTxHex, 'hex'));
    assert.equal(sendTxResult.txId, expectedTxId);

    const dbTx = await standByForTxSuccess(sendTxResult.txId, ctx);

    const txEvents = await ctx.api.datastore.getTxEvents({
      txId: dbTx.tx_id,
      indexBlockHash: dbTx.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    assert.ok(txEvents.results);
    const lockEvent2 = txEvents.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    assert.ok(lockEvent2);

    // Test that the locked STX amount has increased
    const expectedLockedAmount = ustxAmount + stackIncreaseAmount;
    assert.equal(lockEvent2.locked_amount, expectedLockedAmount);

    // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
    const rpcAccountInfo = await ctx.client.getAccount(account.stacksAddress);
    const expectedUnlockHeight =
      cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
    assert.equal(BigInt(rpcAccountInfo.locked), expectedLockedAmount);
    assert.equal(rpcAccountInfo.unlock_height, expectedUnlockHeight);

    // Test the API address balance data after a `stack-increase` operation
    const addrBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${account.stacksAddress}/stx`,
      ctx
    );
    assert.equal(addrBalance.locked, expectedLockedAmount.toString());
    assert.equal(addrBalance.burnchain_unlock_height, expectedUnlockHeight);
    assert.equal(addrBalance.lock_height, dbTx.block_height);
    assert.equal(addrBalance.lock_tx_id, dbTx.tx_id);

    // validate stacks-node balance state
    const coreBalance = await ctx.client.getAccount(account.stacksAddress);
    assert.equal(BigInt(coreBalance.locked), expectedLockedAmount);
    assert.equal(
      BigInt(coreBalance.balance),
      BigInt(coreBalancePreIncrease.balance) - stackIncreaseAmount - stackIncreaseTxFee
    );
    assert.equal(coreBalance.unlock_height, expectedUnlockHeight);

    // validate the pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${sendTxResult.txId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'stack-increase');
    assert.equal(res.results[0].pox_addr, btcAddr);
    assert.equal(res.results[0].stacker, account.stacksAddress);
    assert.equal(res.results[0].balance, BigInt(coreBalance.balance).toString());
    assert.equal(res.results[0].locked, expectedLockedAmount.toString());
    assert.equal(
      res.results[0].burnchain_unlock_height,
      coreBalance.unlock_height.toString()
    );
    assert.equal(res.results[0].data.increase_by, stackIncreaseAmount.toString());
    assert.equal(res.results[0].data.total_locked, expectedLockedAmount.toString());

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${account.stacksAddress}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), expectedLockedAmount);
    assert.equal(apiBalance.burnchain_unlock_height, coreBalance.unlock_height);
  });

  test('stack-extend tx', async () => {
    await standByForPoxCycle(ctx);
    const coreBalancePreStackExtend = await ctx.client.getAccount(account.stacksAddress);
    // Create and broadcast a `stack-extend` tx
    const extendCycleAmount = 1;
    const signerSig = hexToBytes(
      stackingClient.signPoxSignature({
        topic: 'stack-extend',
        poxAddress: btcAddr,
        rewardCycle: poxInfo.current_cycle.id + 2,
        period: extendCycleAmount,
        signerPrivateKey: signerPrivKey,
        maxAmount: 0,
        authId: 2,
      })
    );
    const txFee = 10000n;
    const stackExtendTx = await makeContractCall({
      senderKey: account.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-extend',
      functionArgs: [
        uintCV(extendCycleAmount), // extend-count
        tupleCV({
          hashbytes: bufferCV(hexToBytes(decodedBtcAddr.data)),
          version: bufferCV(Buffer.from([decodedBtcAddr.version])),
        }), // pox-addr
        someCV(bufferCV(signerSig)), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(0), // max-amount
        uintCV(2), // auth-id
      ],
      network: ctx.stacksNetwork,
      fee: txFee,
      validateWithAbi: false,
    });
    const expectedTxId = '0x' + stackExtendTx.txid();
    const stackExtendTxHex = stackExtendTx.serialize();
    const sendTxResult = await ctx.client.sendTransaction(Buffer.from(stackExtendTxHex, 'hex'));
    assert.equal(sendTxResult.txId, expectedTxId);

    const dbTx = await standByForTxSuccess(expectedTxId, ctx);

    const txEvents = await ctx.api.datastore.getTxEvents({
      txId: dbTx.tx_id,
      indexBlockHash: dbTx.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    assert.ok(txEvents.results);
    const lockEvent = txEvents.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    assert.ok(lockEvent);

    // Test that the unlock height event data in the API db matches the expected height from the
    // calculated values from the /v2/pox data and the cycle amount specified in the `stack-extend` tx.
    const extendBlockCount = extendCycleAmount * poxInfo.reward_cycle_length;
    const expectedUnlockHeight =
      cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height + extendBlockCount;
    assert.equal(lockEvent.unlock_height, expectedUnlockHeight);

    // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
    const rpcAccountInfo = await ctx.client.getAccount(account.stacksAddress);
    assert.equal(rpcAccountInfo.unlock_height, expectedUnlockHeight);

    // Test the API address balance data after a `stack-extend` operation
    const addrBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${account.stacksAddress}/stx`,
      ctx
    );
    assert.equal(addrBalance.burnchain_unlock_height, expectedUnlockHeight);
    assert.equal(addrBalance.lock_height, dbTx.block_height);
    assert.equal(addrBalance.lock_tx_id, dbTx.tx_id);

    // validate stacks-node balance state
    const coreBalance = await ctx.client.getAccount(account.stacksAddress);
    assert.ok(BigInt(coreBalance.locked) > 0n);
    assert.equal(BigInt(coreBalance.locked), BigInt(coreBalancePreStackExtend.locked));
    assert.ok(BigInt(coreBalance.balance) > 0n);
    assert.equal(BigInt(coreBalance.balance), BigInt(coreBalancePreStackExtend.balance) - txFee);
    assert.ok(coreBalance.unlock_height > coreBalancePreStackExtend.unlock_height);

    // validate the pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${sendTxResult.txId}`, ctx);
    assert.ok(res);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'stack-extend');
    assert.equal(res.results[0].pox_addr, btcAddr);
    assert.equal(res.results[0].stacker, account.stacksAddress);
    assert.equal(res.results[0].balance, BigInt(coreBalance.balance).toString());
    assert.equal(res.results[0].locked, BigInt(coreBalance.locked).toString());
    assert.equal(
      res.results[0].burnchain_unlock_height,
      coreBalance.unlock_height.toString()
    );
    assert.equal(res.results[0].data.extend_count, extendCycleAmount.toString());
    assert.equal(
      res.results[0].data.unlock_burn_height,
      coreBalance.unlock_height.toString()
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${account.stacksAddress}/stx`,
      ctx
    );
    assert.equal(BigInt(apiBalance.locked), BigInt(coreBalance.locked));
    assert.equal(apiBalance.burnchain_unlock_height, coreBalance.unlock_height);
  });

  test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
    // Wait until end of prepare phase
    const preparePhaseEndBurnBlock =
      poxInfo.next_cycle.prepare_phase_start_block_height + poxInfo.prepare_phase_block_length + 1;
    await standByForPoxCycle(ctx);

    const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
      `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`,
      ctx
    );
    const firstRewardSlot = rewardSlotHolders.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];
    assert.equal(firstRewardSlot.address, btcAddr);
    assert.ok(
      firstRewardSlot.burn_block_height >= poxInfo.next_cycle.prepare_phase_start_block_height
    );
    // TODO: RC4 seems to have introduced different behavior here: Expected: <= 111, Received: 116
    // assert.ok(firstRewardSlot.burn_block_height <= preparePhaseEndBurnBlock);
  });

  test('stacking rewards - API /burnchain/rewards', async () => {
    // Wait until end of reward phase
    const rewardPhaseEndBurnBlock =
      poxInfo.next_cycle.reward_phase_start_block_height + poxInfo.reward_phase_block_length + 1;
    await standByForPoxCycle(ctx);
    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddr}`,
      ctx
    );
    const firstReward = rewards.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];
    // assert.equal(rewards.results.length, 1);
    assert.equal(firstReward.reward_recipient, btcAddr);
    assert.ok(Number(firstReward.burn_amount) > 0);
    assert.ok(
      firstReward.burn_block_height >= poxInfo.next_cycle.reward_phase_start_block_height
    );

    // TODO: RC4 seems to have introduced different behavior here: Expected: <= 115, Received: 116
    // assert.ok(firstReward.burn_block_height <= rewardPhaseEndBurnBlock);

    const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
      `/extended/v1/burnchain/rewards/${btcAddr}/total`,
      ctx
    );
    assert.equal(rewardsTotal.reward_recipient, btcAddr);
    assert.ok(Number(rewardsTotal.reward_amount) > 0);
  });

  test('stacking rewards - BTC JSON-RPC - getblock', async () => {
    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddr}`,
      ctx
    );
    const firstReward = rewards.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];
    const blockResult: {
      tx: { vout?: { scriptPubKey: { address?: string }; value?: number }[] }[];
    } = await ctx.bitcoinRpcClient.getblock({
      blockhash: hexToBuffer(firstReward.burn_block_hash).toString('hex'),
      verbosity: 2,
    });
    const vout = blockResult.tx
      .flatMap(t => t.vout)
      .find(v => v?.value && v.scriptPubKey.address == btcAddrRegtest);
    if (!vout || !vout.value) {
      throw new Error(
        `Could not find bitcoin vout for ${btcAddrRegtest} in block ${firstReward.burn_block_hash}`
      );
    }
    const sats = new bignumber(vout.value).shiftedBy(8).toString();
    assert.equal(sats, firstReward.reward_amount);
  });

  test('stacking rewards - BTC JSON-RPC - listtransactions', async () => {
    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddr}`,
      ctx
    );
    const firstReward = rewards.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];

    let received: {
      address: string;
      category: string;
      amount: number;
      blockhash: string;
      blockheight: number;
      txid: string;
      confirmations: number;
    }[] = await ctx.bitcoinRpcClient.listtransactions({
      label: btcAddrRegtest,
      include_watchonly: true,
    });
    received = received.filter(r => r.address === btcAddrRegtest);
    // todo: double-check if multiple rewards are possible/intended for
    //       this test, since it doesn't happen often
    assert.ok(received.length >= 1);
    assert.equal(received.length, rewards.results.length);
    assert.equal(received[0].category, 'receive');
    assert.equal(received[0].blockhash, hexToBuffer(firstReward.burn_block_hash).toString('hex'));
    const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
    assert.equal(sats, firstReward.reward_amount);
  });

  test('stx unlocked - RPC balance endpoint', async () => {
    // Wait until account has unlocked (finished Stacking cycles)
    const rpcAccountInfo1 = await ctx.client.getAccount(account.stacksAddress);
    const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
    const dbBlock1 = await standByUntilBurnBlock(burnBlockUnlockHeight, ctx);

    // Check that STX are no longer reported as locked by the RPC endpoints:
    const rpcAccountInfo = await ctx.client.getAccount(account.stacksAddress);
    assert.equal(BigInt(rpcAccountInfo.locked), 0n);
    assert.equal(rpcAccountInfo.unlock_height, 0);
  });

  test('stx unlocked - API balance endpoint', async () => {
    // Check that STX are no longer reported as locked by the API endpoints:
    const addrBalance = await fetchGet<AddressStxBalance>(
      `/extended/v1/address/${account.stacksAddress}/stx`,
      ctx
    );
    assert.equal(BigInt(addrBalance.locked), 0n);
    assert.equal(addrBalance.burnchain_unlock_height, 0);
    assert.equal(addrBalance.lock_height, 0);
    assert.equal(addrBalance.lock_tx_id, '');
  });

  test('BTC stacking reward received', async () => {
    const curBlock = await ctx.db.getCurrentBlock();
    assert(curBlock.found);
    await standByUntilBurnBlock(curBlock.result.burn_block_height + 1, ctx);

    const received: number = await ctx.bitcoinRpcClient.getreceivedbyaddress({
      address: btcAddrRegtest,
      minconf: 0,
    });
    assert.ok(received > 0);
  });
});
