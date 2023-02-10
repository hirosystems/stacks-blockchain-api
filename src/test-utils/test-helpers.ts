/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { bytesToHex } from '@stacks/common';
import { StacksNetwork } from '@stacks/network';
import { decodeBtcAddress, poxAddressToBtcAddress } from '@stacks/stacking';
import {
  AddressStxBalanceResponse,
  NetworkIdentifier,
  RosettaAccountBalanceRequest,
  RosettaAccountBalanceResponse,
  RosettaBlockRequest,
  RosettaBlockResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionMetadataResponse,
  RosettaConstructionPayloadResponse,
  RosettaConstructionPayloadsRequest,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
  RosettaConstructionSubmitRequest,
  RosettaConstructionSubmitResponse,
  RosettaOperation,
  ServerStatusResponse,
} from '@stacks/stacks-blockchain-api-types';
import {
  bufferCV,
  ChainID,
  ClarityValue,
  createStacksPrivateKey,
  deserializeTransaction,
  getAddressFromPrivateKey,
  TransactionSigner,
  TransactionVersion,
  TupleCV,
  tupleCV,
} from '@stacks/transactions';
import { RPCClient } from 'rpc-bitcoin';
import { getRosettaNetworkName, RosettaConstants } from '../api/rosetta-constants';

import {
  ClarityTypeID,
  ClarityValue as NativeClarityValue,
  ClarityValueBuffer,
  ClarityValueTuple,
  decodeClarityValue,
} from 'stacks-encoding-native-js';
import * as supertest from 'supertest';
import { ApiServer } from '../api/init';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { DbBlock, DbTx, DbTxStatus } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { BitcoinAddressFormat, ECPair, getBitcoinAddressFromKey } from '../ec-helpers';
import { coerceToBuffer, hexToBuffer, timeout } from '../helpers';
import { b58ToC32 } from 'c32check';

export interface TestEnvContext {
  db: PgWriteStore;
  api: ApiServer;
  client: StacksCoreRpcClient;
  stacksNetwork: StacksNetwork;
  bitcoinRpcClient: RPCClient;
}

