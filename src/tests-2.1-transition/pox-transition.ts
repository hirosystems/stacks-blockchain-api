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
  ChainID,
  deserializeTransaction,
  TransactionSigner,
  createStacksPrivateKey,
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
import { getRosettaNetworkName, RosettaConstants } from '../api/rosetta-constants';

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

  const rosettaNetwork: NetworkIdentifier = {
    blockchain: RosettaConstants.blockchain,
    network: getRosettaNetworkName(ChainID.Testnet),
  };

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

  async function standByForAccountUnlock(address: string): Promise<void> {
    while (true) {
      const poxInfo = await client.getPox();
      const info = await client.getInfo();
      const accountInfo = await client.getAccount(address);
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
      expect(BigInt(addrBalance.locked)).toBe(BigInt(accountInfo.locked));
      if (BigInt(accountInfo.locked) === 0n) {
        break;
      }
      await standByUntilBlock(info.stacks_tip_height + 1);
    }
  }

  async function fetchGet<TRes>(endpoint: string) {
    const result = await supertest(api.server).get(endpoint);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
  }

  async function fetchRosetta<TPostBody, TRes>(endpoint: string, body: TPostBody) {
    const result = await supertest(api.server)
      .post(endpoint)
      .send(body as any);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
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

  describe('Consistent API and RPC account balances through pox transitions', () => {
    const account = testnetKeys[1];
    let btcAddr: string;
    let btcRegtestAccount: VerboseKeyOutput;
    let btcPubKey: string;
    let decodedBtcAddr: { version: number; data: Buffer };
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
        const [contractAddress, contractName] = poxInfo.contract_id.split('.');
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
        const sendResult1 = await client.sendTransaction(tx1.serialize());
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
    let decodedBtcAddr: { version: number; data: Buffer };
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
          expect(poxInfo.current_burnchain_block_height).toBe(status.pox_v1_unlock_height! + 1);
          expect(poxInfo.current_burnchain_block_height).toBe(
            poxInfo.contract_versions![1].activation_burnchain_block_height + 1
          );
          break;
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
      const [contractAddress, contractName] = poxInfo.contract_id.split('.');
      expect(contractName).toBe('pox-2');
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

  describe('Rosetta - Stacks 2.1 transition tests', () => {
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
      const { txId: stxXferId1 } = await client.sendTransaction(stxXfer1.serialize());

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

      expect(rosettaStackStx.resultMetadata.metadata.contract_name).toBe('pox');
      expect(rosettaStackStx.resultMetadata.metadata.burn_block_height as number).toBeTruthy();
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
        poxInfo.next_cycle.reward_phase_start_block_height + poxInfo.reward_phase_block_length + 1;
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
      expect(received[0].blockhash).toBe(hexToBuffer(firstReward.burn_block_hash).toString('hex'));
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

      expect(rosettaStackStx.resultMetadata.metadata.contract_name).toBe('pox');
      expect(rosettaStackStx.resultMetadata.metadata.burn_block_height as number).toBeTruthy();
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

    // TODO: unlock operations not yet generated for pox_v1_unlock_height transition
    test.skip('Ensure unlock ops are generated for pox_v1_unlock_height block', async () => {
      // Get Stacks block associated with the burn block `unlock_height` reported by RPC
      const unlockRstaBlock = await getRosettaBlockByBurnBlockHeight(poxV1UnlockHeight + 1);

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
          amount: { value: ustxAmount, currency: { symbol: 'STX', decimals: 6 } },
        })
      );
    });
  });
});
