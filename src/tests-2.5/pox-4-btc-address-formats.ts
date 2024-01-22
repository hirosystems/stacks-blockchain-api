/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { hexToBuffer } from '@hirosystems/api-toolkit';
import { hexToBytes } from '@stacks/common';
import { decodeBtcAddress } from '@stacks/stacking';
import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import { AnchorMode, bufferCV, makeContractCall, tupleCV, uintCV } from '@stacks/transactions';
import bignumber from 'bignumber.js';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbEventTypeId, DbStxLockEvent } from '../datastore/common';
import { VerboseKeyOutput, getBitcoinAddressFromKey, privateToPublicKey } from '../ec-helpers';
import {
  fetchGet,
  standByForNextPoxCycle,
  standByForTxSuccess,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';

describe('PoX-4 - Stack using supported bitcoin address formats', () => {
  let poxInfo: CoreRpcPoxInfo;
  let burnBlockHeight: number;
  let cycleBlockLength: number;
  let contractAddress: string;
  let contractName: string;
  let ustxAmount: bigint;
  const cycleCount = 1;
  const btcPrivateKey = '0000000000000000000000000000000000000000000000000000000000000002';

  describe('PoX-4 - Stacking operations P2SH-P2WPKH', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcAddrDecoded: { version: number; data: Uint8Array };
    let btcAddrRegtest: VerboseKeyOutput;
    let btcPubKey: string;

    test('P2SH-P2WPKH setup', async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2sh-p2wpkh',
      });
      expect(btcAddr).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      btcAddrDecoded = decodeBtcAddress(btcAddr);
      expect({
        data: Buffer.from(btcAddrDecoded.data).toString('hex'),
        version: btcAddrDecoded.version,
      }).toEqual({ data: '978a0121f9a24de65a13bab0c43c3a48be074eae', version: 1 });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcAddrRegtest = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2sh-p2wpkh',
        verbose: true,
      });
      expect(btcAddrRegtest.address).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');

      await testEnv.bitcoinRpcClient.importaddress({
        address: btcAddrRegtest.address,
        label: btcAddrRegtest.address,
      });
      // await testEnv.bitcoinRpcClient.importprivkey({
      //   privkey: btcAddrRegtest.wif,
      //   label: btcAddrRegtest.address,
      //   rescan: false,
      // });
      const btcWalletAddrs = await testEnv.bitcoinRpcClient.getaddressesbylabel({
        label: btcAddrRegtest.address,
      });
      expect(Object.keys(btcWalletAddrs)).toContain(btcAddrRegtest.address);

      await standByForNextPoxCycle();

      poxInfo = await testEnv.client.getPox();

      burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;
      [contractAddress, contractName] = poxInfo.contract_id.split('.');

      expect(contractName).toBe('pox-4');
    });

    test('stack-stx tx', async () => {
      // Create and broadcast a `stack-stx` tx
      const tx1 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()), // amount-ustx
          tupleCV({
            hashbytes: bufferCV(btcAddrDecoded.data),
            version: bufferCV(Buffer.from([btcAddrDecoded.version])),
          }), // pox-addr
          uintCV(burnBlockHeight), // start-burn-ht
          uintCV(cycleCount), // lock-period
          bufferCV(hexToBytes('1'.padStart(66, '0'))), // signer-key
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId1 = '0x' + tx1.txid();
      const sendResult1 = await testEnv.client.sendTransaction(Buffer.from(tx1.serialize()));
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTxSuccess(expectedTxId1);

      const tx1Events = await testEnv.api.datastore.getTxEvents({
        txId: expectedTxId1,
        indexBlockHash: dbTx1.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx1Events.results).toBeTruthy();
      const lockEvent1 = tx1Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent1).toBeDefined();
      expect(lockEvent1.locked_address).toBe(account.stacksAddress);
      expect(lockEvent1.locked_amount).toBe(ustxAmount);

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
      const expectedUnlockHeight1 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(lockEvent1.unlock_height).toBe(expectedUnlockHeight1);

      // Test the API address balance data after a `stack-stx` operation
      const addrBalance1 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance1.locked).toBe(ustxAmount.toString());
      expect(addrBalance1.burnchain_unlock_height).toBe(expectedUnlockHeight1);
      expect(addrBalance1.lock_height).toBe(dbTx1.block_height);
      expect(addrBalance1.lock_tx_id).toBe(dbTx1.tx_id);
    });

    test('stacking rewards - API /burnchain/rewards', async () => {
      await standByUntilBurnBlock(
        poxInfo.next_cycle.reward_phase_start_block_height + poxInfo.reward_cycle_length
      );

      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      expect(firstReward.reward_recipient).toBe(btcAddr);
      expect(Number(firstReward.burn_amount)).toBeGreaterThan(0);
      expect(firstReward.burn_block_height).toBeGreaterThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height
      );
      expect(firstReward.burn_block_height).toBeLessThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height + 2 // early in the reward phase
      );

      const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
        `/extended/v1/burnchain/rewards/${btcAddr}/total`
      );
      expect(rewardsTotal.reward_recipient).toBe(btcAddr);
      expect(Number(rewardsTotal.reward_amount)).toBeGreaterThan(0);
    });

    test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
      const slotStart = poxInfo.next_cycle.reward_phase_start_block_height;
      const slotEnd = slotStart + 2; // early in the reward phase

      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(btcAddr);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeGreaterThanOrEqual(slotStart);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeLessThanOrEqual(slotEnd);
    });

    test('stacking rewards - BTC JSON-RPC', async () => {
      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      const blockResult: {
        tx: { vout?: { scriptPubKey: { address?: string }; value?: number }[] }[];
      } = await testEnv.bitcoinRpcClient.getblock({
        blockhash: hexToBuffer(firstReward.burn_block_hash).toString('hex'),
        verbosity: 2,
      });
      const vout = blockResult.tx
        .flatMap(t => t.vout)
        .find(v => v?.value && v.scriptPubKey.address == btcAddrRegtest.address);
      if (!vout?.value) {
        throw new Error(
          `Could not find bitcoin vout for ${btcAddrRegtest.address} in block ${firstReward.burn_block_hash}`
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
      }[] = await testEnv.bitcoinRpcClient.listtransactions({
        label: btcAddrRegtest.address,
        include_watchonly: true,
      });
      received = received.filter(r => r.address === btcAddrRegtest.address);
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
    });

    test('stx unlocked - RPC balance endpoint', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccountInfo1 = await testEnv.client.getAccount(account.stacksAddress);
      const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
      await standByUntilBurnBlock(burnBlockUnlockHeight);

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
        address: btcAddrRegtest.address,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });

  describe('PoX-4 - Stacking operations P2WPKH', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcAddrDecoded: { version: number; data: Uint8Array };
    let btcPubKey: string;
    let btcAddrRegtest: string;

    test('P2WPKH setup', async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2wpkh',
      });
      expect(btcAddr).toBe('tb1qq6hag67dl53wl99vzg42z8eyzfz2xlkvvlryfj');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      btcAddrDecoded = decodeBtcAddress(btcAddr);
      expect({
        data: Buffer.from(btcAddrDecoded.data).toString('hex'),
        version: btcAddrDecoded.version,
      }).toEqual({ data: '06afd46bcdfd22ef94ac122aa11f241244a37ecc', version: 4 });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcAddrRegtest = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2wpkh',
      });
      expect(btcAddrRegtest).toBe('bcrt1qq6hag67dl53wl99vzg42z8eyzfz2xlkvwk6f7m');

      await testEnv.bitcoinRpcClient.importaddress({
        address: btcAddrRegtest,
        label: btcAddrRegtest,
      });
      const btcWalletAddrs = await testEnv.bitcoinRpcClient.getaddressesbylabel({
        label: btcAddrRegtest,
      });
      expect(Object.keys(btcWalletAddrs)).toContain(btcAddrRegtest);

      // If we're close to or in the prepare phase, wait until until the start of the next cycle
      // if ((await testEnv.client.getPox()).next_cycle.blocks_until_prepare_phase <= 20) {
      if (true) {
        await standByForNextPoxCycle();
      }

      poxInfo = await testEnv.client.getPox();

      burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;
      [contractAddress, contractName] = poxInfo.contract_id.split('.');

      expect(contractName).toBe('pox-4');
    });

    test('stack-stx tx', async () => {
      // Create and broadcast a `stack-stx` tx
      const tx1 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()), // amount-ustx
          tupleCV({
            hashbytes: bufferCV(btcAddrDecoded.data),
            version: bufferCV(Buffer.from([btcAddrDecoded.version])),
          }), // pox-addr
          uintCV(burnBlockHeight), // start-burn-ht
          uintCV(cycleCount), // lock-period
          bufferCV(hexToBytes('2'.padStart(66, '0'))), // signer-key
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId1 = '0x' + tx1.txid();
      const sendResult1 = await testEnv.client.sendTransaction(Buffer.from(tx1.serialize()));
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTxSuccess(expectedTxId1);

      const tx1Events = await testEnv.api.datastore.getTxEvents({
        txId: expectedTxId1,
        indexBlockHash: dbTx1.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx1Events.results).toBeTruthy();
      const lockEvent1 = tx1Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent1).toBeDefined();
      expect(lockEvent1.locked_address).toBe(account.stacksAddress);
      expect(lockEvent1.locked_amount).toBe(ustxAmount);

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
      const expectedUnlockHeight1 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(lockEvent1.unlock_height).toBe(expectedUnlockHeight1);

      // Test the API address balance data after a `stack-stx` operation
      const addrBalance1 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance1.locked).toBe(ustxAmount.toString());
      expect(addrBalance1.burnchain_unlock_height).toBe(expectedUnlockHeight1);
      expect(addrBalance1.lock_height).toBe(dbTx1.block_height);
      expect(addrBalance1.lock_tx_id).toBe(dbTx1.tx_id);
    });

    test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
      const prepareStart = poxInfo.next_cycle.prepare_phase_start_block_height;
      const prepareEnd = prepareStart + poxInfo.prepare_phase_block_length;

      await standByUntilBurnBlock(prepareEnd + 1);

      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(btcAddr);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeGreaterThanOrEqual(prepareStart);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeLessThanOrEqual(prepareEnd);
    });

    test('stacking rewards - API /burnchain/rewards', async () => {
      await standByUntilBurnBlock(poxInfo.next_cycle.reward_phase_start_block_height + 2);

      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      expect(rewards.results.length).toBe(1);
      expect(firstReward.reward_recipient).toBe(btcAddr);
      expect(Number(firstReward.burn_amount)).toBeGreaterThan(0);
      expect(firstReward.burn_block_height).toBeGreaterThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height
      );
      expect(firstReward.burn_block_height).toBeLessThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height + 2
      );

      const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
        `/extended/v1/burnchain/rewards/${btcAddr}/total`
      );
      expect(rewardsTotal.reward_recipient).toBe(btcAddr);
      expect(Number(rewardsTotal.reward_amount)).toBeGreaterThan(0);
    });

    test('stacking rewards - BTC JSON-RPC', async () => {
      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      const blockResult: {
        tx: { vout?: { scriptPubKey: { address?: string }; value?: number }[] }[];
      } = await testEnv.bitcoinRpcClient.getblock({
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
        label: btcAddrRegtest,
        include_watchonly: true,
      });
      received = received.filter(r => r.address === btcAddrRegtest);
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
    });

    test('stx unlocked - RPC balance endpoint', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccountInfo1 = await testEnv.client.getAccount(account.stacksAddress);
      const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
      await standByUntilBurnBlock(burnBlockUnlockHeight);

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
        address: btcAddrRegtest,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });

  describe('PoX-4 - Stacking operations P2WSH', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcAddrDecoded: { version: number; data: Uint8Array };
    let btcPubKey: string;
    let btcAddrRegtest: string;

    test('P2WSH setup', async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2wsh',
      });
      expect(btcAddr).toBe('tb1q4qp0380kg75cqv25k4zruwa87wefwz0uefv78jekagm2j8568rwqvz7llf');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      btcAddrDecoded = decodeBtcAddress(btcAddr);
      expect({
        data: Buffer.from(btcAddrDecoded.data).toString('hex'),
        version: btcAddrDecoded.version,
      }).toEqual({
        data: 'a802f89df647a9803154b5443e3ba7f3b29709fcca59e3cb36ea36a91e9a38dc',
        version: 5,
      });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcAddrRegtest = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2wsh',
      });
      expect(btcAddrRegtest).toBe(
        'bcrt1q4qp0380kg75cqv25k4zruwa87wefwz0uefv78jekagm2j8568rwqpm5e2n'
      );

      await testEnv.bitcoinRpcClient.importaddress({
        address: btcAddrRegtest,
        label: btcAddrRegtest,
      });
      const btcWalletAddrs = await testEnv.bitcoinRpcClient.getaddressesbylabel({
        label: btcAddrRegtest,
      });
      expect(Object.keys(btcWalletAddrs)).toContain(btcAddrRegtest);

      // If we're close to or in the prepare phase, wait until until the start of the next cycle
      // if ((await testEnv.client.getPox()).next_cycle.blocks_until_prepare_phase <= 20) {
      if (true) {
        await standByForNextPoxCycle();
      }

      poxInfo = await testEnv.client.getPox();

      burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;
      [contractAddress, contractName] = poxInfo.contract_id.split('.');

      expect(contractName).toBe('pox-4');
    });

    test('stack-stx tx', async () => {
      // Create and broadcast a `stack-stx` tx
      const tx1 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()), // amount-ustx
          tupleCV({
            hashbytes: bufferCV(btcAddrDecoded.data),
            version: bufferCV(Buffer.from([btcAddrDecoded.version])),
          }), // pox-addr
          uintCV(burnBlockHeight), // start-burn-ht
          uintCV(cycleCount), // lock-period
          bufferCV(hexToBytes('3'.padStart(66, '0'))), // signer-key
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId1 = '0x' + tx1.txid();
      const sendResult1 = await testEnv.client.sendTransaction(Buffer.from(tx1.serialize()));
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTxSuccess(expectedTxId1);

      const tx1Events = await testEnv.api.datastore.getTxEvents({
        txId: expectedTxId1,
        indexBlockHash: dbTx1.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx1Events.results).toBeTruthy();
      const lockEvent1 = tx1Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent1).toBeDefined();
      expect(lockEvent1.locked_address).toBe(account.stacksAddress);
      expect(lockEvent1.locked_amount).toBe(ustxAmount);

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
      const expectedUnlockHeight1 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(lockEvent1.unlock_height).toBe(expectedUnlockHeight1);

      // Test the API address balance data after a `stack-stx` operation
      const addrBalance1 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance1.locked).toBe(ustxAmount.toString());
      expect(addrBalance1.burnchain_unlock_height).toBe(expectedUnlockHeight1);
      expect(addrBalance1.lock_height).toBe(dbTx1.block_height);
      expect(addrBalance1.lock_tx_id).toBe(dbTx1.tx_id);
    });

    test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
      const prepareStart = poxInfo.next_cycle.prepare_phase_start_block_height;
      const prepareEnd = prepareStart + poxInfo.prepare_phase_block_length;

      await standByUntilBurnBlock(prepareEnd + 1);

      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(btcAddr);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeGreaterThanOrEqual(prepareStart);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeLessThanOrEqual(prepareEnd);
    });

    test('stacking rewards - API /burnchain/rewards', async () => {
      await standByUntilBurnBlock(poxInfo.next_cycle.reward_phase_start_block_height + 2);

      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      expect(firstReward.reward_recipient).toBe(btcAddr);
      expect(Number(firstReward.burn_amount)).toBeGreaterThan(0);
      expect(firstReward.burn_block_height).toBeGreaterThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height
      );
      expect(firstReward.burn_block_height).toBeLessThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height + 2
      );

      const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
        `/extended/v1/burnchain/rewards/${btcAddr}/total`
      );
      expect(rewardsTotal.reward_recipient).toBe(btcAddr);
      expect(Number(rewardsTotal.reward_amount)).toBeGreaterThan(0);
    });

    test('stacking rewards - BTC JSON-RPC', async () => {
      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      const blockResult: {
        tx: { vout?: { scriptPubKey: { address?: string }; value?: number }[] }[];
      } = await testEnv.bitcoinRpcClient.getblock({
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
        label: btcAddrRegtest,
        include_watchonly: true,
      });
      received = received.filter(r => r.address === btcAddrRegtest);
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
    });

    test('stx unlocked - RPC balance endpoint', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccountInfo1 = await testEnv.client.getAccount(account.stacksAddress);
      const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
      await standByUntilBurnBlock(burnBlockUnlockHeight);

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
        address: btcAddrRegtest,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });

  describe('PoX-4 - Stacking operations P2TR', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcAddrDecoded: { version: number; data: Uint8Array };
    let btcPubKey: string;
    let btcAddrRegtest: string;

    test('P2TR setup', async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2tr',
      });
      expect(btcAddr).toBe('tb1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasvfnc28');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      btcAddrDecoded = decodeBtcAddress(btcAddr);
      expect({
        data: Buffer.from(btcAddrDecoded.data).toString('hex'),
        version: btcAddrDecoded.version,
      }).toEqual({
        data: 'cafd90c7026f0b6ab98df89490d02732881f2f4b5900856358dddff4679c2ffb',
        version: 6,
      });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcAddrRegtest = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2tr',
      });
      expect(btcAddrRegtest).toBe(
        'bcrt1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9laspse7la'
      );

      await testEnv.bitcoinRpcClient.importaddress({
        address: btcAddrRegtest,
        label: btcAddrRegtest,
      });
      const btcWalletAddrs = await testEnv.bitcoinRpcClient.getaddressesbylabel({
        label: btcAddrRegtest,
      });
      expect(Object.keys(btcWalletAddrs)).toContain(btcAddrRegtest);

      // If we're close to or in the prepare phase, wait until until the start of the next cycle
      // if ((await testEnv.client.getPox()).next_cycle.blocks_until_prepare_phase <= 20) {
      if (true) {
        await standByForNextPoxCycle();
      }

      poxInfo = await testEnv.client.getPox();

      burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;
      [contractAddress, contractName] = poxInfo.contract_id.split('.');

      expect(contractName).toBe('pox-4');
    });

    test('stack-stx tx', async () => {
      // Create and broadcast a `stack-stx` tx
      const tx1 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()), // amount-ustx
          tupleCV({
            hashbytes: bufferCV(btcAddrDecoded.data),
            version: bufferCV(Buffer.from([btcAddrDecoded.version])),
          }), // pox-addr
          uintCV(burnBlockHeight), // start-burn-ht
          uintCV(cycleCount), // lock-period
          bufferCV(hexToBytes('4'.padStart(66, '0'))), // signer-key
        ],
        network: testEnv.stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId1 = '0x' + tx1.txid();
      const sendResult1 = await testEnv.client.sendTransaction(Buffer.from(tx1.serialize()));
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTxSuccess(expectedTxId1);

      const tx1Events = await testEnv.api.datastore.getTxEvents({
        txId: expectedTxId1,
        indexBlockHash: dbTx1.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx1Events.results).toBeTruthy();
      const lockEvent1 = tx1Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent1).toBeDefined();
      expect(lockEvent1.locked_address).toBe(account.stacksAddress);
      expect(lockEvent1.locked_amount).toBe(ustxAmount);

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle count specified in the `stack-stx` tx.
      const expectedUnlockHeight1 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(lockEvent1.unlock_height).toBe(expectedUnlockHeight1);

      // Test the API address balance data after a `stack-stx` operation
      const addrBalance1 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance1.locked).toBe(ustxAmount.toString());
      expect(addrBalance1.burnchain_unlock_height).toBe(expectedUnlockHeight1);
      expect(addrBalance1.lock_height).toBe(dbTx1.block_height);
      expect(addrBalance1.lock_tx_id).toBe(dbTx1.tx_id);
    });

    test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
      const prepareStart = poxInfo.next_cycle.prepare_phase_start_block_height;
      const prepareEnd = prepareStart + poxInfo.prepare_phase_block_length;

      await standByUntilBurnBlock(prepareEnd + 1);

      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(btcAddr);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeGreaterThanOrEqual(prepareStart);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeLessThanOrEqual(prepareEnd);
    });

    test('stacking rewards - API /burnchain/rewards', async () => {
      await standByUntilBurnBlock(poxInfo.next_cycle.reward_phase_start_block_height + 2);

      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      expect(firstReward.reward_recipient).toBe(btcAddr);
      expect(Number(firstReward.burn_amount)).toBeGreaterThan(0);
      expect(firstReward.burn_block_height).toBeGreaterThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height
      );
      expect(firstReward.burn_block_height).toBeLessThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height + 2
      );

      const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
        `/extended/v1/burnchain/rewards/${btcAddr}/total`
      );
      expect(rewardsTotal.reward_recipient).toBe(btcAddr);
      expect(Number(rewardsTotal.reward_amount)).toBeGreaterThan(0);
    });

    test('stacking rewards - BTC JSON-RPC', async () => {
      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      const firstReward = rewards.results.sort(
        (a, b) => a.burn_block_height - b.burn_block_height
      )[0];
      const blockResult: {
        tx: { vout?: { scriptPubKey: { address?: string }; value?: number }[] }[];
      } = await testEnv.bitcoinRpcClient.getblock({
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
        label: btcAddrRegtest,
        include_watchonly: true,
      });
      received = received.filter(r => r.address === btcAddrRegtest);
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
    });

    test('stx unlocked - RPC balance endpoint', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccountInfo1 = await testEnv.client.getAccount(account.stacksAddress);
      const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
      await standByUntilBurnBlock(burnBlockUnlockHeight);

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
        address: btcAddrRegtest,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });
});
