import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { validate } from '../api/rosetta-validate';
import { DbBlock, DbBnsName, DbBnsNamespace, DbBnsSubdomain } from '../datastore/common';
import * as StacksTransactions from '@stacks/transactions';
import { ChainID } from '@stacks/transactions';
import { I32_MAX } from '../helpers';

const nameSpaceExpected = {
  type: StacksTransactions.ClarityType.ResponseOk,
  value: {
    type: StacksTransactions.ClarityType.UInt,
    value: 3,
    co: 0,
  },
};

const nameExpected = {
  type: StacksTransactions.ClarityType.ResponseOk,
  value: {
    type: StacksTransactions.ClarityType.UInt,
    value: 6,
    co: 0,
  },
};

//mock readOnly function in transaction module
jest.mock('@stacks/transactions', () => {
  const originalModule = jest.requireActual('@stacks/transactions');

  const mockReadOnlyFunction = jest
    .fn(()=> nameSpaceExpected)
    .mockImplementationOnce(() => nameSpaceExpected)
    .mockImplementationOnce(() => nameExpected);
  return {
    __esModule: true,
    ...originalModule,
    callReadOnlyFunction: mockReadOnlyFunction,
  };
});

describe('BNS API tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;

  const dbBlock: DbBlock = {
    block_hash: '0xff',
    index_block_hash: '0x1234',
    parent_index_block_hash: '0x5678',
    parent_block_hash: '0x5678',
    parent_microblock_hash: '',
    parent_microblock_sequence: 0,
    block_height: 1,
    burn_block_time: 1594647995,
    burn_block_hash: '0x1234',
    burn_block_height: 123,
    miner_txid: '0x4321',
    canonical: true,
    execution_cost_read_count: 0,
    execution_cost_read_length: 0,
    execution_cost_runtime: 0,
    execution_cost_write_count: 0,
    execution_cost_write_length: 0,
  };

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });

    await db.updateBlock(client, dbBlock);

    const namespace: DbBnsNamespace = {
      namespace_id: 'abc',
      address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
      base: 1,
      coeff: 1,
      launched_at: 14,
      lifetime: 1,
      no_vowel_discount: 1,
      nonalpha_discount: 1,
      ready_block: dbBlock.block_height,
      reveal_block: 6,
      status: 'ready',
      buckets: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNamespaces(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      namespace
    );

    const name: DbBnsName = {
      name: 'xyz',
      address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      namespace_id: 'abc',
      registered_at: dbBlock.block_height,
      expire_block: 14,
      zonefile:
        '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
      zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      name
    );
  });

  test('Success: namespaces', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(query1.body.namespaces.length).toBe(1);
  });

  test('Validate: namespace response schema', async () => {
    const query1 = await supertest(api.server).get('/v1/namespaces');
    const result = JSON.parse(query1.text);
    const path =
      '@stacks/stacks-blockchain-api-types/api/bns/namespace-operations/bns-get-all-namespaces-response.schema.json';
    const valid = await validate(path, result);
    expect(valid.valid).toBe(true);
  });

  test('Validate: namespaces returned length', async () => {
    const query1 = await supertest(api.server).get('/v1/namespaces');
    const result = JSON.parse(query1.text);
    expect(result.namespaces.length).toBe(1);
  });

  test('Validate: namespace id returned correct', async () => {
    const query1 = await supertest(api.server).get('/v1/namespaces');
    const result = JSON.parse(query1.text);
    expect(result.namespaces[0]).toBe('abc');
  });

  test('Success: fetching names from namespace', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces/abc/names`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
  });

  test('Namespace not found', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces/def/names`);
    expect(query1.status).toBe(404);
  });

  test('Validate: names returned length', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces/abc/names`);
    expect(query1.status).toBe(200);
    const result = JSON.parse(query1.text);
    expect(result.length).toBe(1);
  });

  test('Validate: name returned for namespace', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces/abc/names`);
    expect(query1.status).toBe(200);
    const result = JSON.parse(query1.text);
    expect(result[0]).toBe('xyz');
  });

  test('Success: namespaces/{namespace}/name schema', async () => {
    const query1 = await supertest(api.server).get('/v1/namespaces/abc/names');
    const result = JSON.parse(query1.text);
    const path =
      '@stacks/stacks-blockchain-api-types/api/bns/namespace-operations/bns-get-all-namespaces-names-response.schema.json';
    const valid = await validate(path, result);
    expect(valid.valid).toBe(true);
  });

  test('Invalid page for names', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces/abc/names?page=1`);
    expect(query1.status).toBe(400);
  });

  test('Success: names returned with page number in namespaces/{namespace}/names', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces/abc/names?page=0`);
    expect(query1.status).toBe(200);
  });

  test('Fail namespace price', async () => {
    // if namespace length greater than 20 chars
    const query1 = await supertest(api.server).get(`/v2/prices/namespaces/someLongIdString12345`);
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
  });

  test('Success: namespace price', async () => {
    const query1 = await supertest(api.server).get(`/v2/prices/namespaces/testabc`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text).amount).toBe('3');
  });

  test('Success: name price', async () => {
    const query1 = await supertest(api.server).get(`/v2/prices/names/test.abc`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text).amount).toBe('6');
  });

  test('Success:  validate namespace price schema', async () => {
    const query1 = await supertest(api.server).get(`/v2/prices/namespaces/abc`);
    const result = JSON.parse(query1.text);
    const path =
      '@stacks/stacks-blockchain-api-types/api/bns/namespace-operations/bns-get-namespace-price-response.schema.json';
    const valid = await validate(path, result);
    expect(valid.valid).toBe(true);
  });

  test('Success: validate name price schema', async () => {
    const query1 = await supertest(api.server).get(`/v2/prices/names/test.abc`);
    const result = JSON.parse(query1.text);
    const path =
      '@stacks/stacks-blockchain-api-types/api/bns/name-querying/bns-get-name-price-response.schema.json';
    const valid = await validate(path, result);
    expect(valid.valid).toBe(true);
  });

  test('Fail names price invalid name', async () => {
    // if name is without dot
    const query1 = await supertest(api.server).get(`/v2/prices/names/withoutdot`);
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
  });

  test('Fail names price invalid name multi dots', async () => {
    const query1 = await supertest(api.server).get(`/v2/prices/names/name.test.id`);
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
  });

  test('Success zonefile by name and hash', async () => {
    const name = 'test';
    const zonefileHash = 'test-hash';
    const zonefile = 'test-zone-file';

    const dbName: DbBnsName = {
      name: name,
      address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      namespace_id: '',
      expire_block: 10000,
      zonefile: zonefile,
      zonefile_hash: zonefileHash,
      registered_at: dbBlock.block_height,
      canonical: true,
      tx_id: '',
      tx_index: 0,
      status: 'name_register',
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      dbName
    );

    const query1 = await supertest(api.server).get(`/v1/names/${name}/zonefile/${zonefileHash}`);
    expect(query1.status).toBe(200);
    expect(query1.body.zonefile).toBe('test-zone-file');
    expect(query1.type).toBe('application/json');

    const subdomain: DbBnsSubdomain = {
      namespace_id: 'blockstack',
      name: 'id.blockstack',
      fully_qualified_subdomain: 'zone_test.id.blockstack',
      resolver: 'https://registrar.blockstack.org',
      owner: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      zonefile: 'test-zone-file',
      zonefile_hash: 'test-hash',
      zonefile_offset: 0,
      parent_zonefile_hash: 'p-test-hash',
      parent_zonefile_index: 0,
      block_height: dbBlock.block_height,
      tx_index: 0,
      tx_id: '',
      canonical: true,
    };
    await db.resolveBnsSubdomains(
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [subdomain]
    );

    const query2 = await supertest(api.server).get(
      `/v1/names/${subdomain.fully_qualified_subdomain}/zonefile/${subdomain.zonefile_hash}`
    );
    expect(query2.status).toBe(200);
    expect(query2.body.zonefile).toBe(subdomain.zonefile);
    expect(query2.type).toBe('application/json');
  });

  test('Fail zonefile by name - Invalid name', async () => {
    const name = 'test';
    const zonefileHash = 'test-hash';
    const zonefile = 'test-zone-file';

    const dbName: DbBnsName = {
      name: name,
      address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      namespace_id: '',
      expire_block: 10000,
      zonefile: zonefile,
      zonefile_hash: zonefileHash,
      registered_at: dbBlock.block_height,
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      dbName
    );

    const query1 = await supertest(api.server).get(`/v1/names/invalid/zonefile/${zonefileHash}`);
    expect(query1.status).toBe(400);
    expect(query1.body.error).toBe('Invalid name or subdomain');
    expect(query1.type).toBe('application/json');
  });

  test('Fail zonefile by name - No zonefile found', async () => {
    const name = 'test';
    const zonefileHash = 'test-hash';
    const zonefile = 'test-zone-file';

    const dbName: DbBnsName = {
      name: name,
      address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      namespace_id: '',
      expire_block: 10000,
      zonefile: zonefile,
      zonefile_hash: zonefileHash,
      registered_at: dbBlock.block_height,
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      dbName
    );

    const query1 = await supertest(api.server).get(`/v1/names/${name}/zonefile/invalidHash`);
    expect(query1.status).toBe(404);
    expect(query1.body.error).toBe('No such zonefile');
    expect(query1.type).toBe('application/json');
  });

  test('Success names by address', async () => {
    const blockchain = 'stacks';
    const address = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';
    const name = 'test-name';

    const dbName: DbBnsName = {
      name: name,
      address: address,
      namespace_id: '',
      expire_block: 10000,
      zonefile: 'test-zone-file',
      zonefile_hash: 'zonefileHash',
      registered_at: dbBlock.block_height,
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      dbName
    );

    const query1 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query1.status).toBe(200);
    expect(query1.body.names[0]).toBe(name);
    expect(query1.type).toBe('application/json');

    const subdomain: DbBnsSubdomain = {
      namespace_id: 'blockstack',
      name: 'id.blockstack',
      fully_qualified_subdomain: 'address_test.id.blockstack',
      resolver: 'https://registrar.blockstack.org',
      owner: address,
      zonefile: 'test',
      zonefile_hash: 'test-hash',
      zonefile_offset: 0,
      parent_zonefile_hash: 'p-test-hash',
      parent_zonefile_index: 0,
      block_height: dbBlock.block_height,
      tx_index: 0,
      tx_id: '',
      canonical: true,
    };
    await db.resolveBnsSubdomains(
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [subdomain]
    );

    const query2 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query2.status).toBe(200);
    expect(query2.body.names).toContain(subdomain.fully_qualified_subdomain);
    expect(query2.body.names).toContain(name);
    expect(query2.type).toBe('application/json');
  });

  test('Success names transfer', async () => {
    const blockchain = 'stacks';
    const address = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKA';
    const name = 'test-name1';

    const dbName: DbBnsName = {
      name: name,
      address: address,
      namespace_id: 'test',
      expire_block: 10000,
      zonefile: 'test-zone-file',
      zonefile_hash: 'zonefileHash',
      registered_at: 0,
      canonical: true,
      tx_id: '',
      tx_index: 0,
      status: 'name-register',
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      dbName
    );

    const query1 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query1.status).toBe(200);
    expect(query1.body.names[0]).toBe(name);
    expect(query1.type).toBe('application/json');

    const address1 = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKT';

    const dbNameTransfer: DbBnsName = {
      name: name,
      address: address1,
      namespace_id: 'test',
      expire_block: 10000,
      zonefile: 'test-zone-file',
      zonefile_hash: 'zonefileHash',
      registered_at: 1,
      canonical: true,
      tx_id: '',
      tx_index: 0,
      status: 'name-transfer',
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      dbNameTransfer
    );

    const query2 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address1}`);
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(query2.body.names[0]).toBe(name);

    const query3 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query3.status).toBe(200);
    expect(query3.type).toBe('application/json');
    expect(query3.body.names.length).toBe(0);
  });

  test('Fail names by address - Blockchain not support', async () => {
    const query1 = await supertest(api.server).get(`/v1/addresses/invalid/test`);
    expect(query1.status).toBe(404);
    expect(query1.body.error).toBe('Unsupported blockchain');
    expect(query1.type).toBe('application/json');
  });

  test('Success get zonefile by name', async () => {
    const zonefile = 'test-zone-file';
    const address = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';
    const name = 'zonefile-test-name';

    const dbName: DbBnsName = {
      name: name,
      address: address,
      namespace_id: '',
      expire_block: 10000,
      zonefile: 'test-zone-file',
      zonefile_hash: 'zonefileHash',
      registered_at: dbBlock.block_height,
      canonical: true,
      tx_id: '',
      tx_index: 0,
    };
    await db.updateNames(
      client,
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      dbName
    );

    const query1 = await supertest(api.server).get(`/v1/names/${name}/zonefile`);
    expect(query1.status).toBe(200);
    expect(query1.body.zonefile).toBe(zonefile);
    expect(query1.type).toBe('application/json');

    const subdomain: DbBnsSubdomain = {
      namespace_id: 'blockstack',
      name: 'id.blockstack',
      fully_qualified_subdomain: 'zonefile_test.id.blockstack',
      resolver: 'https://registrar.blockstack.org',
      owner: address,
      zonefile: 'test-zone-file',
      zonefile_hash: 'test-hash',
      zonefile_offset: 0,
      parent_zonefile_hash: 'p-test-hash',
      parent_zonefile_index: 0,
      block_height: dbBlock.block_height,
      tx_index: 0,
      tx_id: '',
      canonical: true,
    };
    await db.resolveBnsSubdomains(
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [subdomain]
    );

    const query2 = await supertest(api.server).get(
      `/v1/names/${subdomain.fully_qualified_subdomain}/zonefile`
    );
    expect(query2.status).toBe(200);
    expect(query2.body.zonefile).toBe(subdomain.zonefile);
    expect(query2.type).toBe('application/json');
  });

  test('Fail get zonefile by name - invalid name', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/invalidName/zonefile`);
    expect(query1.status).toBe(400);
    expect(query1.body.error).toBe('Invalid name or subdomain');
    expect(query1.type).toBe('application/json');
  });

  test('Success: names', async () => {
    const query1 = await supertest(api.server).get(`/v1/names`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
  });

  test('Validate: names response schema', async () => {
    const query1 = await supertest(api.server).get('/v1/names');
    const result = JSON.parse(query1.text);
    const path =
      '@stacks/stacks-blockchain-api-types/api/bns/name-querying/bns-get-all-names-response.schema.json';
    const valid = await validate(path, result);
    expect(valid.valid).toBe(true);
  });

  test('Invalid page from /v1/names', async () => {
    const query1 = await supertest(api.server).get('/v1/names?page=1');
    expect(query1.status).toBe(400);
  });

  test('Success: name info', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/xyz`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
  });

  test('Validate: name info response schema', async () => {
    const query1 = await supertest(api.server).get('/v1/names/xyz');
    const result = JSON.parse(query1.text);
    const path =
      '@stacks/stacks-blockchain-api-types/api/bns/name-querying/bns-get-name-info.response.schema.json';
    const valid = await validate(path, result);
    expect(valid.valid).toBe(true);
  });

  test('Failure: name info', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/testname`);
    expect(query1.status).toBe(404);
  });

  test('Success: fetching name info', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/xyz`);
    expect(query1.status).toBe(200);
    expect(query1.body.address).toBe('ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA');
    expect(query1.body.expire_block).toBe(14);
    expect(query1.body.zonefile).toBe(
      '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n'
    );
    expect(query1.body.zonefile_hash).toBe('b100a68235244b012854a95f9114695679002af9');
  });

  test('Success: fqn found test', async () => {
    const subdomain: DbBnsSubdomain = {
      namespace_id: 'blockstack',
      name: 'id.blockstack',
      fully_qualified_subdomain: 'subdomain.id.blockstack',
      resolver: 'https://registrar.blockstack.org',
      owner: 'test-address',
      zonefile: 'test',
      zonefile_hash: 'test-hash',
      zonefile_offset: 0,
      parent_zonefile_hash: 'p-test-hash',
      parent_zonefile_index: 0,
      block_height: dbBlock.block_height,
      tx_index: 0,
      tx_id: '',
      canonical: true,
    };
    await db.resolveBnsSubdomains(
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [subdomain]
    );

    const query = await supertest(api.server).get(
      `/v1/names/${subdomain.fully_qualified_subdomain}`
    );
    expect(query.status).toBe(200);
  });

  test('Success: fqn redirect test', async () => {
    const subdomain: DbBnsSubdomain = {
      namespace_id: 'blockstack',
      name: 'id.blockstack',
      fully_qualified_subdomain: 'previous_subdomain.id.blockstack',
      resolver: 'https://registrar.blockstack.org',
      owner: 'test-address',
      zonefile: 'test',
      zonefile_hash: 'test-hash',
      zonefile_offset: 0,
      parent_zonefile_hash: 'p-test-hash',
      parent_zonefile_index: 0,
      block_height: dbBlock.block_height,
      tx_index: 0,
      tx_id: '',
      canonical: true,
    };
    await db.resolveBnsSubdomains(
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [subdomain]
    );
    const query = await supertest(api.server).get(`/v1/names/test.id.blockstack`);
    expect(query.status).toBe(302);
    expect(query.header['location']).toBe(
      'https://registrar.blockstack.org/v1/names/test.id.blockstack'
    );
  });

  afterAll(async () => {
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
