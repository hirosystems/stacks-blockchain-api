import {
  bufferCV,
  ChainID,
  ClarityValue,
  getAddressFromPrivateKey,
  TransactionVersion,
  tupleCV,
  TupleCV,
} from '@stacks/transactions';
import { ENV } from '../../src/env.ts';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server.ts';
import { migrate } from '../test-helpers.ts';
import { PgWriteStore } from '../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../src/api/init.ts';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../../src/core-rpc/client.ts';
import { coerceToBuffer, timeout } from '@stacks/api-toolkit';
import { StacksNetwork, StacksTestnet } from '@stacks/network';
import { RPCClient } from 'rpc-bitcoin';
import codec from '@stacks/codec';
import { decodeBtcAddress } from '@stacks/stacking';
import { FAUCET_TESTNET_KEYS } from '../../src/api/routes/faucets.ts';
import { AddressStxBalance } from '../../src/api/schemas/entities/addresses.ts';
import { ServerStatusResponse } from '../../src/api/schemas/responses/responses.ts';
import { DbBlock, DbTx, DbTxStatus } from '../../src/datastore/common.ts';
import { BitcoinAddressFormat, ECPair, getBitcoinAddressFromKey } from './ec-helpers.ts';
import supertest from 'supertest';
import assert from 'node:assert/strict';

export interface KryptonContext {
  db: PgWriteStore;
  eventServer: EventStreamServer;
  api: ApiServer;
  client: StacksCoreRpcClient;
  stacksNetwork: StacksNetwork;
  bitcoinRpcClient: RPCClient;
}

async function standByForPoxToBeReady(client: StacksCoreRpcClient): Promise<void> {
  while (true) {
    try {
      const poxInfo = await client.getPox();
      if (!poxInfo.contract_id.includes('pox-4')) {
        throw new Error(`Unexpected PoX version: ${poxInfo.contract_id}`);
      }
      break;
    } catch (error) {
      console.error(error);
      console.log(`Waiting on PoX-4 to be ready, retrying after ${error}`);
      await timeout(500);
    }
  }
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
export async function standByForNextPoxCycle(ctx: KryptonContext): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await ctx.client.getPox();
  await standByUntilBurnBlock(firstPoxInfo.next_cycle.prepare_phase_start_block_height, ctx);
  const lastPoxInfo = await ctx.client.getPox();
  const info = await ctx.client.getInfo();
  console.log({
    'firstPoxInfo.next_cycle.prepare_phase_start_block_height':
      firstPoxInfo.next_cycle.prepare_phase_start_block_height,
    'lastPoxInfo.current_burnchain_block_height': lastPoxInfo.current_burnchain_block_height,
    'info.burn_block_height': info.burn_block_height,
  });
  return lastPoxInfo;
}

/** Stand by until block height reaches the start of the next cycle */
export async function standByForPoxCycle(ctx: KryptonContext): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await ctx.client.getPox();
  let lastPoxInfo: CoreRpcPoxInfo = JSON.parse(JSON.stringify(firstPoxInfo));
  do {
    await standByUntilBurnBlock(lastPoxInfo.current_burnchain_block_height! + 1, ctx);
    lastPoxInfo = await ctx.client.getPox();
  } while (
    (lastPoxInfo.current_burnchain_block_height as number) <=
    firstPoxInfo.next_cycle.reward_phase_start_block_height
  );
  const info = await ctx.client.getInfo();
  console.log({
    'firstPoxInfo.next_cycle.prepare_phase_start_block_height':
      firstPoxInfo.next_cycle.prepare_phase_start_block_height,
    'lastPoxInfo.current_burnchain_block_height': lastPoxInfo.current_burnchain_block_height,
    'info.burn_block_height': info.burn_block_height,
  });
  return lastPoxInfo;
}

export async function standByForPoxCycleEnd(ctx: KryptonContext): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await ctx.client.getPox();
  if (
    firstPoxInfo.current_burnchain_block_height ===
    firstPoxInfo.next_cycle.prepare_phase_start_block_height
  ) {
    await standByUntilBurnBlock(firstPoxInfo.current_burnchain_block_height + 1, ctx);
  }
  const nextCycleInfo = await standByForNextPoxCycle(ctx);
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
  ctx: KryptonContext
): Promise<DbBlock> {
  const client = ctx.client;
  const api = ctx.api;
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
  ctx: KryptonContext
): Promise<DbTx> {
  const client = ctx.client;
  const api = ctx.api;

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
  ctx: KryptonContext
): Promise<DbTx> {
  const tx = await standByForTx(expectedTxId, ctx);
  if (tx.status !== DbTxStatus.Success) {
    const txResult = codec.decodeClarityValue(tx.raw_result);
    const resultRepr = txResult.repr;
    throw new Error(`Tx failed with status ${tx.status}, result: ${resultRepr}`);
  }
  return tx;
}

