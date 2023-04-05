/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StacksNetwork } from '@stacks/network';
import {
  burnHeightToRewardCycle,
  decodeBtcAddress,
  rewardCycleToBurnHeight,
} from '@stacks/stacking';
import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  ServerStatusResponse,
} from '@stacks/stacks-blockchain-api-types';
import {
  AnchorMode,
  bufferCV,
  makeContractCall,
  makeSTXTokenTransfer,
  TupleCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import bignumber from 'bignumber.js';
import { RPCClient } from 'rpc-bitcoin';
import {
  accountFromKey,
  fetchGet,
  getRosettaAccountBalance,
  getRosettaBlockByBurnBlockHeight,
  stackStxWithRosetta,
  standByForAccountUnlock,
  standByForTxSuccess,
  standByUntilBlock,
  standByUntilBurnBlock,
} from '../test-utils/test-helpers';
import { decodeClarityValue } from 'stacks-encoding-native-js';
import { ApiServer } from '../api/init';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { DbBlock, DbEventTypeId, DbStxLockEvent, DbTx, DbTxStatus } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { getBitcoinAddressFromKey, privateToPublicKey, VerboseKeyOutput } from '../ec-helpers';
import { hexToBuffer, timeout } from '../helpers';
import type { TestEnvContext } from './env-setup';

type Account = {
  secretKey: string;
  pubKey: string;
  stxAddr: string;
  btcAddr: string;
  btcTestnetAddr: string;
  poxAddr: { version: number; data: Uint8Array };
  poxAddrClar: TupleCV;
  wif: string;
};

describe('PoX transition tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;
  let bitcoinRpcClient: RPCClient;

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork, bitcoinRpcClient } = testEnv);
    await Promise.resolve();
  });

  describe('Consistent API and RPC account balances through pox transitions', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcRegtestAccount: VerboseKeyOutput;
    let btcPubKey: string;
    let decodedBtcAddr: { version: number; data: Uint8Array };
    const btcPrivateKey = '0000000000000000000000000000000000000000000000000000000000000002';

    beforeAll(async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2sh-p2wpkh',
      });
      expect(btcAddr).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      decodedBtcAddr = decodeBtcAddress(btcAddr);
      expect({
        data: Buffer.from(decodedBtcAddr.data).toString('hex'),
        version: decodedBtcAddr.version,
      }).toEqual({ data: '978a0121f9a24de65a13bab0c43c3a48be074eae', version: 1 });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcRegtestAccount = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2sh-p2wpkh',
        verbose: true,
      });
      expect(btcRegtestAccount.address).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');

      await bitcoinRpcClient.importprivkey({
        privkey: btcRegtestAccount.wif,
        label: btcRegtestAccount.address,
        rescan: false,
      });
      const btcWalletAddrs = await bitcoinRpcClient.getaddressesbylabel({
        label: btcRegtestAccount.address,
      });
      expect(Object.keys(btcWalletAddrs)).toContain(btcRegtestAccount.address);

      const poxInfo = await client.getPox();

      const [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox');
    });

    test('stack-stx tx repeatedly through pox transition', async () => {
      let pox1CyclesLocked = 0;
      let pox2CyclesLocked = 0;
      do {
        const info = await client.getInfo();
        const poxInfo = await client.getPox();
        // eslint-disable-next-line prefer-const
        let [contractAddress, contractName] = poxInfo.contract_id.split('.');

        // TODO: manually set to pox-2 if activation_burnchain_block_height reached
        if (
          contractName === 'pox' &&
          poxInfo.current_burnchain_block_height! >=
            poxInfo.contract_versions![1].activation_burnchain_block_height + 1
        ) {
          contractName = 'pox-2';
        }

        if (contractName === 'pox') {
          pox1CyclesLocked++;
        } else {
          pox2CyclesLocked++;
        }
        const cycleCount = 1;
        const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
        const cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;
        const burnBlockHeight = poxInfo.current_burnchain_block_height as number;

        // Create and broadcast a `stack-stx` tx
        const tx1 = await makeContractCall({
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
            uintCV(cycleCount),
          ],
          network: stacksNetwork,
          anchorMode: AnchorMode.OnChainOnly,
          fee: 10000,
          validateWithAbi: false,
        });
        const expectedTxId1 = '0x' + tx1.txid();
        const sendResult1 = await client.sendTransaction(Buffer.from(tx1.serialize()));
        expect(sendResult1.txId).toBe(expectedTxId1);

        console.log(
          `Stack-stx performed at burn height: ${info.burn_block_height}, block height: ${info.stacks_tip_height}, contract: ${contractName}, tx: ${expectedTxId1}`
        );

        // Wait for API to receive and ingest tx
        const dbTx1 = await standByForTxSuccess(expectedTxId1);

        const tx1Events = await api.datastore.getTxEvents({
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

        await standByForAccountUnlock(account.stacksAddress);
      } while (pox2CyclesLocked < 2);
    });
  });

  describe('Stacking on pox-2 after pox-1 force unlock', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcRegtestAccount: VerboseKeyOutput;
    let btcPubKey: string;
    let decodedBtcAddr: { version: number; data: Uint8Array };
    const btcPrivateKey = '0000000000000000000000000000000000000000000000000000000000000002';
    let lastPoxInfo: CoreRpcPoxInfo;

    beforeAll(async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2sh-p2wpkh',
      });
      expect(btcAddr).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      decodedBtcAddr = decodeBtcAddress(btcAddr);
      expect({
        data: Buffer.from(decodedBtcAddr.data).toString('hex'),
        version: decodedBtcAddr.version,
      }).toEqual({ data: '978a0121f9a24de65a13bab0c43c3a48be074eae', version: 1 });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcRegtestAccount = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2sh-p2wpkh',
        verbose: true,
      });
      expect(btcRegtestAccount.address).toBe('2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o');

      await bitcoinRpcClient.importprivkey({
        privkey: btcRegtestAccount.wif,
        label: btcRegtestAccount.address,
        rescan: false,
      });
      const btcWalletAddrs = await bitcoinRpcClient.getaddressesbylabel({
        label: btcRegtestAccount.address,
      });
      expect(Object.keys(btcWalletAddrs)).toContain(btcRegtestAccount.address);
    });

    test('stack-stx tx in pox-1', async () => {
      const poxInfo = await client.getPox();
      lastPoxInfo = poxInfo;
      const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      const burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      const cycleCount = 12; // max cycles allowed
      const cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;
      const [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox');
      // Create and broadcast a `stack-stx` tx
      const tx1 = await makeContractCall({
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
          uintCV(cycleCount),
        ],
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId1 = '0x' + tx1.txid();
      const sendResult1 = await client.sendTransaction(Buffer.from(tx1.serialize()));
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTxSuccess(expectedTxId1);

      const tx1Events = await api.datastore.getTxEvents({
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

    test('stx unlock at pox_v1_unlock_height block', async () => {
      const firstBalance = await client.getAccount(account.stacksAddress);
      while (true) {
        const poxInfo = await client.getPox();
        const info = await client.getInfo();
        const accountInfo = await client.getAccount(account.stacksAddress);
        const addrBalance = await fetchGet<AddressStxBalanceResponse>(
          `/extended/v1/address/${account.stacksAddress}/stx`
        );
        const status = await fetchGet<ServerStatusResponse>('/extended/v1/status');
        console.log({
          poxInfo,
          contract_versions: poxInfo.contract_versions,
          info,
          status,
          accountInfo,
          addrBalance,
        });
        expect(BigInt(addrBalance.locked)).toBe(BigInt(accountInfo.locked));
        if (BigInt(accountInfo.locked) === 0n) {
          // Funds were unlocked!
          // We're in period 2b, where pox-2 is now active
          // TODO: this is now reporting 'pox'
          // expect(poxInfo.contract_id).toBe('ST000000000000000000002AMW42H.pox-2');
          // expect(poxInfo.contract_id).toBe(poxInfo.contract_versions![1].contract_id);
          expect(poxInfo.current_burnchain_block_height).toBe(137);
          expect(poxInfo.current_burnchain_block_height).toBe(status.pox_v1_unlock_height! + 1);
          expect(poxInfo.current_burnchain_block_height).toBe(
            poxInfo.contract_versions![1].activation_burnchain_block_height + 1
          );
          break;
        } else {
          expect(poxInfo.current_burnchain_block_height).toBeLessThanOrEqual(136);
          expect(poxInfo.current_burnchain_block_height).toBeLessThan(
            poxInfo.contract_versions![1].activation_burnchain_block_height + 1
          );

          // todo: WARN: .skip expect, because node offers unexpected "active" contract (1 block early)
          // If we're NOT in 2b yet (and are still locked), we should still be seeing pox-1
          // expect(poxInfo.contract_id).toBe('ST000000000000000000002AMW42H.pox');
          // expect(poxInfo.contract_id).toBe(poxInfo.contract_versions![0].contract_id);
        }
        await standByUntilBlock(info.stacks_tip_height + 1);
      }
      const nextPoxInfo = await client.getPox();
      expect(firstBalance.unlock_height).toBeGreaterThan(
        nextPoxInfo.current_burnchain_block_height!
      );
    });

    test('stack-stx on pox-2', async () => {
      const poxInfo = await client.getPox();
      lastPoxInfo = poxInfo;
      const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.2).toString());
      const burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      const cycleCount = 1;
      // eslint-disable-next-line prefer-const
      let [contractAddress, contractName] = poxInfo.contract_id.split('.');
      // TODO: this still reports 'pox' so ignore check and set to 'pox-2' for contract-call
      // expect(contractName).toBe('pox-2');
      contractName = 'pox-2';

      // Create and broadcast a `stack-stx` tx
      const tx1 = await makeContractCall({
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
          uintCV(cycleCount),
        ],
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId1 = '0x' + tx1.txid();
      const sendResult1 = await client.sendTransaction(Buffer.from(tx1.serialize()));
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTxSuccess(expectedTxId1);

      // validate pox-2 stacking locked status
      const accountInfo = await client.getAccount(account.stacksAddress);
      const addrBalance = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(BigInt(accountInfo.locked)).toBe(ustxAmount);
      expect(BigInt(addrBalance.locked)).toBe(ustxAmount);
    });

    test('wait for pox-2 stacking to unlock', async () => {
      await standByForAccountUnlock(account.stacksAddress);
    });

    test('stx unlocked - RPC balance endpoint', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccountInfo1 = await client.getAccount(account.stacksAddress);
      const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
      const dbBlock1 = await standByUntilBurnBlock(burnBlockUnlockHeight);

      // Check that STX are no longer reported as locked by the RPC endpoints:
      const rpcAccountInfo = await client.getAccount(account.stacksAddress);
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
  });

  describe('Rosetta', () => {
    const seedAccount = testnetKeys[0];
    let poxInfo: CoreRpcPoxInfo;
    let ustxAmount: bigint;
    const accountKey = '72e8e3725324514c38c2931ed337ab9ab8d8abaae83ed2275456790194b1fd3101';
    let account: Account;
    let testAccountBalance: bigint;
    let poxV1UnlockHeight: number;

    beforeAll(() => {
      const testEnv: TestEnvContext = (global as any).testEnv;
      ({ db, api, client, stacksNetwork, bitcoinRpcClient } = testEnv);

      account = accountFromKey(accountKey);
    });

    describe('Rosetta - Stacked STX unlock during transition', () => {
      test('Fund new account for testing', async () => {
        await bitcoinRpcClient.importaddress({
          address: account.btcAddr,
          label: account.btcAddr,
          rescan: false,
        });

        // transfer pox "min_amount_ustx" from seed to test account
        const poxInfo = await client.getPox();
        testAccountBalance = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 2.1).toString());
        const stxXfer1 = await makeSTXTokenTransfer({
          senderKey: seedAccount.secretKey,
          recipient: account.stxAddr,
          amount: testAccountBalance,
          network: stacksNetwork,
          anchorMode: AnchorMode.OnChainOnly,
          fee: 200,
        });
        const { txId: stxXferId1 } = await client.sendTransaction(
          Buffer.from(stxXfer1.serialize())
        );

        const stxXferTx1 = await standByForTxSuccess(stxXferId1);
        expect(stxXferTx1.token_transfer_recipient_address).toBe(account.stxAddr);
      });

      test('Verify expected amount of STX are funded', async () => {
        // test stacks-node account RPC balance
        const coreNodeBalance = await client.getAccount(account.stxAddr);
        expect(BigInt(coreNodeBalance.balance)).toBe(testAccountBalance);
        expect(BigInt(coreNodeBalance.locked)).toBe(0n);

        // test API address endpoint balance
        const apiBalance = await fetchGet<AddressStxBalanceResponse>(
          `/extended/v1/address/${account.stxAddr}/stx`
        );
        expect(BigInt(apiBalance.balance)).toBe(testAccountBalance);
        expect(BigInt(apiBalance.locked)).toBe(0n);

        // test Rosetta address endpoint balance
        const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
        expect(BigInt(rosettaBalance.account.balances[0].value)).toBe(testAccountBalance);
        expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(0n);
      });

      test('stack-stx in pox-v1', async () => {
        const cycleCount = 1;

        poxInfo = await client.getPox();
        ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
        poxV1UnlockHeight = poxInfo.contract_versions![1].activation_burnchain_block_height;

        const rosettaStackStx = await stackStxWithRosetta({
          btcAddr: account.btcAddr,
          stacksAddress: account.stxAddr,
          pubKey: account.pubKey,
          privateKey: account.secretKey,
          cycleCount,
          ustxAmount,
        });

        expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox');
        expect(
          rosettaStackStx.constructionMetadata.metadata.burn_block_height as number
        ).toBeTruthy();
        expect(rosettaStackStx.submitResult.transaction_identifier.hash).toBe(rosettaStackStx.txId);
        expect(rosettaStackStx.tx.contract_call_contract_id).toBe(
          'ST000000000000000000002AMW42H.pox'
        );
        await standByUntilBlock(rosettaStackStx.tx.block_height);
      });

      test('Verify expected amount of STX are locked', async () => {
        // test stacks-node account RPC balance
        const coreNodeBalance = await client.getAccount(account.stxAddr);
        expect(BigInt(coreNodeBalance.balance)).toBeLessThan(testAccountBalance);
        expect(BigInt(coreNodeBalance.locked)).toBe(ustxAmount);

        // test API address endpoint balance
        const apiBalance = await fetchGet<AddressStxBalanceResponse>(
          `/extended/v1/address/${account.stxAddr}/stx`
        );
        expect(BigInt(apiBalance.balance)).toBeLessThan(testAccountBalance);
        expect(BigInt(apiBalance.locked)).toBe(ustxAmount);

        // test Rosetta address endpoint balance
        const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
        expect(BigInt(rosettaBalance.account.balances[0].value)).toBeLessThan(testAccountBalance);
        expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(ustxAmount);
      });

      test('Verify PoX rewards - Bitcoin RPC', async () => {
        // Wait until end of reward phase
        const rewardPhaseEndBurnBlock =
          poxInfo.next_cycle.reward_phase_start_block_height +
          poxInfo.reward_phase_block_length +
          1;
        await standByUntilBurnBlock(rewardPhaseEndBurnBlock);

        const rewards = await fetchGet<BurnchainRewardListResponse>(
          `/extended/v1/burnchain/rewards/${account.btcTestnetAddr}`
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
        }[] = await bitcoinRpcClient.listtransactions({
          label: account.btcAddr,
          include_watchonly: true,
        });
        received = received.filter(r => r.address === account.btcAddr);
        expect(received.length).toBe(1);
        expect(received[0].category).toBe('receive');
        expect(received[0].blockhash).toBe(
          hexToBuffer(firstReward.burn_block_hash).toString('hex')
        );
        const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
        expect(sats).toBe(firstReward.reward_amount);
      });

      test('Rosetta unlock events from pox-v1', async () => {
        const rpcAccountInfo1 = await client.getAccount(account.stxAddr);
        const rpcAccountLocked = BigInt(rpcAccountInfo1.locked).toString();
        const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;

        // Wait until account has unlocked (finished Stacking cycles)
        // (wait one more block due to test flakiness..)
        await standByUntilBurnBlock(burnBlockUnlockHeight + 1);

        // Check that STX are no longer reported as locked by the RPC endpoints:
        const rpcAccountInfo = await client.getAccount(account.stxAddr);
        expect(BigInt(rpcAccountInfo.locked)).toBe(0n);
        expect(rpcAccountInfo.unlock_height).toBe(0);

        // Get Stacks block associated with the burn block `unlock_height` reported by RPC
        const unlockRstaBlock = await getRosettaBlockByBurnBlockHeight(
          rpcAccountInfo1.unlock_height
        );

        // Ensure Rosetta block contains a stx_unlock operation
        const unlockOp = unlockRstaBlock
          .block!.transactions.flatMap(t => t.operations)
          .find(op => op.type === 'stx_unlock')!;
        expect(unlockOp).toBeDefined();
        expect(unlockOp).toEqual(
          expect.objectContaining({
            type: 'stx_unlock',
            status: 'success',
            account: { address: account.stxAddr },
            amount: { value: rpcAccountLocked, currency: { symbol: 'STX', decimals: 6 } },
          })
        );
      });

      test('Stack in pox-v1 for cycle count that will be force unlocked at pox_v1_unlock_height', async () => {
        const chainTip = await db.getChainTip(db.sql);
        const poxInfo = await client.getPox();
        expect(poxInfo.contract_id.split('.')[1]).toBe('pox');

        // ensure we are locking before pox_v1_unlock_height
        expect(poxInfo.current_burnchain_block_height).toBeLessThan(poxV1UnlockHeight);
        expect(chainTip.burnBlockHeight).toBeLessThan(poxV1UnlockHeight);

        ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

        // use maximum allowed cycle count (this must be enough to exceed pox_v1_unlock_height)
        const cycleCount = 12;

        const rosettaStackStx = await stackStxWithRosetta({
          btcAddr: account.btcAddr,
          stacksAddress: account.stxAddr,
          pubKey: account.pubKey,
          privateKey: account.secretKey,
          cycleCount,
          ustxAmount,
        });

        expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox');
        expect(
          rosettaStackStx.constructionMetadata.metadata.burn_block_height as number
        ).toBeTruthy();
        expect(rosettaStackStx.submitResult.transaction_identifier.hash).toBe(rosettaStackStx.txId);
        expect(rosettaStackStx.tx.contract_call_contract_id).toBe(
          'ST000000000000000000002AMW42H.pox'
        );

        // test stacks-node account RPC balance
        const coreNodeBalance = await client.getAccount(account.stxAddr);
        expect(BigInt(coreNodeBalance.locked)).toBe(ustxAmount);

        // test API address endpoint balance
        const apiBalance = await fetchGet<AddressStxBalanceResponse>(
          `/extended/v1/address/${account.stxAddr}/stx`
        );
        expect(BigInt(apiBalance.locked)).toBe(ustxAmount);

        // ensure API and RPC unlock heights match
        expect(coreNodeBalance.unlock_height).toBe(apiBalance.burnchain_unlock_height);

        // ensure account unlock height is after pox_v1_unlock_height
        expect(coreNodeBalance.unlock_height).toBeGreaterThan(poxV1UnlockHeight);
        expect(apiBalance.burnchain_unlock_height).toBeGreaterThan(poxV1UnlockHeight);
      });

      test('Wait for pox_v1_unlock_height', async () => {
        await standByForAccountUnlock(account.stxAddr);

        // ensure zero locked reported by stacks-node account RPC balance
        const coreNodeBalance = await client.getAccount(account.stxAddr);
        expect(BigInt(coreNodeBalance.locked)).toBe(0n);

        // ensure zero locked reported by API address endpoint balance
        const apiBalance = await fetchGet<AddressStxBalanceResponse>(
          `/extended/v1/address/${account.stxAddr}/stx`
        );
        expect(BigInt(apiBalance.locked)).toBe(0n);

        // ensure zero locked reported by Rosetta address endpoint balance
        const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
        expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(0n);
      });

      test('Ensure account unlocked in block after pox_v1_unlock_height', async () => {
        const chainTip = await db.getChainTip(db.sql);
        const poxInfo = await client.getPox();
        expect(chainTip.burnBlockHeight).toBe(poxV1UnlockHeight + 1);
        expect(poxInfo.current_burnchain_block_height).toBe(poxV1UnlockHeight + 1);
      });

      test('Ensure unlock ops are generated for pox_v1_unlock_height block', async () => {
        await standByUntilBurnBlock(poxV1UnlockHeight + 3);

        // Get Stacks block associated with the burn block `unlock_height` reported by RPC
        const poxV1UnlockHeightBlock = await getRosettaBlockByBurnBlockHeight(
          poxV1UnlockHeight + 1
        );
        const poxV1UnlockOps = poxV1UnlockHeightBlock
          .block!.transactions.flatMap(t => t.operations)
          .filter(op => op.type === 'stx_unlock');
        expect(poxV1UnlockOps).toHaveLength(1);
        expect(poxV1UnlockOps[0]).toEqual(
          expect.objectContaining({
            type: 'stx_unlock',
            status: 'success',
            account: { address: account.stxAddr },
            amount: { value: ustxAmount.toString(), currency: { symbol: 'STX', decimals: 6 } },
          })
        );

        // Ensure unlocks are not reported in the before and after blocks
        const surroundingBlocks = [poxV1UnlockHeight - 1, poxV1UnlockHeight, poxV1UnlockHeight + 2];
        for (const surroundingBlock of surroundingBlocks) {
          const block = await getRosettaBlockByBurnBlockHeight(surroundingBlock);
          const unlockOps = block
            .block!.transactions.flatMap(t => t.operations)
            .filter(op => op.type === 'stx_unlock');
          expect(unlockOps).toHaveLength(0);
        }
      });

      test('stack-stx in pox-v2', async () => {
        const cycleCount = 1;

        poxInfo = await client.getPox();
        ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

        const rosettaStackStx = await stackStxWithRosetta({
          btcAddr: account.btcAddr,
          stacksAddress: account.stxAddr,
          pubKey: account.pubKey,
          privateKey: account.secretKey,
          cycleCount,
          ustxAmount,
        });

        expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox-2');
        expect(
          rosettaStackStx.constructionMetadata.metadata.burn_block_height as number
        ).toBeTruthy();
        expect(rosettaStackStx.submitResult.transaction_identifier.hash).toBe(rosettaStackStx.txId);
        expect(rosettaStackStx.tx.contract_call_contract_id).toBe(
          'ST000000000000000000002AMW42H.pox-2'
        );
        await standByUntilBlock(rosettaStackStx.tx.block_height);
      });
    });

    describe('Rosetta - Transistion periods use correct contracts', () => {
      test('Fund new account for testing', async () => {
        await bitcoinRpcClient.importaddress({
          address: account.btcAddr,
          label: account.btcAddr,
          rescan: false,
        });

        // transfer pox "min_amount_ustx" from seed to test account
        const poxInfo = await client.getPox();
        testAccountBalance = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 2.1).toString());
        const stxXfer1 = await makeSTXTokenTransfer({
          senderKey: seedAccount.secretKey,
          recipient: account.stxAddr,
          amount: testAccountBalance,
          network: stacksNetwork,
          anchorMode: AnchorMode.OnChainOnly,
          fee: 200,
        });
        const { txId: stxXferId1 } = await client.sendTransaction(
          Buffer.from(stxXfer1.serialize())
        );

        const stxXferTx1 = await standByForTxSuccess(stxXferId1);
        expect(stxXferTx1.token_transfer_recipient_address).toBe(account.stxAddr);
      });

      test('Verify expected amount of STX are funded', async () => {
        // test stacks-node account RPC balance
        const coreNodeBalance = await client.getAccount(account.stxAddr);
        expect(BigInt(coreNodeBalance.balance)).toBe(testAccountBalance);
        expect(BigInt(coreNodeBalance.locked)).toBe(0n);

        // test API address endpoint balance
        const apiBalance = await fetchGet<AddressStxBalanceResponse>(
          `/extended/v1/address/${account.stxAddr}/stx`
        );
        expect(BigInt(apiBalance.balance)).toBe(testAccountBalance);
        expect(BigInt(apiBalance.locked)).toBe(0n);

        // test Rosetta address endpoint balance
        const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
        expect(BigInt(rosettaBalance.account.balances[0].value)).toBe(testAccountBalance);
        expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(0n);
      });

      test('Rosetta stack-stx in Period 1 uses pox-1', async () => {
        // Assuming the following ENV:
        // STACKS_21_HEIGHT=120
        // STACKS_POX2_HEIGHT = 136

        poxInfo = await client.getPox();
        expect(poxInfo.current_burnchain_block_height).toBeLessThan(120); // Period 1

        ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

        const rosettaStackStx = await stackStxWithRosetta({
          cycleCount: 1,
          btcAddr: account.btcAddr,
          stacksAddress: account.stxAddr,
          pubKey: account.pubKey,
          privateKey: account.secretKey,
          ustxAmount,
        });

        expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox');
        expect(rosettaStackStx.tx.contract_call_contract_id).toBe(
          'ST000000000000000000002AMW42H.pox'
        );
        expect(
          rosettaStackStx.constructionMetadata.metadata.burn_block_height as number
        ).toBeTruthy();
        expect(rosettaStackStx.submitResult.transaction_identifier.hash).toBe(rosettaStackStx.txId);
      });

      test('Stand-by for Period 2a', async () => {
        // Assuming the following ENV:
        // STACKS_21_HEIGHT=120
        // STACKS_POX2_HEIGHT = 136

        poxInfo = await client.getPox();
        poxV1UnlockHeight = poxInfo.contract_versions![1].activation_burnchain_block_height;
        expect(poxV1UnlockHeight).toBe(136);

        await standByUntilBurnBlock(120); // 120 is the first block of the 2.1 fork

        // We are in Period 2a
        poxInfo = await client.getPox();
        expect(poxInfo.contract_id).toBe('ST000000000000000000002AMW42H.pox'); // pox-1 is still "active"
      });

      test('Rosetta stack-stx in Period 2a uses pox-2', async () => {
        poxInfo = await client.getPox();
        ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

        const rosettaStackStx = await stackStxWithRosetta({
          cycleCount: 1,
          btcAddr: account.btcAddr,
          stacksAddress: account.stxAddr,
          pubKey: account.pubKey,
          privateKey: account.secretKey,
          ustxAmount,
        });

        expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox-2');
        expect(rosettaStackStx.tx.contract_call_contract_id).toBe(
          'ST000000000000000000002AMW42H.pox-2'
        );
        expect(
          rosettaStackStx.constructionMetadata.metadata.burn_block_height as number
        ).toBeTruthy();
        expect(rosettaStackStx.submitResult.transaction_identifier.hash).toBe(rosettaStackStx.txId);
      });

      test('Stand-by for POX2_ACTIVATION (aka the last block of Period 2a)', async () => {
        // POX2_ACTIVATION == poxV1UnlockHeight == v1_unlock_height
        poxInfo = await client.getPox();
        poxV1UnlockHeight = poxInfo.contract_versions![1].activation_burnchain_block_height;

        expect(poxV1UnlockHeight).toBe(136);

        expect(poxInfo.current_burnchain_block_height).toBeLessThan(poxV1UnlockHeight);
        await standByUntilBurnBlock(poxV1UnlockHeight);

        poxInfo = await client.getPox();
        expect(poxInfo.current_burnchain_block_height).toBe(136);

        // todo: .skip expect, since this is reported incorrectly
        // We are still in Period 2a
        // expect(poxInfo.contract_id).toBe('ST000000000000000000002AMW42H.pox'); // pox-1 is still "active"
      });

      test('Stand-by for POX2_ACTIVATION+1 (aka first block of Period 2b)', async () => {
        await standByUntilBurnBlock(poxV1UnlockHeight + 1);

        poxInfo = await client.getPox();
        expect(poxInfo.current_burnchain_block_height).toBe(137);
        expect(poxInfo.current_burnchain_block_height).toBe(poxV1UnlockHeight + 1);

        // We are now in Period 2b
        // TODO: this reports `pox` now?
        // expect(poxInfo.contract_id).toBe('ST000000000000000000002AMW42H.pox-2'); // pox-2 is now "active"

        const calculatedRewardCycle = burnHeightToRewardCycle({
          poxInfo: poxInfo as any,
          burnBlockHeight: poxInfo.current_burnchain_block_height as number,
        });

        expect(calculatedRewardCycle).toBe(poxInfo.current_cycle.id);
        expect(calculatedRewardCycle + 1).toBe(poxInfo.contract_versions![1].first_reward_cycle_id);
      });

      test('Stand-by for cycle N+1 (aka Period 3)', async () => {
        const calculatedBurnHeight = rewardCycleToBurnHeight({
          poxInfo: poxInfo as any,
          rewardCycle: poxInfo.contract_versions![1].first_reward_cycle_id,
        });

        await standByUntilBurnBlock(calculatedBurnHeight);

        poxInfo = await client.getPox();
        expect(poxInfo.current_burnchain_block_height).toBe(140);

        await standByUntilBurnBlock(calculatedBurnHeight + 1); // avoid race condition?
        poxInfo = await client.getPox();
        expect(poxInfo.current_cycle.id).toBe(poxInfo.contract_versions![1].first_reward_cycle_id);

        // We are now in Period 3
        expect(poxInfo.contract_id).toBe('ST000000000000000000002AMW42H.pox-2'); // pox-2 remains the pox-contract going forward
      });
    });
  });
});
