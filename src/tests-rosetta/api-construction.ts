import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import {
  RosettaConstructionDeriveRequest,
  RosettaConstructionDeriveResponse,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
} from '@blockstack/stacks-blockchain-api-types';

import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { RosettaConstants, RosettaErrors } from './../api/rosetta-constants';

describe('Rosetta API', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: Server;
  let api: ApiServer;

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    eventServer = await startEventServer({ db });
    api = await startApiServer(db);
  });

  /**derive api test cases */
  test('derive api', async () => {
    const request: RosettaConstructionDeriveRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
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

    const expectResponse: RosettaConstructionDeriveResponse = {
      address: 'ST19SH1QSCR8VMEX6SVWP33WCF08RPDY5QVHX94BM',
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);

    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
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

    const expectedResponse2 = RosettaErrors.invalidCurveType;

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);

    const request3 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
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

    const expectedResponse3 = RosettaErrors.invalidPublicKey;

    expect(JSON.parse(result3.text)).toEqual(expectedResponse3);
  });
  /** end */

  /** preprocess api test cases */
  test('preprocess api', async () => {
    const request: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          status: 'success',
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
          status: 'success',
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
          status: 'success',
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
      suggested_fee_multiplier: 0,
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
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);

    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          status: 'success',
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
          type: 'invalid operation type',
          status: 'success',
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
          status: 'success',
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
      suggested_fee_multiplier: 0,
    };

    const result2 = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request2);
    expect(result2.status).toBe(400);

    const expectedResponse2 = RosettaErrors.invalidOperation;

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);
  });
  /** end */

  /**meta data api test cases  */
  test('metadata api', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(JSON.parse(result.text)).toHaveProperty('metadata');
  });

  test('metadata api empty network identifier', async () => {
    const request = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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
      retriable: true,
      details: {
        message: "should have required property 'network_identifier'",
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('metadata invalid transfer type', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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

  test('metadata invalid sender address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'abc',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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

  test('metadata invalid recipient address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'xyz',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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
  /** end */

  /**hash api test cases */
  test('construction hash api success', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
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

  test('construction hash api no `0x` prefix', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      signed_transaction:
        '80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c010200000000040000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors.invalidTransactionString;

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction hash api odd number of hex digits  ', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      signed_transaction:
        '80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c01020000000004000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors.invalidTransactionString;

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction hash api an unsigned transaction  ', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      //unsigned transaction bytes
      signed_transaction:
        '0x80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051a1ae3f911d8f1d46d7416bfbe4b593fd41eac19cb000000000007a12000000000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors.transactionNotSigned;

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });
  /** end */

  test('metadata api', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(JSON.parse(result.text)).toHaveProperty('metadata');
  });

  test('metadata api empty network identifier', async () => {
    const request = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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
      retriable: true,
      details: {
        message: "should have required property 'network_identifier'",
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('metadata invalid transfer type', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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

  test('metadata invalid sender address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'abc',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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

  test('metadata invalid recipient address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'xyz',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
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

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve()));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
