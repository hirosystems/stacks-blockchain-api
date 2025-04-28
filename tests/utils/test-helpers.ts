/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { bytesToHex } from '@stacks/common';
import { StacksNetwork } from '@stacks/network';
import { decodeBtcAddress } from '@stacks/stacking';
import {
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
} from '../../src/rosetta/types';
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
import { getRosettaNetworkName, RosettaConstants } from '../../src/api/rosetta-constants';

import {
  ClarityTypeID,
  ClarityValue as NativeClarityValue,
  decodeClarityValue,
} from 'stacks-encoding-native-js';
import * as supertest from 'supertest';
import { ApiServer } from '../../src/api/init';
import { testnetKeys } from '../../src/api/routes/debug';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../../src/core-rpc/client';
import { DbBlock, DbTx, DbTxStatus } from '../../src/datastore/common';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { BitcoinAddressFormat, ECPair, getBitcoinAddressFromKey } from '../../src/ec-helpers';
import { coerceToBuffer, runMigrations, timeout } from '@hirosystems/api-toolkit';
import { MIGRATIONS_DIR } from '../../src/datastore/pg-store';
import { getConnectionArgs } from '../../src/datastore/connection';
import { AddressStxBalance } from '../../src/api/schemas/entities/addresses';
import { ServerStatusResponse } from '../../src/api/schemas/responses/responses';

