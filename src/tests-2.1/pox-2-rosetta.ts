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
  getAddressFromPrivateKey,
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
  TransactionVersion,
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
  RosettaAccountBalanceRequest,
  RosettaAccountBalanceResponse,
  AddressStxBalanceResponse,
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
import { ECPair, getBitcoinAddressFromKey } from '../ec-helpers';
import { StacksNetwork } from '@stacks/network';
import { decodeClarityValue } from 'stacks-encoding-native-js';
import {
  fetchGet,
  standByForAccountUnlock,
  standByForPoxCycleEnd,
  standByForTx,
  standByForTxSuccess,
  standByUntilBlock,
  standByUntilBurnBlock,
  testEnv,
} from './test-helpers';

describe('PoX-2 - Rosetta - Stacking with segwit', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let client: StacksCoreRpcClient;
  let stacksNetwork: StacksNetwork;
  let bitcoinRpcClient: RPCClient;
  let btcAddr: string;
  let btcAddrTestnet: string;
  const seedAccount = testnetKeys[0];
  const accountKey = 'f4c5f7b724799370bea997b36ec922f1817e40637cb91d03ea14c8172b4ad9af01';
  let account: {
    stxAddr: string;
    secretKey: string;
    pubKey: string;
  };
  let testAccountBalance: bigint;
  let lastPoxInfo: CoreRpcPoxInfo;
  let ustxAmount: bigint;

  beforeAll(() => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, api, client, stacksNetwork, bitcoinRpcClient } = testEnv);

    const ecPair = ECPair.fromPrivateKey(Buffer.from(accountKey, 'hex').slice(0, 32), {
      compressed: true,
    });
    account = {
      stxAddr: getAddressFromPrivateKey(accountKey, TransactionVersion.Testnet),
      secretKey: accountKey,
      pubKey: ecPair.publicKey.toString('hex'),
    };

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
  });

  const rosettaNetwork: NetworkIdentifier = {
    blockchain: RosettaConstants.blockchain,
    network: getRosettaNetworkName(ChainID.Testnet),
  };

  async function fetchRosetta<TPostBody, TRes>(endpoint: string, body: TPostBody) {
    const result = await supertest(api.server)
      .post(endpoint)
      .send(body as any);
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

  async function getRosettaAccountBalance(stacksAddress: string, atBlockHeight?: number) {
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

  async function stackStxWithRosetta(opts: {
    btcAddr: string;
    stacksAddress: string;
    pubKey: string;
    privateKey: string;
    cycleCount: number;
    ustxAmount: bigint;
  }) {
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
    const signedSerializedTx = stacksTx.serialize().toString('hex');
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
      resultMetadata: metadataResult,
    };
  }

  test('Fund new account for testing', async () => {
    await bitcoinRpcClient.importaddress({ address: btcAddr, label: btcAddr, rescan: false });

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
    const { txId: stxXferId1 } = await client.sendTransaction(stxXfer1.serialize());

    const stxXferTx1 = await standByForTxSuccess(stxXferId1);
    expect(stxXferTx1.token_transfer_recipient_address).toBe(account.stxAddr);
    await standByUntilBlock(stxXferTx1.block_height);
  });

  test('Validate test account balance', async () => {
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

  test('Rosetta - stack-stx', async () => {
    const cycleCount = 1;

    const poxInfo = await client.getPox();
    lastPoxInfo = poxInfo;
    ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());

    const stackingResult = await stackStxWithRosetta({
      btcAddr: btcAddr,
      stacksAddress: account.stxAddr,
      pubKey: account.pubKey,
      privateKey: account.secretKey,
      cycleCount: cycleCount,
      ustxAmount: ustxAmount,
    });

    expect(stackingResult.resultMetadata.metadata.contract_name).toBe('pox-2');
    expect(stackingResult.resultMetadata.metadata.burn_block_height as number).toBeTruthy();
    expect(stackingResult.submitResult.transaction_identifier.hash).toBe(stackingResult.txId);
    expect(stackingResult.tx.contract_call_contract_id).toBe('ST000000000000000000002AMW42H.pox-2');
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
      lastPoxInfo.next_cycle.reward_phase_start_block_height +
      lastPoxInfo.reward_phase_block_length +
      1;
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
    const rpcAccountInfo1 = await client.getAccount(account.stxAddr);
    const rpcAccountLocked = BigInt(rpcAccountInfo1.locked).toString();
    const burnBlockUnlockHeight = rpcAccountInfo1.unlock_height + 1;

    // Wait until account has unlocked (finished Stacking cycles)
    // (wait one more block due to test flakiness..)
    await standByUntilBurnBlock(burnBlockUnlockHeight + 1);

    // verify STX unlocked - stacks-node account RPC balance
    const coreNodeBalance = await client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.locked)).toBe(0n);
    expect(coreNodeBalance.unlock_height).toBe(0);

    // verify STX unlocked - API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(0n);

    // verify STX unlocked - Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(0n);

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
        account: { address: account.stxAddr },
        amount: { value: rpcAccountLocked, currency: { symbol: 'STX', decimals: 6 } },
      })
    );
  });

  test('Stack below threshold to trigger early auto-unlock', async () => {
    const cycleCount = 5;

    const poxInfo = await client.getPox();
    ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 0.5).toString());

    const rosettaStackStx = await stackStxWithRosetta({
      btcAddr: btcAddr,
      stacksAddress: account.stxAddr,
      pubKey: account.pubKey,
      privateKey: account.secretKey,
      cycleCount,
      ustxAmount,
    });

    expect(rosettaStackStx.resultMetadata.metadata.contract_name).toBe('pox-2');
    expect(rosettaStackStx.resultMetadata.metadata.burn_block_height as number).toBeTruthy();
    expect(rosettaStackStx.submitResult.transaction_identifier.hash).toBe(rosettaStackStx.txId);
    expect(rosettaStackStx.tx.contract_call_contract_id).toBe(
      'ST000000000000000000002AMW42H.pox-2'
    );

    // ensure locked reported by stacks-node account RPC balance
    const coreNodeBalance = await client.getAccount(account.stxAddr);
    expect(BigInt(coreNodeBalance.locked)).toBe(ustxAmount);
    expect(coreNodeBalance.unlock_height).toBeGreaterThan(0);

    // ensure locked reported by API address endpoint balance
    const apiBalance = await fetchGet<AddressStxBalanceResponse>(
      `/extended/v1/address/${account.stxAddr}/stx`
    );
    expect(BigInt(apiBalance.locked)).toBe(ustxAmount);

    // ensure locked reported by Rosetta address endpoint balance
    const rosettaBalance = await getRosettaAccountBalance(account.stxAddr);
    expect(BigInt(rosettaBalance.locked.balances[0].value)).toBe(ustxAmount);
  });

  let earlyUnlockBurnHeight: number;
  test('Ensure account unlocks early', async () => {
    const initialAccountInfo = await client.getAccount(account.stxAddr);
    await standByForAccountUnlock(account.stxAddr);

    const poxInfo = await client.getPox();
    earlyUnlockBurnHeight = poxInfo.current_burnchain_block_height!;

    // ensure account unlocked early, before the typically expected unlock height
    expect(earlyUnlockBurnHeight).toBeLessThan(initialAccountInfo.unlock_height);

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

  test('Ensure unlock operation generated after auto-unlock', async () => {
    await standByUntilBurnBlock(earlyUnlockBurnHeight + 2);

    // Get Stacks block associated with the burn block `unlock_height` reported by RPC
    const unlockRstaBlock = await getRosettaBlockByBurnBlockHeight(earlyUnlockBurnHeight);

    // Ensure Rosetta block contains a stx_unlock operation
    const unlockOps = unlockRstaBlock
      .block!.transactions.flatMap(t => t.operations)
      .filter(op => op.type === 'stx_unlock')!;
    expect(unlockOps).toHaveLength(1);
    expect(unlockOps[0]).toEqual(
      expect.objectContaining({
        type: 'stx_unlock',
        status: 'success',
        account: { address: account.stxAddr },
        amount: { value: '0', currency: { symbol: 'STX', decimals: 6 } },
      })
    );

    // Ensure balance is unlocked
    const unlockStackBlock = await testEnv.db.getBlockByBurnBlockHeight(earlyUnlockBurnHeight);
    const balance = await getRosettaAccountBalance(
      account.stxAddr,
      unlockStackBlock.result!.block_height
    );
    expect(BigInt(balance.locked.balances[0].value)).toBe(0n);

    // Ensure balance from previous block is still reported as locked
    const prevStackBlock = await testEnv.db.getBlockByBurnBlockHeight(earlyUnlockBurnHeight - 1);
    const balancePrevBlock = await getRosettaAccountBalance(
      account.stxAddr,
      prevStackBlock.result!.block_height
    );
    expect(BigInt(balancePrevBlock.locked.balances[0].value)).toBe(ustxAmount);

    // Ensure balance in next block is reported as unlocked
    const nextStackBlock = await testEnv.db.getBlockByBurnBlockHeight(earlyUnlockBurnHeight + 1);
    const balanceNextBlock = await getRosettaAccountBalance(
      account.stxAddr,
      nextStackBlock.result!.block_height
    );
    expect(BigInt(balanceNextBlock.locked.balances[0].value)).toBe(0n);

    // Ensure stx_unlock operations and balances are correct for before and after blocks
    const surroundingBlocks = [earlyUnlockBurnHeight - 1, earlyUnlockBurnHeight + 1];
    for (const surroundingBlock of surroundingBlocks) {
      const block2 = await getRosettaBlockByBurnBlockHeight(surroundingBlock);
      const unlockOps2 = block2
        .block!.transactions.flatMap(t => t.operations)
        .filter(op => op.type === 'stx_unlock')!;
      expect(unlockOps2).toHaveLength(0);
    }
  });
});
