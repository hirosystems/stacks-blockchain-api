/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  bufferCV,
  ClarityValue,
  getAddressFromPrivateKey,
  TransactionVersion,
  tupleCV,
  TupleCV,
} from '@stacks/transactions';
import { AddressStxBalanceResponse, ServerStatusResponse } from 'docs/generated';
import { testnetKeys } from '../api/routes/debug';
import {
  decodeClarityValue,
  ClarityValue as NativeClarityValue,
  ClarityTypeID,
} from 'stacks-encoding-native-js';
import * as supertest from 'supertest';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbBlock, DbTx, DbTxStatus } from '../datastore/common';
import { ECPair, getBitcoinAddressFromKey } from '../ec-helpers';
import { coerceToBuffer, timeout } from '../helpers';
import * as poxHelpers from '../pox-helpers';
import { TestEnvContext } from './env-setup';

export type Account = {
  secretKey: string;
  pubKey: string;
  stxAddr: string;
  btcAddr: string;
  btcTestnetAddr: string;
  poxAddr: { version: number; data: Buffer };
  poxAddrClar: TupleCV;
  wif: string;
};

export const testEnv = {
  get globalTestEnv() {
    return (global as any).testEnv as TestEnvContext;
  },
  get db() {
    return this.globalTestEnv.db;
  },
  get api() {
    return this.globalTestEnv.api;
  },
  get client() {
    return this.globalTestEnv.client;
  },
  get stacksNetwork() {
    return this.globalTestEnv.stacksNetwork;
  },
  get bitcoinRpcClient() {
    return this.globalTestEnv.bitcoinRpcClient;
  },
};

export function accountFromKey(privateKey: string): Account {
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

export async function standByForNextPoxCycle(): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await testEnv.client.getPox();
  await standByUntilBurnBlock(firstPoxInfo.next_cycle.prepare_phase_start_block_height);
  const lastPoxInfo = await testEnv.client.getPox();
  const info = await testEnv.client.getInfo();
  console.log({
    'firstPoxInfo.next_cycle.prepare_phase_start_block_height':
      firstPoxInfo.next_cycle.prepare_phase_start_block_height,
    'lastPoxInfo.current_burnchain_block_height': lastPoxInfo.current_burnchain_block_height,
    'info.burn_block_height': info.burn_block_height,
  });
  return lastPoxInfo;
}

export async function standByForPoxCycle(): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await testEnv.client.getPox();
  let lastPoxInfo: CoreRpcPoxInfo = JSON.parse(JSON.stringify(firstPoxInfo));
  do {
    await standByUntilBurnBlock(lastPoxInfo.current_burnchain_block_height! + 1);
    lastPoxInfo = await testEnv.client.getPox();
  } while (lastPoxInfo.current_cycle.id <= firstPoxInfo.current_cycle.id);
  expect(lastPoxInfo.current_cycle.id).toBe(firstPoxInfo.next_cycle.id);
  const info = await testEnv.client.getInfo();
  console.log({
    'firstPoxInfo.next_cycle.prepare_phase_start_block_height':
      firstPoxInfo.next_cycle.prepare_phase_start_block_height,
    'lastPoxInfo.current_burnchain_block_height': lastPoxInfo.current_burnchain_block_height,
    'info.burn_block_height': info.burn_block_height,
  });
  return lastPoxInfo;
}

export async function standByForPoxCycleEnd(): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await testEnv.client.getPox();
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

export async function standByUntilBurnBlock(burnBlockHeight: number): Promise<DbBlock> {
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    const listener: (blockHash: string) => void = async blockHash => {
      const dbBlockQuery = await testEnv.api.datastore.getBlock({ hash: blockHash });
      if (!dbBlockQuery.found || dbBlockQuery.result.burn_block_height < burnBlockHeight) {
        return;
      }
      testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      resolve(dbBlockQuery.result);
    };
    testEnv.api.datastore.eventEmitter.addListener('blockUpdate', listener);

    // Check if block height already reached
    const curHeight = await testEnv.api.datastore.getCurrentBlock();
    if (curHeight.found && curHeight.result.burn_block_height >= burnBlockHeight) {
      const dbBlock = await testEnv.api.datastore.getBlock({
        height: curHeight.result.block_height,
      });
      if (!dbBlock.found) {
        throw new Error('Unhandled missing block');
      }
      testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      resolve(dbBlock.result);
    }
  });

  // Ensure stacks-node is caught up with processing this block
  while (true) {
    const nodeInfo = await testEnv.client.getInfo();
    if (nodeInfo.stacks_tip_height >= dbBlock.block_height) {
      break;
    } else {
      await timeout(50);
    }
  }
  return dbBlock;
}