export type Account = {
  secretKey: string;
  pubKey: string;
  stxAddr: string;
  btcAddr: string;
  btcTestnetAddr: string;
  poxAddr: { version: number; data: Uint8Array };
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

export function accountFromKey(
  privateKey: string,
  addressFormat: BitcoinAddressFormat = 'p2pkh'
): Account {
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
    addressFormat,
    verbose: true,
  });
  const btcAddr = btcAccount.address;
  const poxAddr = decodeBtcAddress(btcAddr);
  const poxAddrClar = tupleCV({
    hashbytes: bufferCV(poxAddr.data),
    version: bufferCV(Buffer.from([poxAddr.version])),
  });
  const wif = btcAccount.wif;
  const btcTestnetAddr = getBitcoinAddressFromKey({
    privateKey: ecPair.privateKey!,
    network: 'testnet',
    addressFormat,
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
  let blockFound = false;
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    const listener: (blockHash: string) => void = async blockHash => {
      const dbBlockQuery = await testEnv.api.datastore.getBlock({ hash: blockHash });
      if (!dbBlockQuery.found || dbBlockQuery.result.burn_block_height < burnBlockHeight) {
        return;
      }
      testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      blockFound = true;
      resolve(dbBlockQuery.result);
    };
    testEnv.api.datastore.eventEmitter.addListener('blockUpdate', listener);

    // Check if block height already reached
    while (!blockFound) {
      const curHeight = await testEnv.api.datastore.getCurrentBlock();
      if (curHeight.found && curHeight.result.burn_block_height >= burnBlockHeight) {
        const dbBlock = await testEnv.api.datastore.getBlock({
          height: curHeight.result.block_height,
        });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        blockFound = true;
        resolve(dbBlock.result);
      } else {
        await timeout(200);
      }
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
  let txFound = false;
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
      txFound = true;
      resolve(dbTxQuery.result);
    };
    testEnv.api.datastore.eventEmitter.addListener('txUpdate', listener);

    while (!txFound) {
      // Check if tx is already received
      const dbTxQuery = await testEnv.api.datastore.getTx({
        txId: expectedTxId,
        includeUnanchored: false,
      });
      if (dbTxQuery.found) {
        testEnv.api.datastore.eventEmitter.removeListener('txUpdate', listener);
        txFound = true;
        resolve(dbTxQuery.result);
      } else {
        await timeout(200);
      }
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
  let blockFound = false;
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    const listener: (blockHash: string) => void = async blockHash => {
      const dbBlockQuery = await testEnv.api.datastore.getBlock({ hash: blockHash });
      if (!dbBlockQuery.found || dbBlockQuery.result.block_height < blockHeight) {
        return;
      }
      testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      blockFound = true;
      resolve(dbBlockQuery.result);
    };
    testEnv.api.datastore.eventEmitter.addListener('blockUpdate', listener);

    // Check if block height already reached
    while (!blockFound) {
      const curHeight = await testEnv.api.datastore.getCurrentBlockHeight();
      if (curHeight.found && curHeight.result >= blockHeight) {
        const dbBlock = await testEnv.api.datastore.getBlock({ height: curHeight.result });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        testEnv.api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        blockFound = true;
        resolve(dbBlock.result);
        return;
      } else {
        await timeout(200);
      }
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

async function fetchRosetta<TPostBody, TRes>(endpoint: string, body: TPostBody) {
  const result = await supertest(testEnv.api.server)
    .post(endpoint)
    .send(body as any);
  expect(result.status).toBe(200);
  expect(result.type).toBe('application/json');
  return result.body as TRes;
}

export async function getRosettaBlockByBurnBlockHeight(burnBlockHeight: number) {
  const unlockDbBlock = await testEnv.api.datastore.getBlockByBurnBlockHeight(burnBlockHeight);
  expect(unlockDbBlock.found).toBeTruthy();
  return fetchRosetta<RosettaBlockRequest, RosettaBlockResponse>('/rosetta/v1/block', {
    network_identifier: { blockchain: 'stacks', network: 'testnet' },
    block_identifier: { hash: unlockDbBlock.result!.block_hash },
  });
}

export async function getRosettaAccountBalance(stacksAddress: string, atBlockHeight?: number) {
  const req: RosettaAccountBalanceRequest = {
    network_identifier: { blockchain: 'stacks', network: 'testnet' },
    account_identifier: { address: stacksAddress },
  };
  if (atBlockHeight) {
    req.block_identifier = { index: atBlockHeight };
  }
  const account = await fetchRosetta<RosettaAccountBalanceRequest, RosettaAccountBalanceResponse>(
    '/rosetta/v1/account/balance',
    req
  );
  // Also query for locked balance, requires specifying a special constant sub_account
  req.account_identifier.sub_account = { address: RosettaConstants.StackedBalance };
  const locked = await fetchRosetta<RosettaAccountBalanceRequest, RosettaAccountBalanceResponse>(
    '/rosetta/v1/account/balance',
    req
  );
  return {
    account,
    locked,
  };
}

export async function stackStxWithRosetta(opts: {
  btcAddr: string;
  stacksAddress: string;
  pubKey: string;
  privateKey: string;
  cycleCount: number;
  ustxAmount: bigint;
}) {
  const rosettaNetwork: NetworkIdentifier = {
    blockchain: RosettaConstants.blockchain,
    network: getRosettaNetworkName(ChainID.Testnet),
  };

  const stackingOperations: RosettaOperation[] = [
    {
      operation_identifier: { index: 0, network_index: 0 },
      related_operations: [],
      type: 'stack_stx',
      account: { address: opts.stacksAddress, metadata: {} },
      amount: {
        value: '-' + opts.ustxAmount.toString(),
        currency: { symbol: 'STX', decimals: 6 },
        metadata: {},
      },
      metadata: {
        number_of_cycles: opts.cycleCount,
        pox_addr: opts.btcAddr,
      },
    },
    {
      operation_identifier: { index: 1, network_index: 0 },
      related_operations: [],
      type: 'fee',
      account: { address: opts.stacksAddress, metadata: {} },
      amount: { value: '10000', currency: { symbol: 'STX', decimals: 6 } },
    },
  ];

  // preprocess
  const preprocessResult = await fetchRosetta<
    RosettaConstructionPreprocessRequest,
    RosettaConstructionPreprocessResponse
  >('/rosetta/v1/construction/preprocess', {
    network_identifier: rosettaNetwork,
    operations: stackingOperations,
    metadata: {},
    max_fee: [{ value: '12380898', currency: { symbol: 'STX', decimals: 6 }, metadata: {} }],
    suggested_fee_multiplier: 1,
  });

  // metadata
  const metadataResult = await fetchRosetta<
    RosettaConstructionMetadataRequest,
    RosettaConstructionMetadataResponse
  >('/rosetta/v1/construction/metadata', {
    network_identifier: rosettaNetwork,
    options: preprocessResult.options!, // using options returned from preprocess
    public_keys: [{ hex_bytes: opts.pubKey, curve_type: 'secp256k1' }],
  });

  // payload
  const payloadsResult = await fetchRosetta<
    RosettaConstructionPayloadsRequest,
    RosettaConstructionPayloadResponse
  >('/rosetta/v1/construction/payloads', {
    network_identifier: rosettaNetwork,
    operations: stackingOperations, // using same operations as preprocess request
    metadata: metadataResult.metadata, // using metadata from metadata response
    public_keys: [{ hex_bytes: opts.pubKey, curve_type: 'secp256k1' }],
  });

  // sign tx
  const stacksTx = deserializeTransaction(payloadsResult.unsigned_transaction);
  const signer = new TransactionSigner(stacksTx);
  signer.signOrigin(createStacksPrivateKey(opts.privateKey));
  const signedSerializedTx = bytesToHex(stacksTx.serialize());
  const expectedTxId = '0x' + stacksTx.txid();

  // submit
  const submitResult = await fetchRosetta<
    RosettaConstructionSubmitRequest,
    RosettaConstructionSubmitResponse
  >('/rosetta/v1/construction/submit', {
    network_identifier: rosettaNetwork,
    signed_transaction: '0x' + signedSerializedTx,
  });

  const txStandby = await standByForTxSuccess(expectedTxId);

  return {
    txId: expectedTxId,
    tx: txStandby,
    submitResult,
    constructionPreprocess: preprocessResult,
    constructionMetadata: metadataResult,
  };
}

export function decodePoxAddrArg(
  argHex: string
): {
  btcAddr: string;
  stxAddr: string;
  hash160: string;
} {
  const pox_address_cv = decodeClarityValue(argHex);
  expect(pox_address_cv.type_id).toBe(ClarityTypeID.Tuple);
  const addressCV = pox_address_cv as ClarityValueTuple<{
    version: ClarityValueBuffer;
    hashbytes: ClarityValueBuffer;
  }>;
  const btcAddr = poxAddressToBtcAddress(
    hexToBuffer(addressCV.data.version.buffer)[0],
    hexToBuffer(addressCV.data.hashbytes.buffer),
    'regtest'
  );
  const stxAddr = b58ToC32(btcAddr);
  return { btcAddr, stxAddr, hash160: addressCV.data.hashbytes.buffer };
}