export async function standByUntilBlock(
  blockHeight: number,
  ctx: KryptonContext
): Promise<DbBlock> {
  let blockFound = false;
  const client = ctx.client;
  const api = ctx.api;
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

export async function standByForAccountUnlock(address: string, ctx: KryptonContext): Promise<void> {
  while (true) {
    const poxInfo = await ctx.client.getPox();
    const info = await ctx.client.getInfo();
    const accountInfo = await ctx.client.getAccount(address);
    const addrBalance = await fetchGet<AddressStxBalance>(`/extended/v1/address/${address}/stx`, ctx);
    const status = await fetchGet<ServerStatusResponse>('/extended/v1/status', ctx);
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
    assert.equal(BigInt(addrBalance.locked), BigInt(accountInfo.locked));
    if (BigInt(accountInfo.locked) === 0n) {
      break;
    }
    await standByUntilBlock(info.stacks_tip_height + 1, ctx);
  }
}

export async function fetchGet<TRes>(endpoint: string, ctx: KryptonContext): Promise<TRes> {
  const result = await supertest(ctx.api.server).get(endpoint);
  // Follow redirects
  if (result.status >= 300 && result.status < 400) {
    return await fetchGet<TRes>(result.header.location, ctx);
  }
  assert.equal(result.status, 200);
  assert.equal(result.type, 'application/json');
  return result.body as TRes;
}

export async function readOnlyFnCall<T extends codec.ClarityValue>(
  contract: string | [string, string],
  fnName: string,
  ctx: KryptonContext,
  args?: ClarityValue[],
  sender?: string,
  unwrap = true
): Promise<T> {
  const [contractAddr, contractName] =
    typeof contract === 'string' ? contract.split('.') : contract;
  const callResp = await ctx.client.sendReadOnlyContractCall(
    contractAddr,
    contractName,
    fnName,
    sender ?? FAUCET_TESTNET_KEYS[0].stacksAddress,
    args ?? []
  );
  if (!callResp.okay) {
    throw new Error(`Failed to call ${contract}::${fnName}`);
  }
  const decodedVal = codec.decodeClarityValue<T>(callResp.result);
  if (unwrap) {
    if (decodedVal.type_id === codec.ClarityTypeID.OptionalSome) {
      return decodedVal.value as T;
    }
    if (decodedVal.type_id === codec.ClarityTypeID.ResponseOk) {
      return decodedVal.value as T;
    }
    if (decodedVal.type_id === codec.ClarityTypeID.OptionalNone) {
      throw new Error(`OptionNone result for call to ${contract}::${fnName}`);
    }
    if (decodedVal.type_id === codec.ClarityTypeID.ResponseError) {
      throw new Error(`ResultError result for call to ${contract}::${fnName}: ${decodedVal.repr}`);
    }
  }
  return decodedVal;
}

export async function getKryptonContext(): Promise<KryptonContext> {
  process.env.PG_DATABASE = 'postgres';
  ENV.PG_DATABASE = 'postgres';
  ENV.STACKS_CHAIN_ID = '0x80000000';

  await migrate('up');
  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const eventServer = await startEventServer({
    datastore: db,
    chainId: ChainID.Testnet,
  });
  const api = await startApiServer({ datastore: db, writeDatastore: db, chainId: ChainID.Testnet });
  const client = new StacksCoreRpcClient();
  await standByForPoxToBeReady(client);

  const stacksNetwork = new StacksTestnet({ url: `http://${client.endpoint}` });

  const bitcoinRpcClient = new RPCClient({
    url: ENV.BTC_RPC_HOST,
    port: ENV.BTC_RPC_PORT,
    user: ENV.BTC_RPC_USER,
    pass: ENV.BTC_RPC_PW ?? '',
    timeout: 120000,
    wallet: 'main',
  });

  const testEnv: KryptonContext = {
    db,
    eventServer,
    client,
    stacksNetwork,
    bitcoinRpcClient,
    api,
  };

  return testEnv;
}

export async function stopKryptonContext(testEnv: KryptonContext): Promise<void> {
  await testEnv.api.forceKill();
  await testEnv.eventServer.closeAsync();
  await testEnv.db?.close({ timeout: 0 });
}