export async function standByForTx(expectedTxId: string): Promise<DbTx> {
  const tx = await new Promise<DbTx>(async resolve => {
    const listener: (txId: string) => void = async txId => {
      if (txId !== expectedTxId) {
        return;
      }
      const dbTxQuery = await testEnv.api.datastore.getTx({
        txId: expectedTxId,
        includeUnanchored: false,
      });
      if (!dbTxQuery.found) {
        return;
      }
      testEnv.api.datastore.eventEmitter.removeListener('txUpdate', listener);
      resolve(dbTxQuery.result);
    };
    testEnv.api.datastore.eventEmitter.addListener('txUpdate', listener);

    // Check if tx is already received
    const dbTxQuery = await testEnv.api.datastore.getTx({
      txId: expectedTxId,
      includeUnanchored: false,
    });
    if (dbTxQuery.found) {
      testEnv.api.datastore.eventEmitter.removeListener('txUpdate', listener);
      resolve(dbTxQuery.result);
    }
  });

  // Ensure stacks-node is caught up with processing the block for this tx
  while (true) {
    const nodeInfo = await testEnv.client.getInfo();
    if (nodeInfo.stacks_tip_height >= tx.block_height) {
      break;
    } else {
      await timeout(50);
    }
  }
  return tx;
}

export async function standByForTxSuccess(expectedTxId: string): Promise<DbTx> {
  const tx = await standByForTx(expectedTxId);
  if (tx.status !== DbTxStatus.Success) {
    const txResult = decodeClarityValue(tx.raw_result);
    const resultRepr = txResult.repr;
    throw new Error(`Tx failed with status ${tx.status}, result: ${resultRepr}`);
  }
  return tx;
}

export async function standByUntilBlock(blockHeight: number): Promise<DbBlock> {
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    const listener: (blockHash: string) => void = async blockHash => {
      const dbBlockQuery = await testEnv.api.datastore.getBlock({ hash: blockHash });
      if (!dbBlockQuery.found || dbBlockQuery.result.block_height < blockHeight) {
        return;
      }
      testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      resolve(dbBlockQuery.result);
    };
    testEnv.api.datastore.eventEmitter.addListener('blockUpdate', listener);

    // Check if block height already reached
    const curHeight = await testEnv.api.datastore.getCurrentBlockHeight();
    if (curHeight.found && curHeight.result >= blockHeight) {
      const dbBlock = await testEnv.api.datastore.getBlock({ height: curHeight.result });
      if (!dbBlock.found) {
        throw new Error('Unhandled missing block');
      }
      testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      resolve(dbBlock.result);
      return;
    }
  });

  // Ensure stacks-node is caught up with processing this block
  while (true) {
    const nodeInfo = await testEnv.client.getInfo();
    if (nodeInfo.stacks_tip_height >= blockHeight) {
      break;
    } else {
      await timeout(50);
    }
  }
  return dbBlock;
}

export async function standByForAccountUnlock(address: string): Promise<void> {
  while (true) {
    const poxInfo = await testEnv.client.getPox();
    const info = await testEnv.client.getInfo();
    const accountInfo = await testEnv.client.getAccount(address);
    const addrBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${address}/stx`
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
    if (BigInt(addrBalance.locked) !== BigInt(accountInfo.locked)) {
      console.log('womp');
    }
    expect(BigInt(addrBalance.locked)).toBe(BigInt(accountInfo.locked));
    if (BigInt(accountInfo.locked) === 0n) {
      break;
    }
    await standByUntilBlock(info.stacks_tip_height + 1);
  }
}

export async function fetchGet<TRes>(endpoint: string) {
  const result = await supertest(testEnv.api.server).get(endpoint);
  expect(result.status).toBe(200);
  expect(result.type).toBe('application/json');
  return result.body as TRes;
}

export async function readOnlyFnCall<T extends NativeClarityValue>(
  contract: string | [string, string],
  fnName: string,
  args?: ClarityValue[],
  sender?: string,
  unwrap = true
): Promise<T> {
  const [contractAddr, contractName] =
    typeof contract === 'string' ? contract.split('.') : contract;
  const callResp = await testEnv.client.sendReadOnlyContractCall(
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
      throw new Error(`ResultError result for call to ${contract}::${fnName}: ${decodedVal.repr}`);
    }
  }
  return decodedVal;
}
