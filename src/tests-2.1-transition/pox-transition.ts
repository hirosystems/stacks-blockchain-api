/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { TestEnvContext } from './env-setup';
import { ApiServer } from '../api/init';
import * as supertest from 'supertest';
import { DbBlock, DbEventTypeId, DbStxLockEvent, DbTx, DbTxStatus } from '../datastore/common';
import {
  getAddressFromPrivateKey,
  makeSTXTokenTransfer,
  AnchorMode,
  bufferCV,
  makeContractCall,
  noneCV,
  someCV,
  standardPrincipalCV,
  TransactionVersion,
  TupleCV,
  tupleCV,
  uintCV,
  ClarityValue,
} from '@stacks/transactions';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { testnetKeys } from '../api/routes/debug';
import * as poxHelpers from '../pox-helpers';
import { coerceToBuffer, hexToBuffer, stxToMicroStx, timeout } from '../helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { StacksNetwork } from '@stacks/network';
import {
  ECPair,
  getBitcoinAddressFromKey,
  privateToPublicKey,
  VerboseKeyOutput,
} from '../ec-helpers';
import {
  AddressStxBalanceResponse,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
  ServerStatusResponse,
} from '@stacks/stacks-blockchain-api-types';
import { RPCClient } from 'rpc-bitcoin';
import bignumber from 'bignumber.js';
import {
  ClarityTypeID,
  ClarityValue as NativeClarityValue,
  ClarityValueBoolTrue,
  ClarityValuePrincipalStandard,
  ClarityValueResponseOk,
  ClarityValueTuple,
  ClarityValueUInt,
  decodeClarityValue,
} from 'stacks-encoding-native-js';

type Account = {
  secretKey: string;
  pubKey: string;
  stxAddr: string;
  btcAddr: string;
  btcTestnetAddr: string;
  poxAddr: { version: number; data: Buffer };
  poxAddrClar: TupleCV;
  wif: string;
};

