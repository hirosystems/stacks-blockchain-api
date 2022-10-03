/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { TestEnvContext } from './setup';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbBlock, DbTx, DbTxStatus } from '../datastore/common';
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
import { StacksCoreRpcClient } from '../core-rpc/client';
import { bufferToHexPrefixString, FoundOrNot, timeout } from '../helpers';
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

describe('Stacks 2.1 tests', () => {
  let db: PgWriteStore;
  let eventServer: Server;
  let api: ApiServer;
  let client: StacksCoreRpcClient;

  beforeAll(async () => {
    const testEnv: TestEnvContext = (global as any).testEnv;
    ({ db, eventServer, api, client } = testEnv);
    await Promise.resolve();
  });

  const rosettaNetwork: NetworkIdentifier = {
    blockchain: RosettaConstants.blockchain,
    network: getRosettaNetworkName(ChainID.Testnet),
  };

  function standByForTx(expectedTxId: string): Promise<DbTx> {
    const broadcastTx = new Promise<DbTx>(resolve => {
      const listener: (txId: string) => void = async txId => {
        const dbTxQuery = await api.datastore.getTx({ txId: txId, includeUnanchored: false });
        if (!dbTxQuery.found) {
          return;
        }
        const dbTx = dbTxQuery.result;
        if (dbTx.tx_id === expectedTxId) {
          api.datastore.eventEmitter.removeListener('txUpdate', listener);
          resolve(dbTx);
        }
      };
      api.datastore.eventEmitter.addListener('txUpdate', listener);
    });

    return broadcastTx;
  }

  async function fetchRosetta<TPostBody, TRes>(endpoint: string, body: TPostBody) {
    const result = await supertest(api.server)
      .post(endpoint)
      .send(body as any);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    return result.body as TRes;
  }

  test('Rosetta - stack-stx', async () => {
    const account = testnetKeys[0];
    const btcAddr = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
    const cycleCount = 1;

    const poxInfo = await client.getPox();
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
    // const expectedTxId = stacksTx.txid();
    // const txStandby = standByForTx(expectedTxId);

    // submit
    const submitResult = await fetchRosetta<
      RosettaConstructionSubmitRequest,
      RosettaConstructionSubmitResponse
    >('/rosetta/v1/construction/submit', {
      network_identifier: rosettaNetwork,
      signed_transaction: '0x' + signedSerializedTx,
    });

    expect(submitResult.transaction_identifier.hash).toBeTruthy();
    expect(resultMetadata.metadata.burn_block_height as number).toBeTruthy();

    // const dbTx = await txStandby;
    // expect(dbTx.contract_call_contract_id).toBe('asdfsadf.pox-2');
  });

  afterAll(async () => {
    await Promise.resolve();
  });
});
