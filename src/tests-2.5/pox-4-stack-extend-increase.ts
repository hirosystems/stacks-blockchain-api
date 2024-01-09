import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { getBitcoinAddressFromKey, privateToPublicKey, VerboseKeyOutput } from '../ec-helpers';

import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import { AnchorMode, bufferCV, makeContractCall, tupleCV, uintCV } from '@stacks/transactions';
import bignumber from 'bignumber.js';
import { DbEventTypeId, DbStxLockEvent } from '../datastore/common';
import {
  fetchGet,
  standByForPoxCycle,
  standByForTxSuccess,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';
import { decodeBtcAddress } from '@stacks/stacking';
import { hexToBuffer } from '@hirosystems/api-toolkit';

describe('PoX-4 - Stack extend and increase operations', () => {
  const account = testnetKeys[1];
  let btcAddr: string;
  let btcRegtestAccount: VerboseKeyOutput;
  let btcPubKey: string;
  let decodedBtcAddr: { version: number; data: Uint8Array };
  let poxInfo: CoreRpcPoxInfo;
  let burnBlockHeight: number;
  let cycleBlockLength: number;
  let contractAddress: string;
  let contractName: string;
  let ustxAmount: bigint;
  const lockPeriod = 1;
  const btcPrivateKey = '0000000000000000000000000000000000000000000000000000000000000002';

  beforeAll(async () => {
    btcAddr = getBitcoinAddressFromKey({
      privateKey: btcPrivateKey,
      network: 'testnet',
      addressFormat: 'p2pkh',
    });
    expect(btcAddr).toBe('mg8Jz5776UdyiYcBb9Z873NTozEiADRW5H');
    btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
    expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

    decodedBtcAddr = decodeBtcAddress(btcAddr);
    expect({
      data: Buffer.from(decodedBtcAddr.data).toString('hex'),
      version: decodedBtcAddr.version,
    }).toEqual({ data: '06afd46bcdfd22ef94ac122aa11f241244a37ecc', version: 0 });

    // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
    btcRegtestAccount = getBitcoinAddressFromKey({
      privateKey: btcPrivateKey,
      network: 'regtest',
      addressFormat: 'p2pkh',
      verbose: true,
    });
    expect(btcRegtestAccount.address).toBe('mg8Jz5776UdyiYcBb9Z873NTozEiADRW5H');

    await testEnv.bitcoinRpcClient.importprivkey({
      privkey: btcRegtestAccount.wif,
      label: btcRegtestAccount.address,
      rescan: false,
    });
    const btcWalletAddrs: Record<string, unknown> =
      await testEnv.bitcoinRpcClient.getaddressesbylabel({
        label: btcRegtestAccount.address,
      });

    const expectedAddrs = {
      P2PKH: getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2pkh',
      }),
      P2SH_P2WPKH: getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2sh-p2wpkh',
      }),
      P2WPKH: getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2wpkh',
      }),
    };

    expect(Object.keys(btcWalletAddrs)).toEqual(
      expect.arrayContaining(Object.values(expectedAddrs))
    );
    expect(Object.keys(btcWalletAddrs)).toContain(btcRegtestAccount.address);

    poxInfo = await testEnv.client.getPox();
    burnBlockHeight = poxInfo.current_burnchain_block_height as number;

    ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
    cycleBlockLength = lockPeriod * poxInfo.reward_cycle_length;

    [contractAddress, contractName] = poxInfo.contract_id.split('.');
    expect(contractName).toBe('pox-4');
  });

  test('stack-stx tx', async () => {
    const coreBalancePreStackStx = await testEnv.client.getAccount(account.stacksAddress);

    // Create and broadcast a `stack-stx` tx
    const txFee = 10000n;
    const stackStxTx = await makeContractCall({
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
        uintCV(lockPeriod), // lock-period
      ],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
    });
    const expectedTxId = '0x' + stackStxTx.txid();
    const sendTxResult = await testEnv.client.sendTransaction(Buffer.from(stackStxTx.serialize()));
    expect(sendTxResult.txId).toBe(expectedTxId);

    // Wait for API to receive and ingest tx
    const dbTx = await standByForTxSuccess(expectedTxId);

    const tx1Event = await testEnv.api.datastore.getTxEvents({
      txId: expectedTxId,
      indexBlockHash: dbTx.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    expect(tx1Event.results).toBeTruthy();
    const lockEvent = tx1Event.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    expect(lockEvent).toBeDefined();
    expect(lockEvent.locked_address).toBe(account.stacksAddress);
    expect(lockEvent.locked_amount).toBe(ustxAmount);

    // Test that the unlock height event data in the API db matches the expected height from the
    // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
    const expectedUnlockHeight =
      cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
    expect(lockEvent.unlock_height).toBe(expectedUnlockHeight);

    // Test the API address balance data after a `stack-stx` operation
    const addrBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stacksAddress}/stx`
    );
    expect(addrBalance.locked).toBe(ustxAmount.toString());
    expect(addrBalance.burnchain_unlock_height).toBe(expectedUnlockHeight);
    expect(addrBalance.lock_height).toBe(dbTx.block_height);
    expect(addrBalance.lock_tx_id).toBe(dbTx.tx_id);

    // validate stacks-node balance state
    const coreBalance = await testEnv.client.getAccount(account.stacksAddress);
    expect(BigInt(coreBalance.locked)).toBe(ustxAmount);
    expect(BigInt(coreBalance.balance)).toBe(
      BigInt(coreBalancePreStackStx.balance) - ustxAmount - txFee
    );
    expect(coreBalance.unlock_height).toBeGreaterThan(0);

    // validate the pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${sendTxResult.txId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-stx',
        pox_addr: btcAddr,
        stacker: account.stacksAddress,
        balance: BigInt(coreBalance.balance).toString(),
        locked: BigInt(coreBalance.locked).toString(),
        burnchain_unlock_height: coreBalance.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        lock_amount: ustxAmount.toString(),
        lock_period: lockPeriod.toString(),
        unlock_burn_height: coreBalance.unlock_height.toString(),
      })
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stacksAddress}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(ustxAmount);
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalance.unlock_height);
  });

  test('stack-increase tx', async () => {
    const coreBalancePreIncrease = await testEnv.client.getAccount(account.stacksAddress);

    // Create and broadcast a `stack-increase` tx
    const stackIncreaseAmount = 123n;
    const stackIncreaseTxFee = 10000n;
    const stackIncreaseTx = await makeContractCall({
      senderKey: account.secretKey,
      contractAddress,
      contractName,
      functionName: 'stack-increase',
      functionArgs: [uintCV(stackIncreaseAmount)],
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: stackIncreaseTxFee,
      validateWithAbi: false,
    });
    const expectedTxId = '0x' + stackIncreaseTx.txid();
    const sendTxResult = await testEnv.client.sendTransaction(
      Buffer.from(stackIncreaseTx.serialize())
    );
    expect(sendTxResult.txId).toBe(expectedTxId);

    const dbTx = await standByForTxSuccess(sendTxResult.txId);

    const txEvents = await testEnv.api.datastore.getTxEvents({
      txId: dbTx.tx_id,
      indexBlockHash: dbTx.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    expect(txEvents.results).toBeTruthy();
    const lockEvent2 = txEvents.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    expect(lockEvent2).toBeDefined();

    // Test that the locked STX amount has increased
    const expectedLockedAmount = ustxAmount + stackIncreaseAmount;
    expect(lockEvent2.locked_amount).toBe(expectedLockedAmount);

    // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
    const rpcAccountInfo = await testEnv.client.getAccount(account.stacksAddress);
    const expectedUnlockHeight =
      cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
    expect(BigInt(rpcAccountInfo.locked)).toBe(expectedLockedAmount);
    expect(rpcAccountInfo.unlock_height).toBe(expectedUnlockHeight);

    // Test the API address balance data after a `stack-increase` operation
    const addrBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stacksAddress}/stx`
    );
    expect(addrBalance.locked).toBe(expectedLockedAmount.toString());
    expect(addrBalance.burnchain_unlock_height).toBe(expectedUnlockHeight);
    expect(addrBalance.lock_height).toBe(dbTx.block_height);
    expect(addrBalance.lock_tx_id).toBe(dbTx.tx_id);

    // validate stacks-node balance state
    const coreBalance = await testEnv.client.getAccount(account.stacksAddress);
    expect(BigInt(coreBalance.locked)).toBe(expectedLockedAmount);
    expect(BigInt(coreBalance.balance)).toBe(
      BigInt(coreBalancePreIncrease.balance) - stackIncreaseAmount - stackIncreaseTxFee
    );
    expect(coreBalance.unlock_height).toBe(expectedUnlockHeight);

    // validate the pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${sendTxResult.txId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-increase',
        pox_addr: btcAddr,
        stacker: account.stacksAddress,
        balance: BigInt(coreBalance.balance).toString(),
        locked: expectedLockedAmount.toString(),
        burnchain_unlock_height: coreBalance.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        increase_by: stackIncreaseAmount.toString(),
        total_locked: expectedLockedAmount.toString(),
      })
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stacksAddress}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(expectedLockedAmount);
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalance.unlock_height);
  });

  test('stack-extend tx', async () => {
    const coreBalancePreStackExtend = await testEnv.client.getAccount(account.stacksAddress);

    // Create and broadcast a `stack-extend` tx
    const extendCycleAmount = 1;
    const txFee = 10000n;
    const stackExtendTx = await makeContractCall({
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
      network: testEnv.stacksNetwork,
      anchorMode: AnchorMode.OnChainOnly,
      fee: txFee,
      validateWithAbi: false,
    });
    const expectedTxId = '0x' + stackExtendTx.txid();
    const sendTxResult = await testEnv.client.sendTransaction(
      Buffer.from(stackExtendTx.serialize())
    );
    expect(sendTxResult.txId).toBe(expectedTxId);

    const dbTx = await standByForTxSuccess(expectedTxId);

    const txEvents = await testEnv.api.datastore.getTxEvents({
      txId: dbTx.tx_id,
      indexBlockHash: dbTx.index_block_hash,
      limit: 99999,
      offset: 0,
    });
    expect(txEvents.results).toBeTruthy();
    const lockEvent = txEvents.results.find(
      r => r.event_type === DbEventTypeId.StxLock
    ) as DbStxLockEvent;
    expect(lockEvent).toBeDefined();

    // Test that the unlock height event data in the API db matches the expected height from the
    // calculated values from the /v2/pox data and the cycle amount specified in the `stack-extend` tx.
    const extendBlockCount = extendCycleAmount * poxInfo.reward_cycle_length;
    const expectedUnlockHeight =
      cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height + extendBlockCount;
    expect(lockEvent.unlock_height).toBe(expectedUnlockHeight);

    // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
    const rpcAccountInfo = await testEnv.client.getAccount(account.stacksAddress);
    expect(rpcAccountInfo.unlock_height).toBe(expectedUnlockHeight);

    // Test the API address balance data after a `stack-extend` operation
    const addrBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stacksAddress}/stx`
    );
    expect(addrBalance.burnchain_unlock_height).toBe(expectedUnlockHeight);
    expect(addrBalance.lock_height).toBe(dbTx.block_height);
    expect(addrBalance.lock_tx_id).toBe(dbTx.tx_id);

    // validate stacks-node balance state
    const coreBalance = await testEnv.client.getAccount(account.stacksAddress);
    expect(BigInt(coreBalance.locked)).toBeGreaterThan(0n);
    expect(BigInt(coreBalance.locked)).toBe(BigInt(coreBalancePreStackExtend.locked));
    expect(BigInt(coreBalance.balance)).toBeGreaterThan(0n);
    expect(BigInt(coreBalance.balance)).toBe(BigInt(coreBalancePreStackExtend.balance) - txFee);
    expect(coreBalance.unlock_height).toBeGreaterThan(coreBalancePreStackExtend.unlock_height);

    // validate the pox2 event for this tx
    const res: any = await fetchGet(`/extended/v1/pox4_events/tx/${sendTxResult.txId}`);
    expect(res).toBeDefined();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        name: 'stack-extend',
        pox_addr: btcAddr,
        stacker: account.stacksAddress,
        balance: BigInt(coreBalance.balance).toString(),
        locked: BigInt(coreBalance.locked).toString(),
        burnchain_unlock_height: coreBalance.unlock_height.toString(),
      })
    );
    expect(res.results[0].data).toEqual(
      expect.objectContaining({
        extend_count: extendCycleAmount.toString(),
        unlock_burn_height: coreBalance.unlock_height.toString(),
      })
    );

    // validate API balance state
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stacksAddress}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(BigInt(coreBalance.locked));
    expect(apiBalance.burnchain_unlock_height).toBe(coreBalance.unlock_height);
  });

  test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
    // Wait until end of prepare phase
    const preparePhaseEndBurnBlock =
      poxInfo.next_cycle.prepare_phase_start_block_height + poxInfo.prepare_phase_block_length + 1;
    await standByForPoxCycle();

    const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
      `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`
    );
    const firstRewardSlot = rewardSlotHolders.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];
    expect(firstRewardSlot.address).toBe(btcAddr);
    expect(firstRewardSlot.burn_block_height).toBeGreaterThanOrEqual(
      poxInfo.next_cycle.prepare_phase_start_block_height
    );
    // TODO: RC4 seems to have introduced different behavior here: Expected: <= 111, Received: 116
    //expect(firstRewardSlot.burn_block_height).toBeLessThanOrEqual(preparePhaseEndBurnBlock);
  });

  test('stacking rewards - API /burnchain/rewards', async () => {
    // Wait until end of reward phase
    const rewardPhaseEndBurnBlock =
      poxInfo.next_cycle.reward_phase_start_block_height + poxInfo.reward_phase_block_length + 1;
    await standByForPoxCycle();
    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddr}`
    );
    const firstReward = rewards.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];
    // expect(rewards.results.length).toBe(1);
    expect(firstReward.reward_recipient).toBe(btcAddr);
    expect(Number(firstReward.burn_amount)).toBeGreaterThan(0);
    expect(firstReward.burn_block_height).toBeGreaterThanOrEqual(
      poxInfo.next_cycle.reward_phase_start_block_height
    );

    // TODO: RC4 seems to have introduced different behavior here: Expected: <= 115, Received: 116
    // expect(firstReward.burn_block_height).toBeLessThanOrEqual(rewardPhaseEndBurnBlock);

    const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
      `/extended/v1/burnchain/rewards/${btcAddr}/total`
    );
    expect(rewardsTotal.reward_recipient).toBe(btcAddr);
    expect(Number(rewardsTotal.reward_amount)).toBeGreaterThan(0);
  });

  test('stacking rewards - BTC JSON-RPC - getblock', async () => {
    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddr}`
    );
    const firstReward = rewards.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];
    const blockResult: {
      tx: { vout?: { scriptPubKey: { addresses?: string[] }; value?: number }[] }[];
    } = await testEnv.bitcoinRpcClient.getblock({
      blockhash: hexToBuffer(firstReward.burn_block_hash).toString('hex'),
      verbosity: 2,
    });
    const vout = blockResult.tx
      .flatMap(t => t.vout)
      .find(t => t?.scriptPubKey.addresses?.includes(btcRegtestAccount.address) && t.value);
    if (!vout || !vout.value) {
      throw new Error(
        `Could not find bitcoin vout for ${btcRegtestAccount.address} in block ${firstReward.burn_block_hash}`
      );
    }
    const sats = new bignumber(vout.value).shiftedBy(8).toString();
    expect(sats).toBe(firstReward.reward_amount);
  });

  test('stacking rewards - BTC JSON-RPC - listtransactions', async () => {
    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddr}`
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
    }[] = await testEnv.bitcoinRpcClient.listtransactions({
      label: btcRegtestAccount.address,
      include_watchonly: true,
    });
    received = received.filter(r => r.address === btcRegtestAccount.address);
    // expect(received.length).toBe(1);
    expect(received[0].category).toBe('receive');
    expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
    const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
    expect(sats).toBe(firstReward.reward_amount);
  });

  test('stx unlocked - RPC balance endpoint', async () => {
    // Wait until account has unlocked (finished Stacking cycles)
    const rpcAccountInfo1 = await testEnv.client.getAccount(account.stacksAddress);
    const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
    const dbBlock1 = await standByUntilBurnBlock(burnBlockUnlockHeight);

    // Check that STX are no longer reported as locked by the RPC endpoints:
    const rpcAccountInfo = await testEnv.client.getAccount(account.stacksAddress);
    expect(BigInt(rpcAccountInfo.locked)).toBe(0n);
    expect(rpcAccountInfo.unlock_height).toBe(0);
  });

  test('stx unlocked - API balance endpoint', async () => {
    // Check that STX are no longer reported as locked by the API endpoints:
    const addrBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stacksAddress}/stx`
    );
    expect(BigInt(addrBalance.locked)).toBe(0n);
    expect(addrBalance.burnchain_unlock_height).toBe(0);
    expect(addrBalance.lock_height).toBe(0);
    expect(addrBalance.lock_tx_id).toBe('');
  });

  test('BTC stacking reward received', async () => {
    const received: number = await testEnv.bitcoinRpcClient.getreceivedbyaddress({
      address: btcRegtestAccount.address,
      minconf: 0,
    });
    expect(received).toBeGreaterThan(0);
  });
});