export async function migrate(direction: 'up' | 'down') {
  await runMigrations(MIGRATIONS_DIR, direction, getConnectionArgs());
}

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
    return this.globalTestEnv?.db;
  },
  get api() {
    return this.globalTestEnv?.api;
  },
  get client() {
    return this.globalTestEnv?.client;
  },
  get stacksNetwork() {
    return this.globalTestEnv?.stacksNetwork;
  },
  get bitcoinRpcClient() {
    return this.globalTestEnv?.bitcoinRpcClient;
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

/** Stand by until prepare phase of next pox cycle (still in current cycle) */
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

/** Stand by until block height reaches the start of the next cycle */
export async function standByForPoxCycle(
  apiArg?: ApiServer,
  clientArg?: StacksCoreRpcClient
): Promise<CoreRpcPoxInfo> {
  const client = clientArg ?? testEnv?.client ?? new StacksCoreRpcClient();
  const api = apiArg ?? testEnv.api;

  const firstPoxInfo = await client.getPox();
  let lastPoxInfo: CoreRpcPoxInfo = JSON.parse(JSON.stringify(firstPoxInfo));
  do {
    await standByUntilBurnBlock(lastPoxInfo.current_burnchain_block_height! + 1, api, client);
    lastPoxInfo = await client.getPox();
  } while (
    (lastPoxInfo.current_burnchain_block_height as number) <=
    firstPoxInfo.next_cycle.reward_phase_start_block_height
  );
  const info = await client.getInfo();
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

export async function standByUntilBurnBlock(
  burnBlockHeight: number,
  apiArg?: ApiServer,
  clientArg?: StacksCoreRpcClient
): Promise<DbBlock> {
  const client = clientArg ?? testEnv?.client ?? new StacksCoreRpcClient();
  const api = apiArg ?? testEnv.api;
  let blockFound = false;
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    const listener: (blockHash: string) => void = async blockHash => {
      const dbBlockQuery = await api.datastore.getBlock({ hash: blockHash });
      if (!dbBlockQuery.found || dbBlockQuery.result.burn_block_height < burnBlockHeight) {
        return;
      }
      api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      blockFound = true;
      resolve(dbBlockQuery.result);
    };
    api.datastore.eventEmitter.addListener('blockUpdate', listener);

    // Check if block height already reached
    while (!blockFound) {
      const curHeight = await api.datastore.getCurrentBlock();
      if (curHeight.found && curHeight.result.burn_block_height >= burnBlockHeight) {
        const dbBlock = await api.datastore.getBlock({
          height: curHeight.result.block_height,
        });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        blockFound = true;
        resolve(dbBlock.result);
      } else {
        await timeout(200);
      }
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

export async function standByForTx(
  expectedTxId: string,
  apiArg?: ApiServer,
  clientArg?: StacksCoreRpcClient
): Promise<DbTx> {
  const client = clientArg ?? testEnv?.client ?? new StacksCoreRpcClient();
  const api = apiArg ?? testEnv.api;

  const stack = new Error().stack;
  const timeoutSeconds = 25;
  const timer = setTimeout(() => {
    console.error(
      `Could not find TX ${expectedTxId} after ${timeoutSeconds} seconds.. stack: ${stack}`
    );
  }, timeoutSeconds * 1000);

  const standByForTxInner = async () => {
    console.log(`Waiting for TX: ${expectedTxId}...`);
    const tx = await new Promise<DbTx>(async resolve => {
      let found = false;
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
        found = true;
        resolve(dbTxQuery.result);
      };
      api.datastore.eventEmitter.addListener('txUpdate', listener);

      // Check if tx is already received
      do {
        const dbTxQuery = await api.datastore.getTx({
          txId: expectedTxId,
          includeUnanchored: false,
        });
        if (dbTxQuery.found) {
          api.datastore.eventEmitter.removeListener('txUpdate', listener);
          found = true;
          resolve(dbTxQuery.result);
        } else {
          await timeout(50);
        }
      } while (!found);
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

    // Ensure stacks-node is caught up processing the next nonce for this address
    while (true) {
      const nextNonce = await client.getAccountNonce(tx.sender_address);
      if (BigInt(nextNonce) > BigInt(tx.nonce)) {
        break;
      } else {
        await timeout(50);
      }
    }

    return tx;
  };
  const tx = await standByForTxInner();
  clearTimeout(timer);
  return tx;
}

export async function standByForTxSuccess(
  expectedTxId: string,
  apiArg?: ApiServer,
  clientArg?: StacksCoreRpcClient
): Promise<DbTx> {
  const client = clientArg ?? testEnv?.client ?? new StacksCoreRpcClient();
  const api = apiArg ?? testEnv.api;

  const tx = await standByForTx(expectedTxId, api, client);
  if (tx.status !== DbTxStatus.Success) {
    const txResult = decodeClarityValue(tx.raw_result);
    const resultRepr = txResult.repr;
    throw new Error(`Tx failed with status ${tx.status}, result: ${resultRepr}`);
  }
  return tx;
}

export async function standByUntilBlock(
  blockHeight: number,
  apiArg?: ApiServer,
  clientArg?: StacksCoreRpcClient
): Promise<DbBlock> {
  let blockFound = false;
  const client = clientArg ?? testEnv?.client ?? new StacksCoreRpcClient();
  const api = apiArg ?? testEnv.api;
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    const listener: (blockHash: string) => void = async blockHash => {
      const dbBlockQuery = await api.datastore.getBlock({ hash: blockHash });
      if (!dbBlockQuery.found || dbBlockQuery.result.block_height < blockHeight) {
        return;
      }
      api.datastore.eventEmitter.removeListener('blockUpdate', listener);
      blockFound = true;
      resolve(dbBlockQuery.result);
    };
    api.datastore.eventEmitter.addListener('blockUpdate', listener);

    // Check if block height already reached
    while (!blockFound) {
      const curHeight = await api.datastore.getCurrentBlockHeight();
      if (curHeight.found && curHeight.result >= blockHeight) {
        const dbBlock = await api.datastore.getBlock({ height: curHeight.result });
        if (!dbBlock.found) {
          throw new Error('Unhandled missing block');
        }
        api.datastore.eventEmitter.removeListener('blockUpdate', listener);
        resolve(dbBlock.result);
        return;
      } else {
        await timeout(200);
      }
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

export async function standByForAccountUnlock(address: string): Promise<void> {
  while (true) {
    const poxInfo = await testEnv.client.getPox();
    const info = await testEnv.client.getInfo();
    const accountInfo = await testEnv.client.getAccount(address);
    const addrBalance = await fetchGet<AddressStxBalance>(`/extended/v1/address/${address}/stx`);
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

export async function fetchGet<TRes>(endpoint: string): Promise<TRes> {
  const result = await supertest(testEnv.api.server).get(endpoint);
  // Follow redirects
  if (result.status >= 300 && result.status < 400) {
    return await fetchGet<TRes>(result.header.location);
  }
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
  req.block_identifier = { hash: account.block_identifier.hash };
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
  signerKey: string;
  signerPrivKey: string;
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
        signer_key: opts.signerKey,
        signer_private_key: opts.signerPrivKey,
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

/** Client-side nonce tracking */
export class NonceJar {
  nonceMap = new Map<string, number>();
  api: ApiServer;
  client: StacksCoreRpcClient;

  constructor(api: ApiServer, client: StacksCoreRpcClient) {
    this.api = api;
    this.client = client;
  }

  async getNonce(address: string): Promise<number> {
    while (true) {
      const clientNonce = this.nonceMap.get(address) ?? 0;
      const apiReq = await supertest(this.api.server).get(`/extended/v1/address/${address}/nonces`);
      const { possible_next_nonce, last_executed_tx_nonce } = apiReq.body;
      const nodeNonce = await this.client.getAccountNonce(address, false);
      const nextNonce = Math.max(possible_next_nonce, nodeNonce, clientNonce);
      const lastExecutedNonce = Math.min(last_executed_tx_nonce, nodeNonce);
      const chainedCount = nextNonce - lastExecutedNonce;
      if (chainedCount >= 25) {
        await timeout(700);
        continue;
      }
      this.nonceMap.set(address, nextNonce + 1);
      return nextNonce;
    }
  }
}
