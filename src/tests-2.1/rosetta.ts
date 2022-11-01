/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { TestEnvContext } from './env-setup';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbBlock, DbEventTypeId, DbTx, DbTxStatus } from '../datastore/common';
import {
  AnchorMode,
  AuthType,
  bufferCV,
  ChainID,
  createStacksPrivateKey,
  deserializeTransaction,
  getPublicKey,
  makeSTXTokenTransfer,
  makeUnsignedContractCall,
  makeUnsignedSTXTokenTransfer,
  noneCV,
  pubKeyfromPrivKey,
  publicKeyToString,
  SignedTokenTransferOptions,
  someCV,
  standardPrincipalCV,
  TransactionSigner,
  tupleCV,
  uintCV,
  UnsignedContractCallOptions,
  UnsignedTokenTransferOptions,
} from '@stacks/transactions';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../core-rpc/client';
import { bufferToHexPrefixString, FoundOrNot, hexToBuffer, timeout } from '../helpers';
import {
  RosettaConstructionCombineRequest,
  RosettaConstructionCombineResponse,
  RosettaAccountIdentifier,
  RosettaConstructionDeriveRequest,
  RosettaConstructionDeriveResponse,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionParseRequest,
  RosettaConstructionParseResponse,
  RosettaConstructionPayloadsRequest,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
  RosettaConstructionMetadataResponse,
  NetworkIdentifier,
  RosettaOperation,
  RosettaConstructionPayloadResponse,
  RosettaConstructionSubmitRequest,
  RosettaConstructionSubmitResponse,
  BurnchainRewardListResponse,
  RosettaBlockResponse,
  RosettaBlockRequest,
} from '@stacks/stacks-blockchain-api-types';
import {
  getRosettaNetworkName,
  RosettaConstants,
  RosettaErrors,
  RosettaErrorsTypes,
  RosettaOperationStatuses,
  RosettaOperationTypes,
} from '../api/rosetta-constants';
import { getStacksTestnetNetwork, testnetKeys } from '../api/routes/debug';
import { getSignature, getStacksNetwork } from '../rosetta-helpers';
import { makeSigHashPreSign, MessageSignature } from '@stacks/transactions';
import * as poxHelpers from '../pox-helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { RPCClient } from 'rpc-bitcoin';
import bignumber from 'bignumber.js';
import { getBitcoinAddressFromKey } from '../ec-helpers';