describe('PoX-2 tests', () => {
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

  async function standByForTx(expectedTxId: string): Promise<DbTx> {
    const tx = await new Promise<DbTx>(async resolve => {
      const listener: (txId: string) => void = async txId => {
        if (txId !== expectedTxId) {
          return;
        }
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

      // Check if tx is already received
      const dbTxQuery = await api.datastore.getTx({ txId: expectedTxId, includeUnanchored: false });
      if (dbTxQuery.found) {
        api.datastore.eventEmitter.removeListener('txUpdate', listener);
        resolve(dbTxQuery.result);
      }
    });

    // Ensure stacks-node is caught up with processing the block for this tx
    while (true) {
      const nodeInfo = await client.getInfo();
      if (nodeInfo.stacks_tip_height >= tx.block_height) {
        break;
      } else {
        await timeout(50);
      }
    }
    return tx;
  }

  async function standByForTxSuccess(expectedTxId: string): Promise<DbTx> {
    const tx = await standByForTx(expectedTxId);
    if (tx.status !== DbTxStatus.Success) {
      const txResult = decodeClarityValue(tx.raw_result);
      const resultRepr = txResult.repr;
      throw new Error(`Tx failed with status ${tx.status}, result: ${resultRepr}`);
    }
    return tx;
  }

  async function standByUntilBlock(blockHeight: number): Promise<DbBlock> {
    const dbBlock = await new Promise<DbBlock>(async resolve => {
      const listener: (blockHash: string) => void = async blockHash => {
        const dbBlockQuery = await api.datastore.getBlock({ hash: blockHash });
        if (!dbBlockQuery.found || dbBlockQuery.result.block_height < blockHeight) {
          return;
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlockQuery.result);
      };
      api.datastore.eventEmitter.addListener('blockUpdate', listener);

      // Check if block height already reached
      const curHeight = await api.datastore.getCurrentBlockHeight();
      if (curHeight.found && curHeight.result >= blockHeight) {
        const dbBlock = await api.datastore.getBlock({ height: curHeight.result });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlock.result);
        return;
      }
    });

    // Ensure stacks-node is caught up with processing this block
    while (true) {
      const nodeInfo = await client.getInfo();
      if (nodeInfo.stacks_tip_height >= blockHeight) {
        break;
      } else {
        await timeout(50);
      }
    }
    return dbBlock;
  }

  async function standByUntilBurnBlock(burnBlockHeight: number): Promise<DbBlock> {
    const dbBlock = await new Promise<DbBlock>(async resolve => {
      const listener: (blockHash: string) => void = async blockHash => {
        const dbBlockQuery = await api.datastore.getBlock({ hash: blockHash });
        if (!dbBlockQuery.found || dbBlockQuery.result.burn_block_height < burnBlockHeight) {
          return;
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlockQuery.result);
      };
      api.datastore.eventEmitter.addListener('blockUpdate', listener);

      // Check if block height already reached
      const curHeight = await api.datastore.getCurrentBlock();
      if (curHeight.found && curHeight.result.burn_block_height >= burnBlockHeight) {
        const dbBlock = await api.datastore.getBlock({ height: curHeight.result.block_height });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlock.result);
      }
    });

    // Ensure stacks-node is caught up with processing this block
    while (true) {
      const nodeInfo = await client.getInfo();
      if (nodeInfo.stacks_tip_height >= dbBlock.block_height) {
        break;
      } else {
        await timeout(50);
      }
    }
    return dbBlock;
  }

  async function standByForPoxCycle(): Promise<CoreRpcPoxInfo> {
    const firstPoxInfo = await client.getPox();
    let lastPoxInfo: CoreRpcPoxInfo = JSON.parse(JSON.stringify(firstPoxInfo));
    do {
      await standByUntilBurnBlock(lastPoxInfo.current_burnchain_block_height! + 1);
      lastPoxInfo = await client.getPox();
    } while (lastPoxInfo.current_cycle.id <= firstPoxInfo.current_cycle.id);
    expect(lastPoxInfo.current_cycle.id).toBe(firstPoxInfo.next_cycle.id);
    const info = await client.getInfo();
    console.log({
      'firstPoxInfo.next_cycle.prepare_phase_start_block_height':
        firstPoxInfo.next_cycle.prepare_phase_start_block_height,
      'lastPoxInfo.current_burnchain_block_height': lastPoxInfo.current_burnchain_block_height,
      'info.burn_block_height': info.burn_block_height,
    });
    return lastPoxInfo;
  }

  async function standByForNextPoxCycle(): Promise<CoreRpcPoxInfo> {
    const firstPoxInfo = await client.getPox();
    await standByUntilBurnBlock(firstPoxInfo.next_cycle.prepare_phase_start_block_height);
    const lastPoxInfo = await client.getPox();
    const info = await client.getInfo();
    console.log({
      'firstPoxInfo.next_cycle.prepare_phase_start_block_height':
        firstPoxInfo.next_cycle.prepare_phase_start_block_height,
      'lastPoxInfo.current_burnchain_block_height': lastPoxInfo.current_burnchain_block_height,
      'info.burn_block_height': info.burn_block_height,
    });
    return lastPoxInfo;
  }

  async function standByForPoxCycleEnd(): Promise<CoreRpcPoxInfo> {
    const firstPoxInfo = await client.getPox();
    if (
      firstPoxInfo.current_burnchain_block_height ===
      firstPoxInfo.next_cycle.prepare_phase_start_block_height
    ) {
      await standByUntilBurnBlock(firstPoxInfo.current_burnchain_block_height + 1);
    }
    const nextCycleInfo = await standByForNextPoxCycle();
    if (
      firstPoxInfo.current_burnchain_block_height === nextCycleInfo.current_burnchain_block_height
    ) {
      throw new Error(
        `standByForPoxCycleEnd bug: burn height did not increase from ${firstPoxInfo.current_burnchain_block_height}`
      );
    }
    return nextCycleInfo;
  }

  async function fetchGet<TRes>(endpoint: string) {
    const result = await supertest(api.server).get(endpoint);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
  }

  async function readOnlyFnCall<T extends NativeClarityValue>(
    contract: string | [string, string],
    fnName: string,
    args?: ClarityValue[],
    sender?: string,
    unwrap = true
  ): Promise<T> {
    const [contractAddr, contractName] =
      typeof contract === 'string' ? contract.split('.') : contract;
    const callResp = await client.sendReadOnlyContractCall(
      contractAddr,
      contractName,
      fnName,
      sender ?? testnetKeys[0].stacksAddress,
      args ?? []
    );
    if (!callResp.okay) {
      throw new Error(`Failed to call ${contract}::${fnName}`);
    }
    const decodedVal = decodeClarityValue<T>(callResp.result);
    if (unwrap) {
      if (decodedVal.type_id === ClarityTypeID.OptionalSome) {
        return decodedVal.value as T;
      }
      if (decodedVal.type_id === ClarityTypeID.ResponseOk) {
        return decodedVal.value as T;
      }
      if (decodedVal.type_id === ClarityTypeID.OptionalNone) {
        throw new Error(`OptionNone result for call to ${contract}::${fnName}`);
      }
      if (decodedVal.type_id === ClarityTypeID.ResponseError) {
        throw new Error(
          `ResultError result for call to ${contract}::${fnName}: ${decodedVal.repr}`
        );
      }
    }
    return decodedVal;
  }

  function accountFromKey(privateKey: string): Account {
    const privKeyBuff = coerceToBuffer(privateKey);
    if (privKeyBuff.byteLength !== 33) {
      throw new Error('Only compressed private keys supported');
    }
    const ecPair = ECPair.fromPrivateKey(privKeyBuff.slice(0, 32), { compressed: true });
    const secretKey = ecPair.privateKey!.toString('hex') + '01';
    if (secretKey.slice(0, 64) !== privateKey.slice(0, 64)) {
      throw new Error(`key mismatch`);
    }
    const pubKey = ecPair.publicKey.toString('hex');
    const stxAddr = getAddressFromPrivateKey(secretKey, TransactionVersion.Testnet);
    const btcAccount = getBitcoinAddressFromKey({
      privateKey: ecPair.privateKey!,
      network: 'regtest',
      addressFormat: 'p2pkh',
      verbose: true,
    });
    const btcAddr = btcAccount.address;
    const poxAddr = poxHelpers.decodeBtcAddress(btcAddr);
    const poxAddrClar = tupleCV({
      hashbytes: bufferCV(poxAddr.data),
      version: bufferCV(Buffer.from([poxAddr.version])),
    });
    const wif = btcAccount.wif;
    const btcTestnetAddr = getBitcoinAddressFromKey({
      privateKey: ecPair.privateKey!,
      network: 'testnet',
      addressFormat: 'p2pkh',
    });
    return { secretKey, pubKey, stxAddr, poxAddr, poxAddrClar, btcAddr, btcTestnetAddr, wif };
  }

  describe('PoX-1 - Stacking operations P2SH-P2WPKH', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcRegtestAccount: VerboseKeyOutput;
    let btcPubKey: string;
    let decodedBtcAddr: { version: number; data: Buffer };
    let poxInfo: CoreRpcPoxInfo;
    let burnBlockHeight: number;
    let cycleBlockLength: number;
    let contractAddress: string;
    let contractName: string;
    let ustxAmount: bigint;
    const cycleCount = 12;
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

      decodedBtcAddr = poxHelpers.decodeBtcAddress(btcAddr);
      expect({
        data: decodedBtcAddr.data.toString('hex'),
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

      poxInfo = await client.getPox();
      burnBlockHeight = poxInfo.current_burnchain_block_height as number;

      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = cycleCount * poxInfo.reward_cycle_length;

      [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox');
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
      const sendResult1 = await client.sendTransaction(tx1.serialize());
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

    test('stacking rewards - API /burnchain/reward_slot_holders', async () => {
      // Wait until end of prepare phase
      const preparePhaseEndBurnBlock =
        poxInfo.next_cycle.prepare_phase_start_block_height +
        poxInfo.prepare_phase_block_length +
        1;
      await standByForPoxCycle();

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
      await standByForPoxCycle();
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
      expect(firstReward.burn_block_height).toBeLessThanOrEqual(rewardPhaseEndBurnBlock);

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
        tx: { vout?: { scriptPubKey: { addresses?: string[] }; value?: number }[] }[];
      } = await bitcoinRpcClient.getblock({
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
      }[] = await bitcoinRpcClient.listtransactions({
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

    test('stx unlock at pox_v1_unlock_height on block', async () => {
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
          expect(poxInfo.current_burnchain_block_height).toBe(status.pox_v1_unlock_height! + 1);
          expect(poxInfo.current_burnchain_block_height).toBe(
            poxInfo.contract_versions![1].activation_burnchain_block_height + 1
          );
          break;
        }
        await standByUntilBlock(info.stacks_tip_height + 1);
      }
    });

    test.skip('stx unlocked - RPC balance endpoint', async () => {
      // Wait until account has unlocked (finished Stacking cycles)
      const rpcAccountInfo1 = await client.getAccount(account.stacksAddress);
      const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;
      const dbBlock1 = await standByUntilBurnBlock(burnBlockUnlockHeight);

      // Check that STX are no longer reported as locked by the RPC endpoints:
      const rpcAccountInfo = await client.getAccount(account.stacksAddress);
      expect(BigInt(rpcAccountInfo.locked)).toBe(0n);
      expect(rpcAccountInfo.unlock_height).toBe(0);
    });

    test.skip('stx unlocked - API balance endpoint', async () => {
      // Check that STX are no longer reported as locked by the API endpoints:
      const addrBalance = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(BigInt(addrBalance.locked)).toBe(0n);
      expect(addrBalance.burnchain_unlock_height).toBe(0);
      expect(addrBalance.lock_height).toBe(0);
      expect(addrBalance.lock_tx_id).toBe('');
    });

    test.skip('BTC stacking reward received', async () => {
      const received: number = await bitcoinRpcClient.getreceivedbyaddress({
        address: btcRegtestAccount.address,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });
});
