/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { TestEnvContext } from './env-setup';
import { ApiServer } from '../api/init';
import * as supertest from 'supertest';
import { Server } from 'net';
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
  UIntCV,
  ClarityValue,
} from '@stacks/transactions';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { testnetKeys } from '../api/routes/debug';
import * as poxHelpers from '../pox-helpers';
import { coerceToBuffer, hexToBuffer, parsePort, stxToMicroStx, timeout } from '../helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { StacksNetwork } from '@stacks/network';
import * as btcLib from 'bitcoinjs-lib';
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
} from '@stacks/stacks-blockchain-api-types';
import { RPCClient } from 'rpc-bitcoin';
import bignumber from 'bignumber.js';
import {
  ClarityTypeID,
  ClarityValue as NativeClarityValue,
  ClarityValueCommon,
  ClarityValueOptional,
  ClarityValueOptionalSome,
  ClarityValuePrincipalStandard,
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

  async function standByUntilBlock(blockHeight: number): Promise<DbBlock> {
    const dbBlock = await new Promise<DbBlock>(async resolve => {
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
    while (true) {
      const nodeInfo = await client.getInfo();
      if (nodeInfo.stacks_tip_height >= blockHeight) {
        break;
      } else {
        await timeout(100);
      }
    }
    return dbBlock;
  }

  async function standByUntilBurnBlock(burnBlockHeight: number): Promise<DbBlock> {
    const dbBlock = await new Promise<DbBlock>(async resolve => {
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
    while (true) {
      const nodeInfo = await client.getInfo();
      if (nodeInfo.stacks_tip_height >= dbBlock.block_height) {
        break;
      } else {
        await timeout(100);
      }
    }
    return dbBlock;
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

  describe('PoX-2 - handle-unlock for missed reward slots', () => {
    const seedKey = testnetKeys[3].secretKey;
    let seedAccount: Account;
    let poxInfo: CoreRpcPoxInfo;
    let contractAddress: string;
    let contractName: string;

    beforeAll(() => {
      seedAccount = accountFromKey(seedKey);
    });

    test('Get pox-info', async () => {
      poxInfo = await client.getPox();
      [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox-2');
      await standByUntilBurnBlock(poxInfo.current_burnchain_block_height! + 1);
    });

    test('Perform stack-stx with less than min required stacking amount', async () => {
      // use half the required min amount of stx
      const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 0.5).toString());
      const burnBlockHeight = poxInfo.current_burnchain_block_height as number;
      const cycleCount = 1;
      // Create and broadcast a `stack-stx` tx
      const tx1 = await makeContractCall({
        senderKey: seedAccount.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-stx',
        functionArgs: [
          uintCV(ustxAmount.toString()),
          seedAccount.poxAddrClar,
          uintCV(burnBlockHeight),
          uintCV(cycleCount),
        ],
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const sendResult1 = await client.sendTransaction(tx1.serialize());
      const txStandby1 = await standByForTx(sendResult1.txId);
      expect(txStandby1.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(txStandby1.block_height);

      // validate stacks-node balance state
      const coreBalance = await client.getAccount(seedAccount.stxAddr);
      expect(BigInt(coreBalance.locked)).toBe(ustxAmount);

      // validate the pox2 event for this tx
      const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${sendResult1.txId}`);
      expect(res).toBeDefined();
      expect(res.results).toHaveLength(1);
      expect(res.results[0]).toEqual(
        expect.objectContaining({
          name: 'stack-stx',
          pox_addr: seedAccount.btcTestnetAddr,
          stacker: seedAccount.stxAddr,
          balance: BigInt(coreBalance.balance).toString(),
          locked: ustxAmount.toString(),
          burnchain_unlock_height: coreBalance.unlock_height.toString(),
        })
      );
      expect(res.results[0].data).toEqual(
        expect.objectContaining({
          lock_period: '1',
          lock_amount: ustxAmount.toString(),
        })
      );

      // TODO: validate API balance state
    });

    test('Wait for current pox cycle to complete', async () => {
      const poxInfo2 = await client.getPox();
      // Wait until end of reward phase
      const rewardPhaseEndBurnBlock =
        poxInfo2.next_cycle.reward_phase_start_block_height +
        poxInfo2.reward_phase_block_length +
        1;
      await standByUntilBurnBlock(rewardPhaseEndBurnBlock);
    });

    test('Validate pox2 handle-unlock for stacker', async () => {
      const coreBalance = await client.getAccount(seedAccount.stxAddr);
      expect(BigInt(coreBalance.balance)).toBeGreaterThan(0n);
      expect(BigInt(coreBalance.locked)).toBe(0n);
      expect(coreBalance.unlock_height).toBe(0);
      const res: any = await fetchGet(`/extended/v1/pox2_events/stacker/${seedAccount.stxAddr}`);
      const unlockEvent = res.results.find((r: any) => r.name === 'handle-unlock');
      expect(unlockEvent).toBeDefined();
      expect(unlockEvent).toEqual(
        expect.objectContaining({
          name: 'handle-unlock',
          stacker: seedAccount.stxAddr,
          balance: BigInt(coreBalance.balance).toString(),
          locked: '0',
          burnchain_unlock_height: '0',
        })
      );
    });

    test('Check pox2 events endpoint', async () => {
      // TODO: endpoint to get pox2_events for a specific address, then test the parsed events after each operation
      // TODO: check the extended rewards endpoints and the bitcoind RPC balance endpoints
      // TODO: validate Stacks RPC account locked state matches the extended endpoint after each operation
      const res = await fetchGet(`/extended/v1/pox2_events`);
      expect(res).toBeDefined();
    });
  });

  describe('PoX-2 - Delegate Stacking operations', () => {
    const seedKey = testnetKeys[4].secretKey;
    const delegatorKey = '72e8e3725324514c38c2931ed337ab9ab8d8abaae83ed2275456790194b1fd3101';
    const delegateeKey = '0d174cf0be276cedcf21727611ef2504aed093d8163f65985c07760fda12a7ea01';

    const stxToDelegateIncrease = 2000n;

    let seedAccount: Account;
    let delegatorAccount: Account;
    let delegateeAccount: Account;

    let poxInfo: CoreRpcPoxInfo;
    let contractAddress: string;
    let contractName: string;

    beforeAll(() => {
      seedAccount = accountFromKey(seedKey);
      delegatorAccount = accountFromKey(delegatorKey);
      delegateeAccount = accountFromKey(delegateeKey);
    });

    test('Import testing accounts to bitcoind', async () => {
      // register delegate accounts to bitcoind wallet
      // TODO: only one of these (delegatee ?) should be required..
      for (const account of [delegatorAccount, delegateeAccount]) {
        await bitcoinRpcClient.importprivkey({
          privkey: account.wif,
          label: account.btcAddr,
          rescan: false,
        });
      }
    });

    test('Get pox-info', async () => {
      poxInfo = await client.getPox();
      [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox-2');
      // wait until the start of the next cycle so we have enough blocks within the cycle to perform the various txs
      await standByUntilBurnBlock(poxInfo.next_cycle.prepare_phase_start_block_height);
    });

    test('Seed delegate accounts', async () => {
      // transfer 10 STX (for tx fees) from seed to delegator account
      const gasAmount = stxToMicroStx(100);
      const stxXfer1 = await makeSTXTokenTransfer({
        senderKey: seedAccount.secretKey,
        recipient: delegatorAccount.stxAddr,
        amount: gasAmount,
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 200,
      });
      const { txId: stxXferId1 } = await client.sendTransaction(stxXfer1.serialize());
      const stxXferTx1 = await standByForTx(stxXferId1);
      expect(stxXferTx1.status).toBe(DbTxStatus.Success);
      expect(stxXferTx1.token_transfer_recipient_address).toBe(delegatorAccount.stxAddr);

      // ensure stacks-node is caught up
      await standByUntilBlock(stxXferTx1.block_height);

      // transfer pox "min_amount_ustx" from seed to delegatee account
      const stackingAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      const stxXfer2 = await makeSTXTokenTransfer({
        senderKey: seedAccount.secretKey,
        recipient: delegateeAccount.stxAddr,
        amount: stackingAmount,
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 200,
      });
      const { txId: stxXferId2 } = await client.sendTransaction(stxXfer2.serialize());
      const stxXferTx2 = await standByForTx(stxXferId2);
      expect(stxXferTx2.status).toBe(DbTxStatus.Success);
      expect(stxXferTx2.token_transfer_recipient_address).toBe(delegateeAccount.stxAddr);

      // ensure stacks-node is caught up
      await standByUntilBlock(stxXferTx2.block_height);

      // ensure delegator account balance is correct
      const delegatorBalance = await client.getAccountBalance(delegatorAccount.stxAddr);
      expect(delegatorBalance.toString()).toBe(gasAmount.toString());

      // ensure delegatee account balance is correct
      const delegateeBalance = await client.getAccountBalance(delegateeAccount.stxAddr);
      expect(delegateeBalance.toString()).toBe(stackingAmount.toString());
    });

    test('Perform delegate-stx operation', async () => {
      const txFee = 10000n;
      const balanceInfo = await client.getAccount(delegateeAccount.stxAddr);
      const balanceTotal = BigInt(balanceInfo.balance);
      expect(balanceTotal).toBeGreaterThan(txFee);
      const balanceLocked = BigInt(balanceInfo.locked);
      expect(balanceLocked).toBe(0n);
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
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
        validateWithAbi: false,
      });
      const { txId: delegateStxTxId } = await client.sendTransaction(delegateStxTx.serialize());
      const delegateStxDbTx = await standByForTx(delegateStxTxId);
      expect(delegateStxDbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(delegateStxDbTx.block_height);

      // check delegatee locked amount is still zero
      const balanceInfo2 = await client.getAccount(delegateeAccount.stxAddr);
      expect(BigInt(balanceInfo2.locked)).toBe(0n);
    });

    test('Perform delegate-stack-stx operation', async () => {
      // get amount delegated
      const getDelegationInfo1 = await readOnlyFnCall<
        ClarityValueTuple<{ 'amount-ustx': ClarityValueUInt }>
      >(
        [contractAddress, contractName],
        'get-delegation-info',
        [standardPrincipalCV(delegateeAccount.stxAddr)],
        delegateeAccount.stxAddr
      );
      const amountDelegated = BigInt(getDelegationInfo1.data['amount-ustx'].value);
      expect(amountDelegated).toBeGreaterThan(0n);

      const amountToDelegateInitial = amountDelegated - stxToDelegateIncrease;

      const poxInfo2 = await client.getPox();

      /*
      // get burn height of next reward cycle id
      const nextRewardCycleHeight = await readOnlyFnCall<ClarityValueUInt>(
        [contractAddress, contractName],
        'reward-cycle-to-burn-height',
        [uintCV(poxInfo2.next_cycle.id)]
      ).then(v => BigInt(v.value));

      const burnHeightToRewardCycle = await readOnlyFnCall<ClarityValueUInt>(
        [contractAddress, contractName],
        'burn-height-to-reward-cycle',
        [uintCV(nextRewardCycleHeight)]
      ).then(v => BigInt(v.value));

      const currentPoxRewardCycle = await readOnlyFnCall<ClarityValueUInt>(
        [contractAddress, contractName],
        'current-pox-reward-cycle'
      ).then(v => BigInt(v.value));

      expect(burnHeightToRewardCycle).toBeGreaterThan(currentPoxRewardCycle);
      const startBurnHt = nextRewardCycleHeight;
      */

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
          uintCV(1), // lock-period
        ],
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
        validateWithAbi: false,
      });
      const { txId: delegateStackStxTxId } = await client.sendTransaction(
        delegateStackStxTx.serialize()
      );
      const delegateStackStxDbTx = await standByForTx(delegateStackStxTxId);
      expect(delegateStackStxDbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(delegateStackStxDbTx.block_height);

      // validate stacks-node balance
      const coreBalanceInfo = await client.getAccount(delegateeAccount.stxAddr);
      expect(BigInt(coreBalanceInfo.locked)).toBe(amountToDelegateInitial);
      expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

      // validate delegate-stack-stx pox2 event for this tx
      const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${delegateStackStxTxId}`);
      expect(res).toBeDefined();
      expect(res.results).toHaveLength(1);
      expect(res.results[0]).toEqual(
        expect.objectContaining({
          name: 'delegate-stack-stx',
          pox_addr: delegateeAccount.btcTestnetAddr,
          stacker: delegateeAccount.stxAddr,
          balance: BigInt(coreBalanceInfo.balance).toString(),
          locked: amountToDelegateInitial.toString(),
          burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
        })
      );
      expect(res.results[0].data).toEqual(
        expect.objectContaining({
          lock_period: '1',
          lock_amount: amountToDelegateInitial.toString(),
        })
      );

      // TODO: validate API endpoint balance state for account
    });

    test('Perform delegate-stack-increase', async () => {
      const coreBalanceInfoPreIncrease = await client.getAccount(delegateeAccount.stxAddr);

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
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
        validateWithAbi: false,
      });
      const { txId: delegateStackIncreaseTxId } = await client.sendTransaction(
        delegateStackIncreaseTx.serialize()
      );
      const delegateStackIncreaseDbTx = await standByForTx(delegateStackIncreaseTxId);
      expect(delegateStackIncreaseDbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(delegateStackIncreaseDbTx.block_height);

      // validate stacks-node balance
      const coreBalanceInfo = await client.getAccount(delegateeAccount.stxAddr);
      expect(BigInt(coreBalanceInfo.locked)).toBe(
        BigInt(coreBalanceInfoPreIncrease.locked) + stxToDelegateIncrease
      );
      expect(BigInt(coreBalanceInfo.balance)).toBe(
        BigInt(coreBalanceInfoPreIncrease.balance) - stxToDelegateIncrease
      );
      expect(coreBalanceInfo.unlock_height).toBeGreaterThan(0);

      // validate delegate-stack-stx pox2 event for this tx
      const res: any = await fetchGet(
        `/extended/v1/pox2_events/tx/${delegateStackIncreaseDbTx.tx_id}`
      );
      expect(res).toBeDefined();
      expect(res.results).toHaveLength(1);
      expect(res.results[0]).toEqual(
        expect.objectContaining({
          name: 'delegate-stack-increase',
          pox_addr: delegateeAccount.btcTestnetAddr,
          stacker: delegateeAccount.stxAddr,
          balance: BigInt(coreBalanceInfo.balance).toString(),
          locked: BigInt(coreBalanceInfo.locked).toString(),
          burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
        })
      );
      expect(res.results[0].data).toEqual(
        expect.objectContaining({
          delegator: delegatorAccount.stxAddr,
          increase_by: stxToDelegateIncrease.toString(),
          total_locked: BigInt(coreBalanceInfo.locked).toString(),
        })
      );

      // TODO: validate API endpoint balance state for account
    });

    test('Perform delegate-stack-extend', async () => {
      const coreBalanceInfoPreIncrease = await client.getAccount(delegateeAccount.stxAddr);

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
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
        validateWithAbi: false,
      });
      const { txId: delegateStackExtendTxId } = await client.sendTransaction(
        delegateStackExtendTx.serialize()
      );
      const delegateStackExtendDbTx = await standByForTx(delegateStackExtendTxId);
      expect(delegateStackExtendDbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(delegateStackExtendDbTx.block_height);

      // validate stacks-node balance
      const coreBalanceInfo = await client.getAccount(delegateeAccount.stxAddr);
      expect(BigInt(coreBalanceInfo.locked)).toBeGreaterThan(0n);
      expect(BigInt(coreBalanceInfo.balance)).toBeGreaterThan(0n);
      expect(coreBalanceInfo.unlock_height).toBeGreaterThan(
        coreBalanceInfoPreIncrease.unlock_height
      );

      // validate delegate-stack-extend pox2 event for this tx
      const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${delegateStackExtendTxId}`);
      expect(res).toBeDefined();
      expect(res.results).toHaveLength(1);
      expect(res.results[0]).toEqual(
        expect.objectContaining({
          name: 'delegate-stack-extend',
          pox_addr: delegateeAccount.btcTestnetAddr,
          stacker: delegateeAccount.stxAddr,
          balance: BigInt(coreBalanceInfo.balance).toString(),
          locked: BigInt(coreBalanceInfo.locked).toString(),
          burnchain_unlock_height: coreBalanceInfo.unlock_height.toString(),
        })
      );
      expect(res.results[0].data).toEqual(
        expect.objectContaining({
          delegator: delegatorAccount.stxAddr,
          extend_count: extendCount.toString(),
          unlock_burn_height: coreBalanceInfo.unlock_height.toString(),
        })
      );

      // TODO: validate API endpoint balance state for account
    });

    test('Perform stack-aggregation-commit - delegator commit to stacking operation', async () => {
      const poxInfo2 = await client.getPox();
      const rewardCycle = BigInt(poxInfo2.next_cycle.id);
      const stackAggrCommitTx = await makeContractCall({
        senderKey: delegatorAccount.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-aggregation-commit',
        functionArgs: [
          delegateeAccount.poxAddrClar, // pox-addr
          uintCV(rewardCycle), // reward-cycle
        ],
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: 10000,
        validateWithAbi: false,
      });
      const { txId: stackAggrCommitTxId } = await client.sendTransaction(
        stackAggrCommitTx.serialize()
      );
      const stackAggrCommmitDbTx = await standByForTx(stackAggrCommitTxId);
      expect(stackAggrCommmitDbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(stackAggrCommmitDbTx.block_height);

      // validate stack-aggregation-commit pox2 event for this tx
      const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${stackAggrCommitTxId}`);
      expect(res).toBeDefined();
      expect(res.results).toHaveLength(1);
      expect(res.results[0]).toEqual(
        expect.objectContaining({
          name: 'stack-aggregation-commit',
          pox_addr: delegateeAccount.btcTestnetAddr,
          stacker: delegatorAccount.stxAddr,
        })
      );
    });

    test('Wait for current pox cycle to complete', async () => {
      const waitForCurrentPoxCycleComplete = async () => {
        const firstPoxInfo = await client.getPox();
        // Wait until end of reward phase
        const rewardPhaseEndBurnBlock =
          firstPoxInfo.next_cycle.reward_phase_start_block_height +
          firstPoxInfo.reward_phase_block_length;
        await standByUntilBurnBlock(rewardPhaseEndBurnBlock);
        const secondPoxInfo = await client.getPox();
        expect(firstPoxInfo.current_cycle.id).toBe(secondPoxInfo.current_cycle.id - 1);
      };
      await waitForCurrentPoxCycleComplete();
      await waitForCurrentPoxCycleComplete();
    });

    test('Validate account balances are unlocked', async () => {
      // validate stacks-node balance
      const coreBalanceInfo = await client.getAccount(delegateeAccount.stxAddr);
      expect(BigInt(coreBalanceInfo.locked)).toBe(0n);
      expect(coreBalanceInfo.unlock_height).toBe(0);

      // TODO: validate API endpoint balance state for account
    });

    test('Check pox2 events endpoint', async () => {
      // TODO: check the extended rewards endpoints and the bitcoind RPC balance endpoints
      const res = await fetchGet(`/extended/v1/pox2_events`);
      expect(res).toBeDefined();
    });
  });

  describe('PoX-2 - Stacking operations P2PKH', () => {
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

      decodedBtcAddr = poxHelpers.decodeBtcAddress(btcAddr);
      expect({
        data: decodedBtcAddr.data.toString('hex'),
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

      await bitcoinRpcClient.importprivkey({
        privkey: btcRegtestAccount.wif,
        label: btcRegtestAccount.address,
        rescan: false,
      });
      const btcWalletAddrs: Record<string, unknown> = await bitcoinRpcClient.getaddressesbylabel({
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

      poxInfo = await client.getPox();
      burnBlockHeight = poxInfo.current_burnchain_block_height as number;

      ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      cycleBlockLength = lockPeriod * poxInfo.reward_cycle_length;

      [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox-2');
    });

    test('stack-stx tx', async () => {
      const coreBalancePreStackStx = await client.getAccount(account.stacksAddress);

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
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
        validateWithAbi: false,
      });
      const expectedTxId = '0x' + stackStxTx.txid();
      const sendTxResult = await client.sendTransaction(stackStxTx.serialize());
      expect(sendTxResult.txId).toBe(expectedTxId);

      // Wait for API to receive and ingest tx
      const dbTx = await standByForTx(expectedTxId);
      expect(dbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(dbTx.block_height);

      const tx1Event = await api.datastore.getTxEvents({
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
      const coreBalance = await client.getAccount(account.stacksAddress);
      expect(BigInt(coreBalance.locked)).toBe(ustxAmount);
      expect(BigInt(coreBalance.balance)).toBe(
        BigInt(coreBalancePreStackStx.balance) - ustxAmount - txFee
      );
      expect(coreBalance.unlock_height).toBeGreaterThan(0);

      // validate the pox2 event for this tx
      const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${sendTxResult.txId}`);
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

      // TODO: validate API balance state
    });

    test('stack-increase tx', async () => {
      const coreBalancePreIncrease = await client.getAccount(account.stacksAddress);

      // Create and broadcast a `stack-increase` tx
      const stackIncreaseAmount = 123n;
      const stackIncreaseTxFee = 10000n;
      const stackIncreaseTx = await makeContractCall({
        senderKey: account.secretKey,
        contractAddress,
        contractName,
        functionName: 'stack-increase',
        functionArgs: [uintCV(stackIncreaseAmount)],
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: stackIncreaseTxFee,
        validateWithAbi: false,
      });
      const expectedTxId = '0x' + stackIncreaseTx.txid();
      const sendTxResult = await client.sendTransaction(stackIncreaseTx.serialize());
      expect(sendTxResult.txId).toBe(expectedTxId);

      const dbTx = await standByForTx(sendTxResult.txId);
      expect(dbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(dbTx.block_height);

      const txEvents = await api.datastore.getTxEvents({
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
      const rpcAccountInfo = await client.getAccount(account.stacksAddress);
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
      const coreBalance = await client.getAccount(account.stacksAddress);
      expect(BigInt(coreBalance.locked)).toBe(expectedLockedAmount);
      expect(BigInt(coreBalance.balance)).toBe(
        BigInt(coreBalancePreIncrease.balance) - stackIncreaseAmount - stackIncreaseTxFee
      );
      expect(coreBalance.unlock_height).toBe(expectedUnlockHeight);

      // validate the pox2 event for this tx
      const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${sendTxResult.txId}`);
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

      // TODO: validate API balance state
    });

    test('stack-extend tx', async () => {
      const coreBalancePreStackExtend = await client.getAccount(account.stacksAddress);

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
        network: stacksNetwork,
        anchorMode: AnchorMode.OnChainOnly,
        fee: txFee,
        validateWithAbi: false,
      });
      const expectedTxId = '0x' + stackExtendTx.txid();
      const sendTxResult = await client.sendTransaction(stackExtendTx.serialize());
      expect(sendTxResult.txId).toBe(expectedTxId);

      const dbTx = await standByForTx(expectedTxId);
      expect(dbTx.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(dbTx.block_height);

      const txEvents = await api.datastore.getTxEvents({
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
      const rpcAccountInfo = await client.getAccount(account.stacksAddress);
      expect(rpcAccountInfo.unlock_height).toBe(expectedUnlockHeight);

      // Test the API address balance data after a `stack-extend` operation
      const addrBalance = await fetchGet<AddressStxBalanceResponse>(
        `/extended/v1/address/${account.stacksAddress}/stx`
      );
      expect(addrBalance.burnchain_unlock_height).toBe(expectedUnlockHeight);
      expect(addrBalance.lock_height).toBe(dbTx.block_height);
      expect(addrBalance.lock_tx_id).toBe(dbTx.tx_id);

      // validate stacks-node balance state
      const coreBalance = await client.getAccount(account.stacksAddress);
      expect(BigInt(coreBalance.locked)).toBeGreaterThan(0n);
      expect(BigInt(coreBalance.locked)).toBe(BigInt(coreBalancePreStackExtend.locked));
      expect(BigInt(coreBalance.balance)).toBeGreaterThan(0n);
      expect(BigInt(coreBalance.balance)).toBe(BigInt(coreBalancePreStackExtend.balance) - txFee);
      expect(coreBalance.unlock_height).toBeGreaterThan(coreBalancePreStackExtend.unlock_height);

      // validate the pox2 event for this tx
      const res: any = await fetchGet(`/extended/v1/pox2_events/tx/${sendTxResult.txId}`);
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

      // TODO: validate API balance state
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

    test('stacking rewards - BTC JSON-RPC - getblock', async () => {
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
      received = received.filter(
        r => r.address === btcRegtestAccount.address && r.confirmations > 0
      );
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
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

    test('BTC stacking reward received', async () => {
      const received: number = await bitcoinRpcClient.getreceivedbyaddress({
        address: btcRegtestAccount.address,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });

  describe('PoX-2 - Stacking operations P2SH-P2WPKH', () => {
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
    const cycleCount = 1;
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
      const sendResult1 = await client.sendTransaction(tx1.serialize());
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTx(expectedTxId1);
      expect(dbTx1.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(dbTx1.block_height);

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
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
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

    test('BTC stacking reward received', async () => {
      const received: number = await bitcoinRpcClient.getreceivedbyaddress({
        address: btcRegtestAccount.address,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });

  describe('PoX-2 - Stacking operations P2WPKH', () => {
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

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcRegtestAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2wpkh',
      });
      expect(btcRegtestAddr).toBe('bcrt1qq6hag67dl53wl99vzg42z8eyzfz2xlkvwk6f7m');

      await bitcoinRpcClient.importaddress({ address: btcRegtestAddr, label: btcRegtestAddr });
      const btcWalletAddrs = await bitcoinRpcClient.getaddressesbylabel({ label: btcRegtestAddr });
      expect(Object.keys(btcWalletAddrs)).toContain(btcRegtestAddr);

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
      const sendResult1 = await client.sendTransaction(tx1.serialize());
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTx(expectedTxId1);
      expect(dbTx1.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(dbTx1.block_height);

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
        .find(t => t?.scriptPubKey.addresses?.includes(btcRegtestAddr) && t.value);
      if (!vout || !vout.value) {
        throw new Error(
          `Could not find bitcoin vout for ${btcRegtestAddr} in block ${firstReward.burn_block_hash}`
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
        label: btcRegtestAddr,
        include_watchonly: true,
      });
      received = received.filter(r => r.address === btcRegtestAddr);
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
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

    test('BTC stacking reward received', async () => {
      const received: number = await bitcoinRpcClient.getreceivedbyaddress({
        address: btcRegtestAddr,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });

  describe('PoX-2 - Stacking operations P2WSH', () => {
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

    beforeAll(async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2wsh',
      });
      expect(btcAddr).toBe('tb1q4qp0380kg75cqv25k4zruwa87wefwz0uefv78jekagm2j8568rwqvz7llf');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      decodedBtcAddr = poxHelpers.decodeBtcAddress(btcAddr);
      expect({
        data: decodedBtcAddr.data.toString('hex'),
        version: decodedBtcAddr.version,
      }).toEqual({
        data: 'a802f89df647a9803154b5443e3ba7f3b29709fcca59e3cb36ea36a91e9a38dc',
        version: 5,
      });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcRegtestAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2wsh',
      });
      expect(btcRegtestAddr).toBe(
        'bcrt1q4qp0380kg75cqv25k4zruwa87wefwz0uefv78jekagm2j8568rwqpm5e2n'
      );

      await bitcoinRpcClient.importaddress({ address: btcRegtestAddr, label: btcRegtestAddr });
      const btcWalletAddrs = await bitcoinRpcClient.getaddressesbylabel({ label: btcRegtestAddr });
      expect(Object.keys(btcWalletAddrs)).toContain(btcRegtestAddr);

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
      const sendResult1 = await client.sendTransaction(tx1.serialize());
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTx(expectedTxId1);
      expect(dbTx1.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(dbTx1.block_height);

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
        .find(t => t?.scriptPubKey.addresses?.includes(btcRegtestAddr) && t.value);
      if (!vout || !vout.value) {
        throw new Error(
          `Could not find bitcoin vout for ${btcRegtestAddr} in block ${firstReward.burn_block_hash}`
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
        label: btcRegtestAddr,
        include_watchonly: true,
      });
      received = received.filter(r => r.address === btcRegtestAddr);
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
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

    test('BTC stacking reward received', async () => {
      const received: number = await bitcoinRpcClient.getreceivedbyaddress({
        address: btcRegtestAddr,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });

  describe('PoX-2 - Stacking operations P2TR', () => {
    const account = testnetKeys[2];
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

    beforeAll(async () => {
      btcAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'testnet',
        addressFormat: 'p2tr',
      });
      expect(btcAddr).toBe('tb1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasvfnc28');
      btcPubKey = privateToPublicKey(btcPrivateKey).toString('hex');
      expect(btcPubKey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');

      decodedBtcAddr = poxHelpers.decodeBtcAddress(btcAddr);
      expect({
        data: decodedBtcAddr.data.toString('hex'),
        version: decodedBtcAddr.version,
      }).toEqual({
        data: 'cafd90c7026f0b6ab98df89490d02732881f2f4b5900856358dddff4679c2ffb',
        version: 6,
      });

      // Create a regtest address to use with bitcoind json-rpc since the krypton-stacks-node uses testnet addresses
      btcRegtestAddr = getBitcoinAddressFromKey({
        privateKey: btcPrivateKey,
        network: 'regtest',
        addressFormat: 'p2tr',
      });
      expect(btcRegtestAddr).toBe(
        'bcrt1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9laspse7la'
      );

      await bitcoinRpcClient.importaddress({ address: btcRegtestAddr, label: btcRegtestAddr });
      const btcWalletAddrs = await bitcoinRpcClient.getaddressesbylabel({ label: btcRegtestAddr });
      expect(Object.keys(btcWalletAddrs)).toContain(btcRegtestAddr);

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
      const sendResult1 = await client.sendTransaction(tx1.serialize());
      expect(sendResult1.txId).toBe(expectedTxId1);

      // Wait for API to receive and ingest tx
      const dbTx1 = await standByForTx(expectedTxId1);
      expect(dbTx1.status).toBe(DbTxStatus.Success);

      // ensure stacks-node is caught up
      await standByUntilBlock(dbTx1.block_height);

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
        .find(t => t?.scriptPubKey.addresses?.includes(btcRegtestAddr) && t.value);
      if (!vout || !vout.value) {
        throw new Error(
          `Could not find bitcoin vout for ${btcRegtestAddr} in block ${firstReward.burn_block_hash}`
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
        label: btcRegtestAddr,
        include_watchonly: true,
      });
      received = received.filter(r => r.address === btcRegtestAddr);
      expect(received.length).toBe(1);
      expect(received[0].category).toBe('receive');
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
      const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
      expect(sats).toBe(firstReward.reward_amount);
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

    test('BTC stacking reward received', async () => {
      const received: number = await bitcoinRpcClient.getreceivedbyaddress({
        address: btcRegtestAddr,
        minconf: 0,
      });
      expect(received).toBeGreaterThan(0);
    });
  });
});
