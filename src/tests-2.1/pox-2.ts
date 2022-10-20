/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { TestEnvContext } from './env-setup';
import { ApiServer } from '../api/init';
import * as supertest from 'supertest';
import { Server } from 'net';
import { DbBlock, DbEventTypeId, DbStxLockEvent, DbTx, DbTxStatus } from '../datastore/common';
import { AnchorMode, bufferCV, makeContractCall, tupleCV, uintCV } from '@stacks/transactions';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { testnetKeys } from '../api/routes/debug';
import * as poxHelpers from '../pox-helpers';
import { parsePort } from '../helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { StacksNetwork } from '@stacks/network';
import * as btcLib from 'bitcoinjs-lib';
import { ECPair, getBitcoinAddressFromKey, privateToPublicKey } from '../ec-helpers';
import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import { RPCClient } from 'rpc-bitcoin';

describe('PoX-2 tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork } = testEnv);
    await Promise.resolve();
  });

  function getRpcClient(): RPCClient {
    const { BTC_RPC_PORT, BTC_RPC_HOST, BTC_RPC_PW, BTC_RPC_USER } = process.env;
    if (!BTC_RPC_PORT || !BTC_RPC_HOST || !BTC_RPC_PW || !BTC_RPC_USER) {
      throw new Error('Bitcoin JSON-RPC env vars not fully configured.');
    }
    const client = new RPCClient({
      url: BTC_RPC_HOST,
      port: parsePort(BTC_RPC_PORT),
      user: BTC_RPC_USER,
      pass: BTC_RPC_PW,
      timeout: 120000,
    });
    return client;
  }

  async function standByForTx(expectedTxId: string): Promise<DbTx> {
    const dbTxQuery = await api.datastore.getTx({ txId: expectedTxId, includeUnanchored: false });
    if (dbTxQuery.found) {
      return dbTxQuery.result;
    }
    return new Promise<DbTx>(resolve => {
      const listener: (txId: string) => void = async txId => {
        const dbTxQuery = await api.datastore.getTx({
          txId: expectedTxId,
          includeUnanchored: false,
        });
        if (!dbTxQuery.found) {
          return;
        }
        api.datastore.eventEmitter.removeListener('txUpdate', listener);
        resolve(dbTxQuery.result);
      };
      api.datastore.eventEmitter.addListener('txUpdate', listener);
    });
  }

  function standByUntilBlock(blockHeight: number): Promise<DbBlock> {
    return new Promise<DbBlock>(async resolve => {
      const curHeight = await api.datastore.getCurrentBlockHeight();
      if (curHeight.found && curHeight.result >= blockHeight) {
        const dbBlock = await api.datastore.getBlock({ height: curHeight.result });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        resolve(dbBlock.result);
        return;
      }
      const listener: (blockHash: string) => void = async blockHash => {
        const dbBlockQuery = await api.datastore.getBlock({ hash: blockHash });
        if (!dbBlockQuery.found || dbBlockQuery.result.block_height < blockHeight) {
          return;
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlockQuery.result);
      };
      api.datastore.eventEmitter.addListener('blockUpdate', listener);
    });
  }

  function standByUntilBurnBlock(burnBlockHeight: number): Promise<DbBlock> {
    return new Promise<DbBlock>(async resolve => {
      const curHeight = await api.datastore.getCurrentBlock();
      if (curHeight.found && curHeight.result.burn_block_height >= burnBlockHeight) {
        const dbBlock = await api.datastore.getBlock({ height: curHeight.result.block_height });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        resolve(dbBlock.result);
        return;
      }
      const listener: (blockHash: string) => void = async blockHash => {
        const dbBlockQuery = await api.datastore.getBlock({ hash: blockHash });
        if (!dbBlockQuery.found || dbBlockQuery.result.burn_block_height < burnBlockHeight) {
          return;
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlockQuery.result);
      };
      api.datastore.eventEmitter.addListener('blockUpdate', listener);
    });
  }

  async function fetchPost<TPostBody, TRes>(endpoint: string, body: TPostBody) {
    const result = await supertest(api.server)
      .post(endpoint)
      .send(body as any);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
  }

  async function fetchGet<TRes>(endpoint: string) {
    const result = await supertest(api.server).get(endpoint);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
  }

  describe('PoX-2 - Stacking operations (P2WPKH) segwit', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcRegtestAddr: string;
    let btcPubKey: string;
    let decodedBtcAddr: { version: number; data: Buffer };
    let poxInfo: CoreRpcPoxInfo;
    let burnBlockHeight: number;
    let cycleBlockLength: number;
    let contractAddress: string;
    let contractName: string;
    let ustxAmount: bigint;
    const cycleCount = 1;
    const btcPrivateKey = '0000000000000000000000000000000000000000000000000000000000000002';
    let rpcClient: RPCClient;

    beforeAll(async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2wpkh',
      });
      expect(btcAddr).toBe('tb1qq6hag67dl53wl99vzg42z8eyzfz2xlkvvlryfj');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      decodedBtcAddr = poxHelpers.decodeBtcAddress(btcAddr);
      expect({
        data: decodedBtcAddr.data.toString('hex'),
        version: decodedBtcAddr.version,
      }).toEqual({ data: '06afd46bcdfd22ef94ac122aa11f241244a37ecc', version: 4 });

      rpcClient = getRpcClient();

      poxInfo = await client.getPox();
      burnBlockHeight = poxInfo.current_burnchain_block_height as number;

      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;

      [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox-2');
    });

    test('stack-stx tx', async () => {
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
      const txStandby1 = standByForTx(expectedTxId1);
      const sendResult1 = await client.sendTransaction(tx1.serialize());
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await txStandby1;
      expect(dbTx1.status).toBe(DbTxStatus.Success);
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

      await standByUntilBlock(dbTx1.block_height + 1);
    });

    test('stack-increase tx', async () => {
      // Create and broadcast a `stack-increase` tx
      const stackIncreaseAmount = 123n;
      const tx2 = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-increase',
        functionArgs: [uintCV(stackIncreaseAmount)],
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId2 = '0x' + tx2.txid();
      const txStandby2 = standByForTx(expectedTxId2);
      const sendResult2 = await client.sendTransaction(tx2.serialize());
      expect(sendResult2.txId).toBe(expectedTxId2);

      const dbTx2 = await txStandby2;
      expect(dbTx2.status).toBe(DbTxStatus.Success);
      const tx2Events = await api.datastore.getTxEvents({
        txId: dbTx2.tx_id,
        indexBlockHash: dbTx2.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx2Events.results).toBeTruthy();
      const lockEvent2 = tx2Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent2).toBeDefined();

      // Test that the locked STX amount has increased
      const expectedLockedAmount2 = ustxAmount + stackIncreaseAmount;
      expect(lockEvent2.locked_amount).toBe(expectedLockedAmount2);

      // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
      const rpcAccountInfo2 = await client.getAccount(account.stacksAddress);
      const expectedUnlockHeight2 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height;
      expect(BigInt(rpcAccountInfo2.locked)).toBe(expectedLockedAmount2);
      expect(rpcAccountInfo2.unlock_height).toBe(expectedUnlockHeight2);

      // Test the API address balance data after a `stack-increase` operation
      const addrBalance2 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance2.locked).toBe(expectedLockedAmount2.toString());
      expect(addrBalance2.burnchain_unlock_height).toBe(expectedUnlockHeight2);
      expect(addrBalance2.lock_height).toBe(dbTx2.block_height);
      expect(addrBalance2.lock_tx_id).toBe(dbTx2.tx_id);
    });

    test('stack-extend tx', async () => {
      // Create and broadcast a `stack-extend` tx
      const extendCycleAmount = 1;
      const tx3 = await makeContractCall({
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
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const expectedTxId3 = '0x' + tx3.txid();
      const txStandby3 = standByForTx(expectedTxId3);
      const sendResult3 = await client.sendTransaction(tx3.serialize());
      expect(sendResult3.txId).toBe(expectedTxId3);

      const dbTx3 = await txStandby3;
      expect(dbTx3.status).toBe(DbTxStatus.Success);
      const tx3Events = await api.datastore.getTxEvents({
        txId: dbTx3.tx_id,
        indexBlockHash: dbTx3.index_block_hash,
        limit: 99999,
        offset: 0,
      });
      expect(tx3Events.results).toBeTruthy();
      const lockEvent3 = tx3Events.results.find(
        r => r.event_type === DbEventTypeId.StxLock
      ) as DbStxLockEvent;
      expect(lockEvent3).toBeDefined();

      // Test that the unlock height event data in the API db matches the expected height from the
      // calculated values from the /v2/pox data and the cycle amount specified in the `stack-extend` tx.
      const extendBlockCount = extendCycleAmount * poxInfo.reward_cycle_length;
      const expectedUnlockHeight2 =
        cycleBlockLength + poxInfo.next_cycle.reward_phase_start_block_height + extendBlockCount;
      expect(lockEvent3.unlock_height).toBe(expectedUnlockHeight2);

      // Test that the locked event data in the API db matches the data returned from the RPC /v2/accounts/<addr> endpoint
      const rpcAccountInfo3 = await client.getAccount(account.stacksAddress);
      expect(rpcAccountInfo3.unlock_height).toBe(expectedUnlockHeight2);

      // Test the API address balance data after a `stack-extend` operation
      const addrBalance3 = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance3.burnchain_unlock_height).toBe(expectedUnlockHeight2);
      expect(addrBalance3.lock_height).toBe(dbTx3.block_height);
      expect(addrBalance3.lock_tx_id).toBe(dbTx3.tx_id);
    });

    test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
      // Wait until end of prepare phase
      const preparePhaseEndBurnBlock =
        poxInfo.next_cycle.prepare_phase_start_block_height +
        poxInfo.prepare_phase_block_length +
        1;
      await standByUntilBurnBlock(preparePhaseEndBurnBlock);

      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${btcAddr}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(btcAddr);
      expect(rewardSlotHolders.results[0].burn_block_height).toBeGreaterThanOrEqual(
        poxInfo.next_cycle.prepare_phase_start_block_height
      );
      expect(rewardSlotHolders.results[0].burn_block_height).toBeLessThanOrEqual(
        preparePhaseEndBurnBlock
      );
    });

    test('stacking rewards - API /burnchain/rewards', async () => {
      // Wait until end of reward phase
      const rewardPhaseEndBurnBlock =
        poxInfo.next_cycle.reward_phase_start_block_height + poxInfo.reward_phase_block_length + 1;
      await standByUntilBurnBlock(rewardPhaseEndBurnBlock);
      const rewards = await fetchGet<BurnchainRewardListResponse>(
        `/extended/v1/burnchain/rewards/${btcAddr}`
      );
      expect(rewards.results.length).toBe(1);
      expect(rewards.results[0].reward_recipient).toBe(btcAddr);
      expect(Number(rewards.results[0].burn_amount)).toBeGreaterThan(0);
      expect(rewards.results[0].burn_block_height).toBeGreaterThanOrEqual(
        poxInfo.next_cycle.reward_phase_start_block_height
      );
      expect(rewards.results[0].burn_block_height).toBeLessThanOrEqual(rewardPhaseEndBurnBlock);

      const rewardsTotal = await fetchGet<BurnchainRewardsTotal>(
        `/extended/v1/burnchain/rewards/${btcAddr}/total`
      );
      expect(rewardsTotal.reward_recipient).toBe(btcAddr);
      expect(Number(rewardsTotal.reward_amount)).toBeGreaterThan(0);
    });

    test('stx unlocked - RPC balance endpoint', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccountInfo1 = await client.getAccount(account.stacksAddress);
      let burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
      // TODO: wait one more block due to test flakiness.. Q for stacks-node, why does the account take an extra block for STX to unlock?
      burnBlockUnlockHeight++;
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

    test.skip('BTC stacking reward received', () => {
      // TODO: check that BTC reward tx has been send via bitcoind json-rpc query
      // curl --user myusername --data-binary '{"jsonrpc": "1.0", "id": "curltest", "method": "getblock", "params": ["00000000c937983704a73af28acdec37b049d214adbda81d7e2a3dd146f6ed09"]}' -H 'content-type: text/plain;' http://127.0.0.1:8332/
    });
  });

  test.skip('PoX-2 - stack to P2TR address', () => {
    // TODO
  });

  test.skip('PoX-2 - stack to P2WPKH address', () => {
    // TODO
  });

  test.skip('PoX-2 - stack to P2WSH address', () => {
    // TODO
  });
});
