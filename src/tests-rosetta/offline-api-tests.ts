import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import {
  AnchorMode,
  AuthType,
  bufferCV,
  ChainID,
  createStacksPrivateKey,
  getPublicKey,
  makeSigHashPreSign,
  makeSTXTokenTransfer,
  makeUnsignedContractCall,
  makeUnsignedSTXTokenTransfer,
  MessageSignature,
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
import { bufferToHexPrefixString } from '../helpers';
import {
  RosettaConstructionCombineRequest,
  RosettaConstructionCombineResponse,
  RosettaAccountIdentifier,
  RosettaConstructionDeriveRequest,
  RosettaConstructionDeriveResponse,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
  RosettaConstructionParseRequest,
  RosettaConstructionParseResponse,
  RosettaConstructionPayloadsRequest,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
  RosettaConstructionMetadataResponse,
} from '@stacks/stacks-blockchain-api-types';
import {
  getRosettaNetworkName,
  RosettaConstants,
  RosettaErrors,
  RosettaErrorsTypes,
  RosettaOperationTypes,
  RosettaOperationStatuses,
} from '../api/rosetta-constants';
import { OfflineDummyStore } from '../datastore/offline-dummy-store';
import { getStacksTestnetNetwork, testnetKeys } from '../api/routes/debug';
import { getSignature, getStacksNetwork, publicKeyToBitcoinAddress } from '../rosetta-helpers';
import * as nock from 'nock';
import * as poxHelpers from '../pox-helpers';
import { PgStore } from '../datastore/pg-store';
import { decodeBtcAddress } from '@stacks/stacking';

describe('Rosetta offline API', () => {
  let db: PgStore;
  let api: ApiServer;

  beforeAll(async () => {
    db = OfflineDummyStore;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1:3999');
  });

  test('Success: offline - network/list', async () => {
    const query1 = await supertest(api.server).post(`/rosetta/v1/network/list`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      network_identifiers: [{ blockchain: 'stacks', network: 'testnet' }],
    });
  });

  test('Success: offline - network/options- offline', async () => {
    const nodeVersion = process.version;
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

  test('Fail: offline - network/status', async () => {
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
    expect(query1.status).toBe(400);
  });

  test('Fail: Offline - block - get latest', async () => {
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: {},
      });
    expect(query1.status).toBe(500);
  });

  // /* rosetta construction api tests below */

  test('Success: offline - construction/derive', async () => {
    const request: RosettaConstructionDeriveRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const accountIdentifier: RosettaAccountIdentifier = {
      address: 'ST19SH1QSCR8VMEX6SVWP33WCF08RPDY5QVHX94BM',
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

  test('Success: offline - construction/preprocess', async () => {
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

  test('offline construction/preprocess - stacking', async () => {
    const request: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
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
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '270',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
          },
        },
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'stack_stx',
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
          metadata: {
            number_of_cycles: 3,
            pox_addr: '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3'
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

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse: RosettaConstructionPreprocessResponse = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        fee: '270',
        type: 'stack_stx',
        suggested_fee_multiplier: 1,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 260,
        number_of_cycles: 3,
        pox_addr: '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3'
      },
      required_public_keys: [
        {
          address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        },
      ],
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('offline construction/preprocess - delegate-stacking', async () => {
    const request: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
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
            address: testnetKeys[0].stacksAddress,
            metadata: {},
          },
          amount: {
            value: '270',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
          },
        },
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'delegate_stx',
          account: {
            address: testnetKeys[0].stacksAddress,
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
          metadata: {
            pox_addr: '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3',
            delegate_to: testnetKeys[1].stacksAddress
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

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse: RosettaConstructionPreprocessResponse = {
      options: {
        sender_address: testnetKeys[0].stacksAddress,
        delegate_to: testnetKeys[1].stacksAddress,
        fee: '270',
        type: 'delegate_stx',
        suggested_fee_multiplier: 1,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 253,
        pox_addr: '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3'
      },
      required_public_keys: [
        {
          address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        },
      ],
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('Success: offline - construction/hash', async () => {
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

  test('Success: offline - construction/parse - signed', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = 1000;
    const fee = 180;
    const nonce = 0;
    const options: SignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      senderKey: testnetKeys[0].secretKey,
      nonce: nonce,
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
      transaction: bufferToHexPrefixString(Buffer.from(testTransaction.serialize())),
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

  test('Success: offline - construction/parse - unsigned', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = 1000;
    const fee = 180;
    const nonce = 0;
    const tokenTransferOptions: UnsignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      nonce: nonce,
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
      transaction: bufferToHexPrefixString(Buffer.from(testTransaction.serialize())),
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

  test('Success: offline - payloads single sign', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[1].secretKey));
    const sender = testnetKeys[1].stacksAddress;
    const recipient = testnetKeys[0].stacksAddress;
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
        fee: fee,
        account_sequence: 0,
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
      amount: 500000,
      fee: fee,
      publicKey: publicKey,
      network: getStacksNetwork(),
      nonce: 0,
      anchorMode: AnchorMode.Any,
    };

    const transaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);
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

  test('Success: offline - payloads multi sig', async () => {
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

  test('Sucess: offline - payloads single sign - stacking', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));
    const sender = testnetKeys[0].stacksAddress;
    const fee = '270';
    const contract_address = 'ST000000000000000000002AMW42H';
    const contract_name = 'pox-3';
    const stacking_amount = 5000;
    const burn_block_height = 200;
    const number_of_cycles = 5;

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
            pox_addr : '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3',
          }
        },
      ],
      metadata: {
        account_sequence: 0,
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

    const poxBTCAddress = '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3'

    const { version: hashMode, data } = decodeBtcAddress(poxBTCAddress);
    const hashModeBuffer = bufferCV(Buffer.from([hashMode]));
    const hashbytes = bufferCV(data);
    const poxAddressCV = tupleCV({
      hashbytes,
      version: hashModeBuffer,
    });


    const stackingTx: UnsignedContractCallOptions = {
      contractAddress: contract_address,
      contractName: contract_name,
      functionName: 'stack-stx',
      publicKey: publicKey,
      functionArgs: [
        uintCV(stacking_amount),
        poxAddressCV,
        uintCV(burn_block_height),
        uintCV(number_of_cycles),
      ],
      validateWithAbi: false,
      nonce: 0,
      fee: fee,
      network: getStacksNetwork(),
      anchorMode: AnchorMode.Any,
    };
    const transaction = await makeUnsignedContractCall(stackingTx);
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

  test('Sucess: offline - payloads single sign - delegate - stacking', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));
    const sender = testnetKeys[0].stacksAddress;
    const fee = '270';
    const contract_address = 'ST000000000000000000002AMW42H';
    const contract_name = 'pox-3';
    const stacking_amount = 5000;
    const burn_block_height  = 200;


    const metadataResponse: RosettaConstructionMetadataResponse = {
      metadata: {
        fee:fee,
        sender_address: sender,
        type: 'delegate_stx',
        suggested_fee_multiplier: 1,
        amount: stacking_amount,
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        delegate_to: testnetKeys[1].stacksAddress,
        size: 260,
        contract_address: contract_address,
        contract_name: contract_name,
        account_sequence: 0,
        recent_block_hash: '0x969e494d5aee0166016836f97bbeb3d9473bea8427e477e9de253f78d3212354',
        burn_block_height: burn_block_height
      },
      suggested_fee: [ { value: '390', currency: {symbol: 'STX', decimals: 6} } ]
    }

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
          },
        },
        {
          operation_identifier: {
            index: 1,
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
          },
          metadata: {
            delegate_to: testnetKeys[1].stacksAddress,
            pox_addr : '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3',
          }
        },
      ],
      metadata: metadataResponse.metadata,
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };

    const poxBTCAddress = '1Xik14zRm29UsyS6DjhYg4iZeZqsDa8D3'

    const { version: hashMode, data } = decodeBtcAddress(poxBTCAddress);
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
        standardPrincipalCV(testnetKeys[1].stacksAddress),
        someCV(uintCV(burn_block_height)),
        someCV(poxAddressCV),
      ],
      fee: fee,
      nonce: 0,
      validateWithAbi: false,
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

  test('Success: offline - combine single sign success', async () => {
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

  test('Success: offline - combine multi sig', async () => {
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

  /* rosetta construction end */

  afterAll(async () => {
    await api.terminate();
    nock.cleanAll();
    nock.enableNetConnect()
  });
});
