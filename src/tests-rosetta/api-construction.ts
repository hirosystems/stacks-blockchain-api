import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import {
  RosettaConstructionDeriveRequest,
  RosettaConstructionDeriveResponse,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
} from '@blockstack/stacks-blockchain-api-types';

import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbBlock, DbTx, DbMempoolTx, DbTxStatus } from '../datastore/common';
import * as assert from 'assert';
import { makeSTXTokenTransfer, StacksTestnet } from '@blockstack/stacks-transactions';
import * as BN from 'bn.js';
import { getCoreNodeEndpoint, StacksCoreRpcClient } from '../core-rpc/client';
import { timeout } from '../helpers';
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

  test('construction preprocess api success', async () => {
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
  });

  test('construction preprocess api failure', async () => {
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

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve()));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