describe('Rosetta - Stacks 2.1 tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let bitcoinRpcClient: RPCClient;
  let btcAddr: string;
  let btcAddrTestnet: string;
  const account = testnetKeys[0];
  let poxInfo: CoreRpcPoxInfo;

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, bitcoinRpcClient } = testEnv);

    btcAddr = getBitcoinAddressFromKey({
      privateKey: account.secretKey,
      network: 'regtest',
      addressFormat: 'p2wpkh',
    });
    btcAddrTestnet = getBitcoinAddressFromKey({
      privateKey: account.secretKey,
      network: 'testnet',
      addressFormat: 'p2wpkh',
    });

    await Promise.resolve();
  });

  const rosettaNetwork: NetworkIdentifier = {
    blockchain: RosettaConstants.blockchain,
    network: getRosettaNetworkName(ChainID.Testnet),
  };

  function standByForTx(expectedTxId: string): Promise<DbTx> {
    return new Promise<DbTx>(resolve => {
      const listener: (txId: string) => void = async txId => {
        if (txId !== expectedTxId) {
          return;
        }
        const dbTxQuery = await api.datastore.getTx({ txId: txId, includeUnanchored: false });
        if (!dbTxQuery.found) {
          return;
        }
        api.datastore.eventEmitter.removeListener('txUpdate', listener);
        resolve(dbTxQuery.result);
      };
      api.datastore.eventEmitter.addListener('txUpdate', listener);
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

  async function fetchRosetta<TPostBody, TRes>(endpoint: string, body: TPostBody) {
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

  async function getRosettaBlockByHeight(blockHeight: number) {
    const dbBlockQuery = await api.datastore.getBlock({ height: blockHeight });
    if (!dbBlockQuery.found) {
      throw new Error(`block ${blockHeight} not found`);
    }
    return fetchRosetta<RosettaBlockRequest, RosettaBlockResponse>('/rosetta/v1/block', {
      network_identifier: { blockchain: 'stacks', network: 'testnet' },
      block_identifier: { hash: dbBlockQuery.result.block_hash },
    });
  }

  async function getRosettaBlockByBurnBlockHeight(burnBlockHeight: number) {
    const unlockDbBlock = await api.datastore.getBlockByBurnBlockHeight(burnBlockHeight);
    expect(unlockDbBlock.found).toBeTruthy();
    return fetchRosetta<RosettaBlockRequest, RosettaBlockResponse>('/rosetta/v1/block', {
      network_identifier: { blockchain: 'stacks', network: 'testnet' },
      block_identifier: { hash: unlockDbBlock.result!.block_hash },
    });
  }

  test('Rosetta - stack-stx', async () => {
    await bitcoinRpcClient.importaddress({ address: btcAddr, label: btcAddr, rescan: false });
    const cycleCount = 1;

    poxInfo = await client.getPox();
    const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

    const stackingOperations: RosettaOperation[] = [
      {
        operation_identifier: {
          index: 0,
          network_index: 0,
        },
        related_operations: [],
        type: 'stack_stx',
        account: {
          address: account.stacksAddress,
          metadata: {},
        },
        amount: {
          value: '-' + ustxAmount.toString(),
          currency: { symbol: 'STX', decimals: 6 },
          metadata: {},
        },
        metadata: {
          number_of_cycles: cycleCount,
          pox_addr: btcAddr,
        },
      },
      {
        operation_identifier: {
          index: 1,
          network_index: 0,
        },
        related_operations: [],
        type: 'fee',
        account: {
          address: account.stacksAddress,
          metadata: {},
        },
        amount: {
          value: '10000',
          currency: { symbol: 'STX', decimals: 6 },
        },
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
      max_fee: [
        {
          value: '12380898',
          currency: { symbol: 'STX', decimals: 6 },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 1,
    });

    // metadata
    const resultMetadata = await fetchRosetta<
      RosettaConstructionMetadataRequest,
      RosettaConstructionMetadataResponse
    >('/rosetta/v1/construction/metadata', {
      network_identifier: rosettaNetwork,
      options: preprocessResult.options!, // using options returned from preprocess
      public_keys: [{ hex_bytes: account.pubKey, curve_type: 'secp256k1' }],
    });

    // payload
    const payloadsResult = await fetchRosetta<
      RosettaConstructionPayloadsRequest,
      RosettaConstructionPayloadResponse
    >('/rosetta/v1/construction/payloads', {
      network_identifier: rosettaNetwork,
      operations: stackingOperations, // using same operations as preprocess request
      metadata: resultMetadata.metadata, // using metadata from metadata response
      public_keys: [{ hex_bytes: account.pubKey, curve_type: 'secp256k1' }],
    });

    // sign tx
    const stacksTx = deserializeTransaction(payloadsResult.unsigned_transaction);
    const signer = new TransactionSigner(stacksTx);
    signer.signOrigin(createStacksPrivateKey(account.secretKey));
    const signedSerializedTx = stacksTx.serialize().toString('hex');
    const expectedTxId = '0x' + stacksTx.txid();
    const txStandby = standByForTx(expectedTxId);

    // submit
    const submitResult = await fetchRosetta<
      RosettaConstructionSubmitRequest,
      RosettaConstructionSubmitResponse
    >('/rosetta/v1/construction/submit', {
      network_identifier: rosettaNetwork,
      signed_transaction: '0x' + signedSerializedTx,
    });

    expect(resultMetadata.metadata.contract_name).toBe('pox-2');
    expect(resultMetadata.metadata.burn_block_height as number).toBeTruthy();
    expect(submitResult.transaction_identifier.hash).toBe(expectedTxId);

    const dbTx = await txStandby;
    expect(dbTx.contract_call_contract_id).toBe('ST000000000000000000002AMW42H.pox-2');
  });

  test('Verify PoX rewards - Bitcoin RPC', async () => {
    // Wait until end of reward phase
    const rewardPhaseEndBurnBlock =
      poxInfo.next_cycle.reward_phase_start_block_height + poxInfo.reward_phase_block_length + 1;
    await standByUntilBurnBlock(rewardPhaseEndBurnBlock);

    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddrTestnet}`
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
      label: btcAddr,
      include_watchonly: true,
    });
    received = received.filter(r => r.address === btcAddr);
    expect(received.length).toBe(1);
    expect(received[0].category).toBe('receive');
    expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
    const sats = new bignumber(received[0].amount).shiftedBy(8).toString();
    expect(sats).toBe(firstReward.reward_amount);
  });

  test('Rosetta unlock events', async () => {
    // unlock_height: 115
    const rpcAccountInfo1 = await client.getAccount(account.stacksAddress);
    const rpcAccountLocked = BigInt(rpcAccountInfo1.locked).toString();
    const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;

    // Wait until account has unlocked (finished Stacking cycles)
    // (wait one more block due to test flakiness..)
    await standByUntilBurnBlock(burnBlockUnlockHeight + 1);

    // Check that STX are no longer reported as locked by the RPC endpoints:
    const rpcAccountInfo = await client.getAccount(account.stacksAddress);
    expect(BigInt(rpcAccountInfo.locked)).toBe(0n);
    expect(rpcAccountInfo.unlock_height).toBe(0);

    // Get Stacks block associated with the burn block `unlock_height` reported by RPC
    const unlockRstaBlock = await getRosettaBlockByBurnBlockHeight(rpcAccountInfo1.unlock_height);

    // Ensure Rosetta block contains a stx_unlock operation
    const unlockOp = unlockRstaBlock
      .block!.transactions.flatMap(t => t.operations)
      .find(op => op.type === 'stx_unlock')!;
    expect(unlockOp).toBeDefined();
    expect(unlockOp).toEqual(
      expect.objectContaining({
        type: 'stx_unlock',
        status: 'success',
        account: { address: account.stacksAddress },
        amount: { value: rpcAccountLocked, currency: { symbol: 'STX', decimals: 6 } },
      })
    );

    // ---- DEBUG junk under here
    return;

    const rewards = await fetchGet<BurnchainRewardListResponse>(
      `/extended/v1/burnchain/rewards/${btcAddr}`
    );
    // This is burn_block_height: 111
    const firstReward = rewards.results.sort(
      (a, b) => a.burn_block_height - b.burn_block_height
    )[0];

    // This is burn_block_height: 111 and (stacks) block_height: 8
    const dbBlock1 = await api.datastore.getBlockByBurnBlockHeight(firstReward.burn_block_height);
    if (!dbBlock1.found) {
      throw new Error(
        `Could not find block associated with burn block ${firstReward.burn_block_height}`
      );
    }

    // This is block_height: 4 and unlock_height: 1 ... ?????
    const unlockEvent = (
      await api.datastore.getAddressAssetEvents({
        stxAddress: account.stacksAddress,
        limit: 9999,
        offset: 0,
        blockHeight: 9999,
      })
    ).results.filter(r => r.event_type === DbEventTypeId.StxLock)[0];
    expect(unlockEvent).toBeDefined();

    const txQuery1 = await api.datastore.getTx({
      txId: unlockEvent.tx_id,
      includeUnanchored: false,
    });
    expect(txQuery1).toBeDefined();

    // block height: 12
    let actualUnlockBlock: RosettaBlockResponse | undefined;
    const chaintip = await api.datastore.getChainTip(api.datastore.sql);
    for (let i = unlockEvent.block_height; i <= chaintip.blockHeight; i++) {
      const b = await getRosettaBlockByHeight(i);
      if (b.block?.transactions.find(t => t.operations.find(op => op.type === 'stx_unlock'))) {
        actualUnlockBlock = b;
        break;
      }
    }
    if (!actualUnlockBlock) {
      throw new Error('Could not find actual unlock block height');
    }

    // burn_block_height: 115
    const unlockDbBlock = (
      await api.datastore.getBlock({
        height: actualUnlockBlock!.block!.block_identifier.index,
      })
    ).result!;
    expect(unlockDbBlock).toBeDefined();

    // block height: 12
    const expectedUnlockDbBlock = (
      await api.datastore.getBlockByBurnBlockHeight(rpcAccountInfo1.unlock_height)
    ).result!;
    expect(expectedUnlockDbBlock).toBeDefined();

    expect(expectedUnlockDbBlock.block_height).toBe(
      actualUnlockBlock!.block!.block_identifier.index
    );

    console.log('idk');
  });

  afterAll(async () => {
    await Promise.resolve();
  });
});
