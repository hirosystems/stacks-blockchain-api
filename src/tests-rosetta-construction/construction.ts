import { bufferToHex, timeout } from '@hirosystems/api-toolkit';
import { hexToBytes } from '@stacks/common';
import { StackingClient, decodeBtcAddress, poxAddressToTuple } from '@stacks/stacking';
import {
  RosettaAccountIdentifier,
  RosettaConstructionCombineRequest,
  RosettaConstructionCombineResponse,
  RosettaConstructionDeriveRequest,
  RosettaConstructionDeriveResponse,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionMetadataResponse,
  RosettaConstructionParseRequest,
  RosettaConstructionParseResponse,
  RosettaConstructionPayloadsRequest,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
} from '../rosetta/types';
import {
  AnchorMode,
  AuthType,
  ChainID,
  MessageSignature,
  SignedTokenTransferOptions,
  TransactionSigner,
  UnsignedContractCallOptions,
  UnsignedTokenTransferOptions,
  bufferCV,
  createStacksPrivateKey,
  getPublicKey,
  makeSTXTokenTransfer,
  makeSigHashPreSign,
  makeUnsignedContractCall,
  makeUnsignedSTXTokenTransfer,
  noneCV,
  pubKeyfromPrivKey,
  publicKeyToString,
  someCV,
  standardPrincipalCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import * as assert from 'assert';
import * as supertest from 'supertest';
import { ApiServer, startApiServer } from '../api/init';
import {
  RosettaConstants,
  RosettaErrors,
  RosettaErrorsTypes,
  RosettaOperationStatuses,
  RosettaOperationTypes,
  getRosettaNetworkName,
} from '../api/rosetta-constants';
import { getStacksTestnetNetwork, testnetKeys } from '../api/routes/debug';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { DbBlock } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { FoundOrNot } from '../helpers';
import { getSignature, getStacksNetwork } from '../rosetta/rosetta-helpers';
import {
  standByForPoxCycle,
  standByForTx as standByForTxShared,
  standByUntilBurnBlock,
} from '../test-utils/test-helpers';

describe('Rosetta Construction', () => {
  let db: PgWriteStore;
  // let eventServer: Server;
  let api: ApiServer;

  const standByForTx = (expectedTxId: string) => standByForTxShared(expectedTxId, api);

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    process.env.STACKS_CHAIN_ID = '0x80000000';
    db = await PgWriteStore.connect({ usageName: 'tests' });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
    await new StacksCoreRpcClient().waitForConnection(60000);
  });

  afterAll(async () => {
    await api.terminate();
    await db?.close();
  });

  /* rosetta construction api tests below */

  test('construction/derive', async () => {
    const request: RosettaConstructionDeriveRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: publicKeyToString(
          getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
        ),
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const accountIdentifier: RosettaAccountIdentifier = {
      address: testnetKeys[0].stacksAddress,
    };
    const expectResponse: RosettaConstructionDeriveResponse = {
      account_identifier: accountIdentifier,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);

    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'this is an invalid curve type',
        hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
      },
    };

    const result2 = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request2);
    expect(result2.status).toBe(400);

    const expectedResponse2 = RosettaErrors[RosettaErrorsTypes.invalidCurveType];

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);

    const request3 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: 'this is an invalid public key',
      },
    };

    const result3 = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request3);
    expect(result3.status).toBe(400);

    const expectedResponse3 = RosettaErrors[RosettaErrorsTypes.invalidPublicKey];

    expect(JSON.parse(result3.text)).toEqual(expectedResponse3);
  });

  test('construction/preprocess', async () => {
    const request: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        memo: 'SAMPLE MEMO',
      },
      max_fee: [
        {
          value: '12380898',
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 1,
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse: RosettaConstructionPreprocessResponse = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        suggested_fee_multiplier: 1,
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        memo: 'SAMPLE MEMO',
        size: 180,
      },
      required_public_keys: [
        {
          address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        },
      ],
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/preprocess - failure', async () => {
    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'invalid operation type',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {},
      max_fee: [
        {
          value: '12380898',
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 1,
    };

    const result2 = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request2);
    expect(result2.status).toBe(400);

    const expectedResponse2 = RosettaErrors[RosettaErrorsTypes.invalidOperation];

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);
  });

  test('construction/metadata - success', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: testnetKeys[0].stacksAddress,
        type: 'token_transfer',
        suggested_fee_multiplier: 1,
        token_transfer_recipient_address: testnetKeys[1].stacksAddress,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
        memo: 'SAMPLE MEMO',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(JSON.parse(result.text)).toHaveProperty('metadata');
    expect(JSON.parse(result.text)).toHaveProperty('suggested_fee');
    expect(parseInt(JSON.parse(result.text).suggested_fee[0].value)).toBeGreaterThan(100);
    expect(JSON.parse(result.text).metadata.memo).toBe('SAMPLE MEMO');
  });

  test('construction/metadata - empty network identifier', async () => {
    const request = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 613,
      message: 'Network identifier object is null.',
      retriable: false,
      details: {
        message: "must have required property 'network_identifier'",
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid transfer type', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 625,
      message: 'Invalid transaction type',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid sender address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'abc',
        type: 'token_transfer',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 626,
      message: 'Invalid sender address',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid recipient address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        token_transfer_recipient_address: 'xyz',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 627,
      message: 'Invalid recipient address',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/hash', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction:
        '0x80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b400017a33a91515ef48608a99c6adecd2eb258e11534a1acf66348f5678c8e2c8f83d243555ed67a0019d3500df98563ca31321c1a675b43ef79f146e322fe08df75103020000000000051a1ae3f911d8f1d46d7416bfbe4b593fd41eac19cb000000000007a12000000000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(200);

    const expectedResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0xf3b054a5fbae98f7f35e5e917b65759fc365a3e073f8af1c3b8d211b286fa74a',
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - no `0x` prefix', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction:
        '0x80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c010200000000040000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(200);

    const expectedResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0x592fad4733f3e5c65e7dd9c82ad848191993a80cb3d891b6514bda6e3e7a239e',
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - odd number of hex digits', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction:
        '80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c01020000000004000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidTransactionString];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - unsigned transaction', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      //unsigned transaction bytes
      signed_transaction:
        '0x80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051a1ae3f911d8f1d46d7416bfbe4b593fd41eac19cb000000000007a12000000000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.transactionNotSigned];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/parse - signed', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = 1000;
    const fee = 180;
    const options: SignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      senderKey: testnetKeys[0].secretKey,
      network: getStacksTestnetNetwork(),
      anchorMode: AnchorMode.Any,
    };
    const testTransaction = await makeSTXTokenTransfer(options);
    const request: RosettaConstructionParseRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      signed: true,
      transaction: bufferToHex(Buffer.from(testTransaction.serialize())),
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/parse`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const actual: RosettaConstructionParseResponse = JSON.parse(result.text);
    // test fee operation
    expect(actual.operations[0].account?.address).toEqual(senderAddr);
    expect(actual.operations[0].amount?.value).toEqual('-' + fee.toString());
    // test sender
    expect(actual.operations[1].account?.address).toEqual(senderAddr);
    expect(actual.operations[1].amount?.value).toEqual('-' + amount.toString());
    // test recipient
    expect(actual.operations[2].account?.address).toEqual(recipientAddr);
    expect(actual.operations[2].amount?.value).toEqual(amount.toString());
    // test signer
    expect(actual.account_identifier_signers?.[0].address).toEqual(senderAddr);
  });

  test('construction/parse - unsigned', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = 1000;
    const fee = 180;
    const tokenTransferOptions: UnsignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      publicKey: publicKey,
      network: getStacksTestnetNetwork(),
      anchorMode: AnchorMode.Any,
    };
    const testTransaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);

    const request: RosettaConstructionParseRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      signed: false,
      transaction: bufferToHex(Buffer.from(testTransaction.serialize())),
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/parse`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    const actual: RosettaConstructionParseResponse = JSON.parse(result.text);
    // test fee operation
    expect(actual.operations[0].account?.address).toEqual(senderAddr);
    expect(actual.operations[0].amount?.value).toEqual('-' + fee.toString());
    // test sender
    expect(actual.operations[1].account?.address).toEqual(senderAddr);
    expect(actual.operations[1].amount?.value).toEqual('-' + amount.toString());
    // test recipient
    expect(actual.operations[2].account?.address).toEqual(recipientAddr);
    expect(actual.operations[2].amount?.value).toEqual(amount.toString());
  });

  test('construction/submit', async () => {
    const txOptions = {
      senderKey: testnetKeys[0].secretKey,
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: 12345,
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: 0,
      fee: 200,
      anchorMode: AnchorMode.Any,
    };

    const transaction = await makeSTXTokenTransfer(txOptions);
    const serializedTx = Buffer.from(transaction.serialize()).toString('hex');

    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      // signed transaction bytes
      signed_transaction: '0x' + serializedTx,
    };
    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(request);

    expect(result.status).toBe(200);
  });

  test('construction/submit - unsigned', async () => {
    const txOptions = {
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: 12345,
      publicKey: publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey)),
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: 0,
      fee: 200,
      anchorMode: AnchorMode.Any,
    };

    const transaction = await makeUnsignedSTXTokenTransfer(txOptions);
    const serializedTx = Buffer.from(transaction.serialize()).toString('hex');

    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      //unsigned transaction bytes
      signed_transaction: '0x' + serializedTx,
    };
    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(request);
    expect(result.status).toBe(400);
    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidTransactionString];

    expect(JSON.parse(result.text)).toMatchObject(expectedResponse);
  });

  test('payloads single sign success', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));
    const sender = testnetKeys[0].stacksAddress;
    const recipient = testnetKeys[1].stacksAddress;
    const fee = '270';

    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-' + fee,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 2,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: recipient,
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        account_sequence: 0,
        memo: 'SAMPLE MEMO',
      },
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };

    const tokenTransferOptions: UnsignedTokenTransferOptions = {
      recipient: recipient,
      amount: '500000',
      fee: fee,
      publicKey: publicKey,
      network: getStacksNetwork(),
      nonce: 0,
      memo: 'SAMPLE MEMO',
      anchorMode: AnchorMode.Any,
    };

    const transaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);
    const unsignedTransaction = Buffer.from(transaction.serialize());
    // const hexBytes = digestSha512_256(unsignedTransaction).toString('hex');

    const signer = new TransactionSigner(transaction);

    const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, fee, 0);

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const accountIdentifier: RosettaAccountIdentifier = {
      address: sender,
    };

    const expectedResponse = {
      unsigned_transaction: '0x' + unsignedTransaction.toString('hex'),
      payloads: [
        {
          address: sender,
          account_identifier: accountIdentifier,
          hex_bytes: prehash,
          signature_type: 'ecdsa_recovery',
        },
      ],
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads multi sig', async () => {
    const publicKey1 = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));
    const publicKey2 = publicKeyToString(pubKeyfromPrivKey(testnetKeys[1].secretKey));

    const sender = testnetKeys[0].stacksAddress;
    const recipient = testnetKeys[1].stacksAddress;
    const fee = '270';

    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-' + fee,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 2,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: recipient,
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        fee,
        account_sequence: 0,
      },
      public_keys: [
        {
          hex_bytes: publicKey1,
          curve_type: 'secp256k1',
        },
        {
          hex_bytes: publicKey2,
          curve_type: 'secp256k1',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.needOnePublicKey];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads single sign - stacking', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));
    const sender = testnetKeys[0].stacksAddress;
    const fee = '270';
    const contract_address = 'ST000000000000000000002AMW42H';
    const contract_name = 'pox-4';
    const stacking_amount = 5000;
    const burn_block_height = 200;
    const number_of_cycles = 5;
    const reward_cycle_id = 3;
    const pox_auth_id = 234565725;
    const poxBTCAddress = '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3';

    const signerPrivKey = '929c9b8581473c67df8a21c2a4a12f74762d913dd39d91295ee96e779124bca9';
    const signerPubKey = '033b67384665cbc3a36052a2d1c739a6cd1222cd451c499400c9d42e2041a56161';

    const stackingClient = new StackingClient('', getStacksTestnetNetwork());
    const signerSig = stackingClient.signPoxSignature({
      topic: 'stack-stx',
      poxAddress: poxBTCAddress,
      rewardCycle: reward_cycle_id,
      period: number_of_cycles,
      signerPrivateKey: createStacksPrivateKey(signerPrivKey),
      maxAmount: stacking_amount,
      authId: pox_auth_id,
    });

    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: fee,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {
              number_of_cycles: 5,
            },
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'stack_stx',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-' + stacking_amount,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
          },
          metadata: {
            number_of_cycles: number_of_cycles,
            pox_addr: poxBTCAddress,
            signer_key: signerPubKey,
            signer_private_key: signerPrivKey,
            reward_cycle_id: reward_cycle_id,
            pox_auth_id: pox_auth_id,
            signer_signature: signerSig,
          },
        },
      ],
      metadata: {
        account_sequence: 0,
        number_of_cycles: number_of_cycles,
        contract_address: contract_address,
        contract_name: contract_name,
        burn_block_height: burn_block_height,
      },
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };

    const stackingTx: UnsignedContractCallOptions = {
      contractAddress: contract_address,
      contractName: contract_name,
      functionName: 'stack-stx',
      publicKey: publicKey,
      functionArgs: [
        uintCV(stacking_amount), // amount-ustx
        poxAddressToTuple(poxBTCAddress), // pox-addr
        uintCV(burn_block_height), // start-burn-ht
        uintCV(number_of_cycles), // lock-period
        someCV(bufferCV(hexToBytes(signerSig))), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(stacking_amount), // max-amount
        uintCV(pox_auth_id), // auth-id
      ],
      validateWithAbi: false,
      nonce: 0,
      fee: fee,
      network: getStacksNetwork(),
      anchorMode: AnchorMode.Any,
    };
    const transaction = await makeUnsignedContractCall(stackingTx);
    const unsignedTransaction = Buffer.from(transaction.serialize());

    const signer = new TransactionSigner(transaction);

    const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, fee, 0);

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const accountIdentifier: RosettaAccountIdentifier = {
      address: sender,
    };

    const expectedResponse = {
      unsigned_transaction: '0x' + unsignedTransaction.toString('hex'),
      payloads: [
        {
          address: sender,
          account_identifier: accountIdentifier,
          hex_bytes: prehash,
          signature_type: 'ecdsa_recovery',
        },
      ],
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads public key not added', async () => {
    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-180',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 2,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        fee: '270',
        account_sequence: 0,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.emptyPublicKey];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads public key invalid curve type', async () => {
    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-180',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 2,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        account_sequence: 0,
      },
      public_keys: [
        {
          hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
          curve_type: 'edwards25519',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidCurveType];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine single sign success', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));

    const txOptions: UnsignedTokenTransferOptions = {
      publicKey: publicKey,
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: 12345,
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: 0,
      fee: 200,
      anchorMode: AnchorMode.Any,
    };

    const unsignedTransaction = await makeUnsignedSTXTokenTransfer(txOptions);
    const unsignedSerializedTx = Buffer.from(unsignedTransaction.serialize()).toString('hex');

    const signer = new TransactionSigner(unsignedTransaction);

    const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, 200, 0);

    signer.signOrigin(createStacksPrivateKey(testnetKeys[0].secretKey));
    const signedSerializedTx = Buffer.from(signer.transaction.serialize()).toString('hex');

    const signature: MessageSignature = getSignature(signer.transaction) as MessageSignature;

    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction: '0x' + unsignedSerializedTx,
      signatures: [
        {
          signing_payload: {
            hex_bytes: prehash,
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: publicKey,
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: signature.data.slice(2) + signature.data.slice(0, 2),
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectedResponse: RosettaConstructionCombineResponse = {
      signed_transaction: '0x' + signedSerializedTx,
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine multi sig', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction:
        '00000000010400539886f96611ba3ba6cef9618f8c78118b37c5be0000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051ab71a091b4b8b7661a661c620966ab6573bc2dcd3000000000007a12074657374207472616e73616374696f6e000000000000000000000000000000000000',
      signatures: [
        {
          signing_payload: {
            hex_bytes:
              '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
            signature_type: 'ecdsa',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa',
          hex_bytes:
            '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
        },
        {
          signing_payload: {
            hex_bytes:
              '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes:
            '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.needOnlyOneSignature];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine invalid transaction', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction: 'invalid transaction',
      signatures: [
        {
          signing_payload: {
            hex_bytes:
              '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes:
            '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidTransactionString];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine invalid signature', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction:
        '00000000010400539886f96611ba3ba6cef9618f8c78118b37c5be0000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051ab71a091b4b8b7661a661c620966ab6573bc2dcd3000000000007a12074657374207472616e73616374696f6e000000000000000000000000000000000000',
      signatures: [
        {
          signing_payload: {
            hex_bytes: 'invalid signature',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: 'invalid signature',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidSignature];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine signature not verified', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));

    const txOptions: UnsignedTokenTransferOptions = {
      publicKey: publicKey,
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: 12345,
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: 0,
      fee: 200,
      anchorMode: AnchorMode.Any,
    };

    const unsignedTransaction = await makeUnsignedSTXTokenTransfer(txOptions);
    const unsignedSerializedTx = Buffer.from(unsignedTransaction.serialize()).toString('hex');

    const signer = new TransactionSigner(unsignedTransaction);
    signer.signOrigin(createStacksPrivateKey(testnetKeys[1].secretKey)); // use different secret key to sign

    const signature = getSignature(unsignedTransaction);
    if (!signature) throw Error('Signature undefined');

    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction: unsignedSerializedTx,
      signatures: [
        {
          signing_payload: {
            hex_bytes: signature.data,
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: signature.data,
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.signatureNotVerified];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine invalid public key', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction:
        '80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b4000136212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f03020000000000051ab71a091b4b8b7661a661c620966ab6573bc2dcd3000000000007a12074657374207472616e73616374696f6e000000000000000000000000000000000000',
      signatures: [
        {
          signing_payload: {
            hex_bytes:
              '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: 'invalid  public key',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes:
            '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.signatureNotVerified];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/metadata - stacking', async () => {
    await standByForPoxCycle(api, new StacksCoreRpcClient());

    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'stack_stx',
        suggested_fee_multiplier: 1,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        number_of_cycles: 3,
        size: 260,
        pox_addr: '2MtzNEqm2D9jcbPJ5mW7Z3AUNwqt3afZH66',
        signer_key: '02'.repeat(33),
      },
      public_keys: [{ hex_bytes: publicKey, curve_type: 'secp256k1' }],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    expect(JSON.parse(result.text)).toHaveProperty('metadata');
    expect(JSON.parse(result.text)).toHaveProperty('suggested_fee');
    expect(JSON.parse(result.text).metadata).toHaveProperty('contract_address');
    expect(JSON.parse(result.text).metadata).toHaveProperty('contract_name');
    expect(JSON.parse(result.text).metadata).toHaveProperty('burn_block_height');
    expect(parseInt(JSON.parse(result.text).suggested_fee[0].value)).toBeGreaterThan(100);
  });

  test('construction/metadata - delegate_stacking', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        fee: '270',
        sender_address: testnetKeys[0].stacksAddress,
        type: 'delegate_stx',
        suggested_fee_multiplier: 1,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        delegate_to: testnetKeys[1].stacksAddress,
        size: 260,
      },
      public_keys: [{ hex_bytes: publicKey, curve_type: 'secp256k1' }],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const accountInfo = await new StacksCoreRpcClient().getAccount(testnetKeys[0].stacksAddress);
    const nonce = accountInfo.nonce;

    const metadataResponse: RosettaConstructionMetadataResponse = {
      metadata: {
        fee: '270',
        sender_address: testnetKeys[0].stacksAddress,
        type: 'delegate_stx',
        suggested_fee_multiplier: 1,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        delegate_to: testnetKeys[1].stacksAddress,
        size: 260,
        contract_address: 'ST000000000000000000002AMW42H',
        contract_name: 'pox-4',
        account_sequence: nonce,
        recent_block_hash: '0x969e494d5aee0166016836f97bbeb3d9473bea8427e477e9de253f78d3212354',
      },
      suggested_fee: [
        { value: expect.stringMatching(/^\d+$/), currency: { symbol: 'STX', decimals: 6 } },
      ],
    };

    expect(result.body).toHaveProperty('metadata');
    expect(result.body.suggested_fee).toStrictEqual(metadataResponse.suggested_fee);
    expect(result.body.metadata.sender_address).toBe(metadataResponse.metadata.sender_address);
    expect(result.body.metadata.type).toBe(metadataResponse.metadata.type);
    expect(result.body.metadata.suggested_fee_multiplier).toBe(
      metadataResponse.metadata.suggested_fee_multiplier
    );
    expect(result.body.metadata.amount).toBe(metadataResponse.metadata.amount);
    expect(result.body.metadata.symbol).toBe(metadataResponse.metadata.symbol);
    expect(result.body.metadata.decimals).toBe(metadataResponse.metadata.decimals);
    expect(result.body.metadata.max_fee).toBe(metadataResponse.metadata.max_fee);
    expect(result.body.metadata.delegate_to).toBe(metadataResponse.metadata.delegate_to);
    expect(result.body.metadata.size).toBe(metadataResponse.metadata.size);
    expect(result.body.metadata.contract_address).toBe(metadataResponse.metadata.contract_address);
    expect(result.body.metadata.contract_name).toBe(metadataResponse.metadata.contract_name);
    expect(result.body.metadata.fee).toBe(metadataResponse.metadata.fee);
    expect(result.body.metadata.nonce).toBe(metadataResponse.metadata.nonce);
    expect(result.body.metadata.recent_block_hash).toBeTruthy();
  });

  test('stacking rosetta transaction cycle', async () => {
    //derive
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const deriveRequest: RosettaConstructionDeriveRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: publicKey,
      },
    };
    const deriveResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(deriveRequest);

    expect(deriveResult.status).toBe(200);
    expect(deriveResult.type).toBe('application/json');

    const deriveExpectResponse: RosettaConstructionDeriveResponse = {
      account_identifier: { address: testnetKeys[0].stacksAddress },
    };

    expect(deriveResult.body).toEqual(deriveExpectResponse);

    //preprocess
    const fee = '600';
    const stacking_amount = '1250180000000000'; //minimum stacking
    const sender = deriveResult.body.account_identifier.address;
    const number_of_cycles = 1;
    const pox_addr = '2MtzNEqm2D9jcbPJ5mW7Z3AUNwqt3afZH66';
    const size = 405;
    const max_fee = '12380898';
    const pox_auth_id = '234565725';
    const signerPrivKey = '929c9b8581473c67df8a21c2a4a12f74762d913dd39d91295ee96e779124bca9';
    const signerPubKey = '033b67384665cbc3a36052a2d1c739a6cd1222cd451c499400c9d42e2041a56161';

    const preprocessRequest: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'stack_stx',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-' + stacking_amount,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
          metadata: {
            number_of_cycles: number_of_cycles,
            pox_addr: pox_addr,
            pox_auth_id: pox_auth_id,
            signer_key: signerPubKey,
            signer_private_key: signerPrivKey,
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
            address: sender,
            metadata: {},
          },
          amount: {
            value: fee,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
          },
        },
      ],
      metadata: {},
      max_fee: [
        {
          value: max_fee,
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 1,
    };
    const preprocessResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(preprocessRequest);

    expect(preprocessResult.status).toBe(200);
    expect(preprocessResult.type).toBe('application/json');

    const expectResponse: RosettaConstructionPreprocessResponse = {
      options: {
        fee: fee,
        sender_address: sender,
        type: 'stack_stx',
        suggested_fee_multiplier: 1,
        amount: stacking_amount,
        symbol: 'STX',
        decimals: 6,
        max_fee: max_fee,
        size: size,
        number_of_cycles: number_of_cycles,
        pox_addr: pox_addr,
        pox_auth_id: pox_auth_id,
        signer_key: signerPubKey,
        signer_private_key: signerPrivKey,
      },
      required_public_keys: [
        {
          address: sender,
        },
      ],
    };
    expect(preprocessResult.body).toEqual(expectResponse);

    //metadata
    const metadataRequest: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      options: preprocessResult.body.options, //using options returned from preprocess
      public_keys: [{ hex_bytes: publicKey, curve_type: 'secp256k1' }],
    };
    const resultMetadata = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(metadataRequest);
    expect(resultMetadata.status).toBe(200);
    expect(resultMetadata.type).toBe('application/json');
    expect(JSON.parse(resultMetadata.text)).toHaveProperty('metadata');
    expect(JSON.parse(resultMetadata.text)).toHaveProperty('suggested_fee');
    expect(JSON.parse(resultMetadata.text).metadata).toHaveProperty('contract_address');
    expect(JSON.parse(resultMetadata.text).metadata).toHaveProperty('contract_name');
    expect(JSON.parse(resultMetadata.text).metadata).toHaveProperty('burn_block_height');
    expect(parseInt(JSON.parse(resultMetadata.text).suggested_fee[0].value)).toBeGreaterThan(100);

    //payloads
    const contract_address = resultMetadata.body.metadata.contract_address;
    const contract_name = resultMetadata.body.metadata.contract_name;
    const burn_block_height = resultMetadata.body.metadata.burn_block_height;
    const reward_cycle_id = resultMetadata.body.metadata.reward_cycle_id;
    const nonce = resultMetadata.body.metadata.account_sequence;
    const payloadsRequest: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: preprocessRequest.operations, //using operations same as preprocess request
      metadata: resultMetadata.body.metadata, //using metadata from metadata response
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };

    const stackingClient = new StackingClient('', getStacksTestnetNetwork());
    const signerSig = stackingClient.signPoxSignature({
      topic: 'stack-stx',
      poxAddress: pox_addr,
      rewardCycle: reward_cycle_id,
      period: number_of_cycles,
      signerPrivateKey: createStacksPrivateKey(signerPrivKey),
      maxAmount: stacking_amount,
      authId: pox_auth_id,
    });
    const stackingTx: UnsignedContractCallOptions = {
      contractAddress: contract_address,
      contractName: contract_name,
      functionName: 'stack-stx',
      publicKey: publicKey,
      functionArgs: [
        uintCV(stacking_amount), // amount-ustx
        poxAddressToTuple(pox_addr), // pox-addr
        uintCV(burn_block_height), // start-burn-ht
        uintCV(number_of_cycles), // lock-period
        someCV(bufferCV(hexToBytes(signerSig))), // signer-sig
        bufferCV(hexToBytes(signerPubKey)), // signer-key
        uintCV(stacking_amount), // max-amount
        uintCV(pox_auth_id), // auth-id
      ],
      validateWithAbi: false,
      nonce: nonce,
      fee: fee,
      network: getStacksNetwork(),
      anchorMode: AnchorMode.Any,
    };
    const transaction = await makeUnsignedContractCall(stackingTx);
    const unsignedTransaction = Buffer.from(transaction.serialize());
    const signer = new TransactionSigner(transaction);
    const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, fee, nonce);
    const payloadsResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(payloadsRequest);
    expect(payloadsResult.status).toBe(200);
    expect(payloadsResult.type).toBe('application/json');
    const accountIdentifier: RosettaAccountIdentifier = {
      address: sender,
    };
    const payloadsExpectedResponse = {
      unsigned_transaction: '0x' + unsignedTransaction.toString('hex'),
      payloads: [
        {
          address: sender,
          account_identifier: accountIdentifier,
          hex_bytes: prehash,
          signature_type: 'ecdsa_recovery',
        },
      ],
    };
    expect(JSON.parse(payloadsResult.text)).toEqual(payloadsExpectedResponse);

    //combine
    signer.signOrigin(createStacksPrivateKey(testnetKeys[0].secretKey));
    const signedSerializedTx = Buffer.from(signer.transaction.serialize()).toString('hex');
    const signature: MessageSignature = getSignature(signer.transaction) as MessageSignature;
    const combineRequest: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      unsigned_transaction: payloadsExpectedResponse.unsigned_transaction,
      signatures: [
        {
          signing_payload: {
            hex_bytes: prehash,
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: publicKey,
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: signature.data.slice(2) + signature.data.slice(0, 2),
        },
      ],
    };
    const combineResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(combineRequest);
    expect(combineResult.status).toBe(200);
    expect(combineResult.type).toBe('application/json');
    const combineExpectedResponse: RosettaConstructionCombineResponse = {
      signed_transaction: '0x' + signedSerializedTx,
    };
    expect(combineResult.body).toEqual(combineExpectedResponse);

    //hash
    const hashRequest: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction: combineExpectedResponse.signed_transaction,
    };

    const hashResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/hash`)
      .send(hashRequest);
    expect(hashResult.status).toBe(200);

    const hashExpectedResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0x' + transaction.txid(),
      },
    };

    expect(JSON.parse(hashResult.text)).toEqual(hashExpectedResponse);

    //submit
    const submitRequest: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      // signed transaction bytes
      signed_transaction: combineResult.body.signed_transaction,
    };
    const submitResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(submitRequest);
    expect(submitResult.status).toBe(200);
    expect(submitResult.body.transaction_identifier.hash).toBe(
      hashExpectedResponse.transaction_identifier.hash
    );

    //rosetta block
    const stxLockedTransaction = await standByForTx(submitResult.body.transaction_identifier.hash);

    const blockHeight = stxLockedTransaction.block_height;
    let block = await api.datastore.getBlock({ height: blockHeight });
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);

    const blockStxOpsQuery = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: block.result.block_hash },
      });
    expect(blockStxOpsQuery.status).toBe(200);
    expect(blockStxOpsQuery.type).toBe('application/json');

    const stxOpsTx = blockStxOpsQuery.body.block.transactions.find(
      (tx: any) => tx.transaction_identifier.hash === stxLockedTransaction.tx_id
    );
    const stackStxOp = stxOpsTx.operations.find((op: any) => op.type === 'stack_stx');
    const stxUnlockHeight = Number.parseInt(stackStxOp.metadata.unlock_burn_height);
    expect(stxUnlockHeight).toBeTruthy();

    const blockTxOpsQuery = await supertest(api.address)
      .post('/rosetta/v1/block/transaction')
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: block.result.block_hash },
        transaction_identifier: { hash: stxLockedTransaction.tx_id },
      });
    expect(blockTxOpsQuery.status).toBe(200);
    expect(blockTxOpsQuery.type).toBe('application/json');

    const expectedStackStxOp = {
      type: 'stack_stx',
      account: {
        address: testnetKeys[0].stacksAddress,
      },
      metadata: {
        lock_period: number_of_cycles.toString(),
        amount_ustx: stacking_amount,
        stacker_address: testnetKeys[0].stacksAddress,
        pox_addr: pox_addr,
        start_burn_height: burn_block_height.toString(),
        unlock_burn_height: stxUnlockHeight.toString(),
      },
    };

    const expectedStxLockOp = {
      type: 'stx_lock',
      account: {
        address: testnetKeys[0].stacksAddress,
      },
      metadata: {
        locked: stacking_amount,
        unlock_height: stxUnlockHeight.toString(),
      },
      amount: {
        value: '-' + stacking_amount,
        currency: {
          decimals: 6,
          symbol: 'STX',
        },
      },
    };

    expect(stxOpsTx.operations).toContainEqual(expect.objectContaining(expectedStackStxOp));
    expect(stxOpsTx.operations).toContainEqual(expect.objectContaining(expectedStxLockOp));

    expect(blockTxOpsQuery.body.operations).toContainEqual(
      expect.objectContaining(expectedStackStxOp)
    );
    expect(blockTxOpsQuery.body.operations).toContainEqual(
      expect.objectContaining(expectedStxLockOp)
    );

    // wait for the unlock block height
    const unlockBlockResult = await standByUntilBurnBlock(stxUnlockHeight, api);
    block = { found: true, result: unlockBlockResult };

    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: block.result.block_hash },
      });

    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(query1.body.block.transactions[0].operations[0].type).toBe('coinbase');
    expect(query1.body.block.transactions[0].operations[1].type).toBe('stx_unlock');

    const query2 = await supertest(api.address)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: block.result.block_hash },
        transaction_identifier: {
          hash: query1.body.block.transactions[0].transaction_identifier.hash,
        },
      });

    const expectedResponse = {
      operation_identifier: {
        index: 1,
      },
      type: 'stx_unlock',
      status: 'success',
      account: {
        address: testnetKeys[0].stacksAddress,
      },
      amount: {
        value: stacking_amount,
        currency: {
          decimals: 6,
          symbol: 'STX',
        },
      },
      metadata: {
        tx_id: query1.body.block.transactions[0].transaction_identifier.hash,
      },
    };
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(query2.body.operations[1]).toStrictEqual(expectedResponse);
  });

  //---------------------

  test('delegate-stacking rosetta transaction cycle', async () => {
    await standByForPoxCycle(api, new StacksCoreRpcClient());

    //derive
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[1].secretKey))
    );
    const deriveRequest: RosettaConstructionDeriveRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: publicKey,
      },
    };
    const deriveResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(deriveRequest);

    expect(deriveResult.status).toBe(200);
    expect(deriveResult.type).toBe('application/json');

    const deriveExpectResponse: RosettaConstructionDeriveResponse = {
      account_identifier: { address: testnetKeys[1].stacksAddress },
    };

    expect(deriveResult.body).toEqual(deriveExpectResponse);

    //preprocess
    const fee = '293';
    const stacking_amount = '1250180000000000'; //minimum stacking
    const sender = deriveResult.body.account_identifier.address;
    const pox_addr = '2MtzNEqm2D9jcbPJ5mW7Z3AUNwqt3afZH66';
    const clarityPoxAddr =
      '0x0c000000020968617368627974657302000000141320e6542e2146ea486700f4091aa793e73607880776657273696f6e020000000101';
    const size = 253;
    const max_fee = '12380898';
    const delegate_to = testnetKeys[2].stacksAddress;

    const preprocessRequest: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'delegate_stx',
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-' + stacking_amount,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
          metadata: {
            pox_addr: pox_addr,
            delegate_to: delegate_to,
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
            address: sender,
            metadata: {},
          },
          amount: {
            value: fee,
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
          },
        },
      ],
      metadata: {},
      max_fee: [
        {
          value: max_fee,
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 1,
    };

    const preprocessResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(preprocessRequest);

    expect(preprocessResult.status).toBe(200);
    expect(preprocessResult.type).toBe('application/json');

    const expectResponse: RosettaConstructionPreprocessResponse = {
      options: {
        fee: fee,
        sender_address: sender,
        type: 'delegate_stx',
        suggested_fee_multiplier: 1,
        amount: stacking_amount,
        symbol: 'STX',
        decimals: 6,
        max_fee: max_fee,
        size: size,
        pox_addr: pox_addr,
        delegate_to: testnetKeys[2].stacksAddress,
      },
      required_public_keys: [
        {
          address: sender,
        },
      ],
    };
    expect(preprocessResult.body).toEqual(expectResponse);

    // //metadata

    const contract_address = 'ST000000000000000000002AMW42H';
    const contract_name = 'pox-4';

    const metadataRequest: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      options: preprocessResult.body.options, //using options returned from preprocess
      public_keys: [{ hex_bytes: publicKey, curve_type: 'secp256k1' }],
    };

    const resultMetadata = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(metadataRequest);

    const accountInfo = await new StacksCoreRpcClient().getAccount(sender);
    const nonce = accountInfo.nonce;

    const metadataResponse: RosettaConstructionMetadataResponse = {
      metadata: {
        fee: fee,
        sender_address: sender,
        type: 'delegate_stx',
        suggested_fee_multiplier: 1,
        amount: stacking_amount,
        symbol: 'STX',
        decimals: 6,
        max_fee: max_fee,
        delegate_to: testnetKeys[2].stacksAddress,
        size: size,
        contract_address: contract_address,
        contract_name: contract_name,
        account_sequence: nonce,
        recent_block_hash: '0x969e494d5aee0166016836f97bbeb3d9473bea8427e477e9de253f78d3212354',
      },
      suggested_fee: [
        { value: expect.stringMatching(/^\d+$/), currency: { symbol: 'STX', decimals: 6 } },
      ],
    };
    expect(resultMetadata.body).toHaveProperty('metadata');
    expect(resultMetadata.body.suggested_fee).toStrictEqual(metadataResponse.suggested_fee);
    expect(resultMetadata.body.metadata.sender_address).toBe(
      metadataResponse.metadata.sender_address
    );
    expect(resultMetadata.body.metadata.type).toBe(metadataResponse.metadata.type);
    expect(resultMetadata.body.metadata.suggested_fee_multiplier).toBe(
      metadataResponse.metadata.suggested_fee_multiplier
    );
    expect(resultMetadata.body.metadata.amount).toBe(metadataResponse.metadata.amount);
    expect(resultMetadata.body.metadata.symbol).toBe(metadataResponse.metadata.symbol);
    expect(resultMetadata.body.metadata.decimals).toBe(metadataResponse.metadata.decimals);
    expect(resultMetadata.body.metadata.max_fee).toBe(metadataResponse.metadata.max_fee);
    expect(resultMetadata.body.metadata.delegate_to).toBe(metadataResponse.metadata.delegate_to);
    expect(resultMetadata.body.metadata.size).toBe(metadataResponse.metadata.size);
    expect(resultMetadata.body.metadata.contract_address).toBe(
      metadataResponse.metadata.contract_address
    );
    expect(resultMetadata.body.metadata.contract_name).toBe(
      metadataResponse.metadata.contract_name
    );
    expect(resultMetadata.body.metadata.fee).toBe(metadataResponse.metadata.fee);
    expect(resultMetadata.body.metadata.nonce).toBe(metadataResponse.metadata.nonce);
    expect(resultMetadata.body.metadata.recent_block_hash).toBeTruthy(); //can not predict recent block hash

    //payloads
    const payloadsRequest: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: preprocessRequest.operations, //using operations same as preprocess request
      metadata: resultMetadata.body.metadata, //using metadata from metadata response
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };
    const { version: hashMode, data } = decodeBtcAddress(pox_addr);
    const hashModeBuffer = bufferCV(Buffer.from([hashMode]));
    const hashbytes = bufferCV(data);
    const poxAddressCV = tupleCV({
      hashbytes,
      version: hashModeBuffer,
    });

    const stackingTx: UnsignedContractCallOptions = {
      contractAddress: contract_address,
      contractName: contract_name,
      functionName: 'delegate-stx',
      publicKey: publicKey,
      functionArgs: [
        uintCV(stacking_amount),
        standardPrincipalCV(testnetKeys[2].stacksAddress),
        noneCV(),
        someCV(poxAddressCV),
      ],
      fee: fee,
      nonce: nonce,
      validateWithAbi: false,
      network: getStacksNetwork(),
      anchorMode: AnchorMode.Any,
    };

    const transaction = await makeUnsignedContractCall(stackingTx);
    const unsignedTransaction = Buffer.from(transaction.serialize());
    const signer = new TransactionSigner(transaction);
    const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, fee, nonce);
    const payloadsResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(payloadsRequest);
    expect(payloadsResult.status).toBe(200);
    expect(payloadsResult.type).toBe('application/json');
    const accountIdentifier: RosettaAccountIdentifier = {
      address: sender,
    };
    const payloadsExpectedResponse = {
      unsigned_transaction: '0x' + unsignedTransaction.toString('hex'),
      payloads: [
        {
          address: sender,
          account_identifier: accountIdentifier,
          hex_bytes: prehash,
          signature_type: 'ecdsa_recovery',
        },
      ],
    };
    expect(JSON.parse(payloadsResult.text)).toEqual(payloadsExpectedResponse);

    //combine
    signer.signOrigin(createStacksPrivateKey(testnetKeys[1].secretKey));
    const signedSerializedTx = Buffer.from(signer.transaction.serialize()).toString('hex');
    const signature: MessageSignature = getSignature(signer.transaction) as MessageSignature;
    const combineRequest: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      unsigned_transaction: payloadsExpectedResponse.unsigned_transaction,
      signatures: [
        {
          signing_payload: {
            hex_bytes: prehash,
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: publicKey,
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: signature.data.slice(2) + signature.data.slice(0, 2),
        },
      ],
    };
    const combineResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(combineRequest);
    expect(combineResult.status).toBe(200);
    expect(combineResult.type).toBe('application/json');
    const combineExpectedResponse: RosettaConstructionCombineResponse = {
      signed_transaction: '0x' + signedSerializedTx,
    };
    expect(combineResult.body).toEqual(combineExpectedResponse);

    // //hash
    const hashRequest: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction: combineExpectedResponse.signed_transaction,
    };

    const hashResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/hash`)
      .send(hashRequest);
    expect(hashResult.status).toBe(200);

    const hashExpectedResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0x' + transaction.txid(),
      },
    };

    expect(JSON.parse(hashResult.text)).toEqual(hashExpectedResponse);

    //submit
    const submitRequest: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      // signed transaction bytes
      signed_transaction: combineResult.body.signed_transaction,
    };
    const submitResult = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(submitRequest);

    expect(submitResult.status).toBe(200);
    expect(submitResult.body.transaction_identifier.hash).toBe(
      hashExpectedResponse.transaction_identifier.hash
    );

    // //rosetta block
    const delegateStx = await standByForTx(submitResult.body.transaction_identifier.hash);

    const blockHeight = delegateStx.block_height;
    const block = await api.datastore.getBlock({ height: blockHeight });
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);

    const blockStxOpsQuery = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: block.result.block_hash },
      });
    expect(blockStxOpsQuery.status).toBe(200);
    expect(blockStxOpsQuery.type).toBe('application/json');

    const stxOpsTx = blockStxOpsQuery.body.block.transactions.find(
      (tx: any) => tx.transaction_identifier.hash === delegateStx.tx_id
    );
    expect(stxOpsTx.operations[1]).toMatchObject({
      type: 'delegate_stx',
      account: {
        address: testnetKeys[1].stacksAddress,
      },
      metadata: {
        amount_ustx: stacking_amount,
        pox_addr: clarityPoxAddr,
        delegate_to: delegate_to,
      },
    });
  });

  /* rosetta construction end */

  // Test network endpoints here because it requires a connection to the stacks-node RPC endpoints
  describe('Rosetta network', () => {
    test('network/list', async () => {
      const query1 = await supertest(api.server).post(`/rosetta/v1/network/list`);
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      expect(JSON.parse(query1.text)).toEqual({
        network_identifiers: [{ blockchain: 'stacks', network: 'testnet' }],
      });
    });

    test('network/options', async () => {
      const nodeVersion = process.version;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const middlewareVersion = require('../../package.json').version;
      const query1 = await supertest(api.server)
        .post(`/rosetta/v1/network/options`)
        .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');
      expect(JSON.parse(query1.text)).toEqual({
        version: {
          rosetta_version: '1.4.6',
          node_version: nodeVersion,
          middleware_version: middlewareVersion,
        },
        allow: {
          operation_statuses: RosettaOperationStatuses,
          operation_types: RosettaOperationTypes,
          errors: Object.values(RosettaErrors),
          historical_balance_lookup: true,
        },
      });
    });

    test('network/options - bad request', async () => {
      const query1 = await supertest(api.server).post(`/rosetta/v1/network/options`).send({});
      expect(query1.status).toBe(400);
      expect(query1.type).toBe('application/json');
      expect(JSON.parse(query1.text)).toEqual({
        code: 613,
        message: 'Network identifier object is null.',
        retriable: false,
        details: { message: "must have required property 'network_identifier'" },
      });
    });

    test('network/status - invalid blockchain', async () => {
      const query1 = await supertest(api.server)
        .post(`/rosetta/v1/network/status`)
        .send({ network_identifier: { blockchain: 'bitcoin', network: 'testnet' } });
      expect(query1.status).toBe(400);
      expect(query1.type).toBe('application/json');
      expect(JSON.parse(query1.text)).toEqual({
        code: 611,
        message: 'Invalid blockchain.',
        retriable: false,
      });
    });

    test('network/status - invalid network', async () => {
      const query1 = await supertest(api.server)
        .post(`/rosetta/v1/network/status`)
        .send({ network_identifier: { blockchain: 'stacks', network: 'mainnet' } });
      expect(query1.status).toBe(400);
      expect(query1.type).toBe('application/json');
      expect(JSON.parse(query1.text)).toEqual({
        code: 610,
        message: 'Invalid network.',
        retriable: false,
      });
    });

    test('network/status', async () => {
      let genesisData: FoundOrNot<DbBlock>;
      do {
        genesisData = await db.getBlock({ height: 1 });
        if (!genesisData.found) {
          await timeout(150);
        }
      } while (!genesisData.found);

      const genesisBlock = genesisData.result;

      const query1 = await supertest(api.address)
        .post(`/rosetta/v1/network/status`)
        .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
      expect(query1.status).toBe(200);
      expect(query1.type).toBe('application/json');

      const blockQuery = await db.getCurrentBlock();
      if (!blockQuery.found) {
        throw new Error(`Could not get current block`);
      }
      const block = blockQuery.result;

      const expectResponse = {
        current_block_identifier: {
          index: block.block_height,
          hash: block.block_hash,
        },
        current_block_timestamp: block.burn_block_time * 1000,
        genesis_block_identifier: {
          index: genesisBlock.block_height,
          hash: genesisBlock.block_hash,
        },
        peers: [],
      };

      const queryResult = JSON.parse(query1.text);

      expect(queryResult).toHaveProperty('sync_status');

      expect(queryResult.current_block_identifier).toBeTruthy();
      expect(queryResult.current_block_timestamp).toBeTruthy();

      expect(queryResult.genesis_block_identifier).toEqual(expectResponse.genesis_block_identifier);
    });
  });
});
