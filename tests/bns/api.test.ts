import { ApiServer, startApiServer } from '../../src/api/init';
import * as supertest from 'supertest';
import {
  DbAssetEventTypeId,
  DbBlock,
  DbBnsName,
  DbBnsNamespace,
  DbBnsSubdomain,
} from '../../src/datastore/common';
import * as StacksTransactions from '@stacks/transactions';
import { ChainID } from '@stacks/transactions';
import { bnsNameCV, I32_MAX } from '../../src/helpers';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../utils/test-builders';
import { migrate } from '../utils/test-helpers';
import { PgSqlClient } from '@hirosystems/api-toolkit';

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
    .fn(() => nameSpaceExpected)
    .mockImplementationOnce(() => nameSpaceExpected)
    .mockImplementationOnce(() => nameExpected);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    __esModule: true,
    ...originalModule,
    callReadOnlyFunction: mockReadOnlyFunction,
  };
});

describe('BNS API tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;
  let dbBlock: DbBlock;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests' });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

    const block = new TestBlockBuilder({
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
    })
      .addTx({ tx_id: '0x1234' })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV('xyz.abc'),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        recipient: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .addTxBnsName({
        name: 'xyz.abc',
        address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
        namespace_id: 'abc',
        expire_block: 14,
        zonefile:
          '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
        zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV('id.blockstack'),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        recipient: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .addTxBnsName({
        name: 'id.blockstack',
        address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
        namespace_id: 'blockstack',
        expire_block: 14,
        zonefile:
          '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://blockstack.s3.amazonaws.com/muneeb.id"\n',
        zonefile_hash: 'b100a68235244b012854a95f9114695679002af9',
      })
      .build();
    dbBlock = block.block;
    await db.update(block);

    const namespace: DbBnsNamespace = {
      namespace_id: 'abc',
      address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
      base: 1n,
      coeff: 1n,
      launched_at: 14,
      lifetime: 1,
      no_vowel_discount: 1n,
      nonalpha_discount: 1n,
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
        tx_id: '',
        tx_index: 0,
      },
      [namespace]
    );
    const namespace2: DbBnsNamespace = {
      namespace_id: 'blockstack',
      address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
      base: 1n,
      coeff: 1n,
      launched_at: 14,
      lifetime: 1,
      no_vowel_discount: 200000000000000n,
      nonalpha_discount: 200000000000000n,
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
        tx_id: '',
        tx_index: 0,
      },
      [namespace2]
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('Success: namespaces', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(query1.body.namespaces.length).toBe(2);
  });

  test('Validate: namespaces returned length', async () => {
    const query1 = await supertest(api.server).get('/v1/namespaces');
    const result = JSON.parse(query1.text);
    expect(result.namespaces.length).toBe(2);
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
    expect(query1.body.length).toBe(1);

    // Revoke name
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxBnsName({
        name: 'xyz.abc',
        namespace_id: 'abc',
        status: 'name-revoke',
        address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .build();
    await db.update(block2);
    const query2 = await supertest(api.server).get(`/v1/namespaces/abc/names`);
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(query2.body.length).toBe(0);
  });

  test('Namespace not found', async () => {
    const query1 = await supertest(api.server).get(`/v1/namespaces/def/names`);
    expect(query1.status).toBe(400);
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
    expect(result[0]).toBe('xyz.abc');
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
    const name = 'test.btc';
    const zonefileHash = 'test-hash';
    const zonefile = 'test-zone-file';

    const block = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x22' })
      .addTxBnsName({
        name: name,
        address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
        namespace_id: 'btc',
        expire_block: 10000,
        zonefile: zonefile,
        zonefile_hash: zonefileHash,
        canonical: true,
        status: 'name_register',
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV(name),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        recipient: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      })
      .build();
    await db.update(block);

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
      block_height: 2,
      tx_index: 0,
      tx_id: '0x22',
      canonical: true,
    };
    await db.resolveBnsSubdomains(
      {
        index_block_hash: '0x02',
        parent_index_block_hash: '0x1234',
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

    // Revoke name
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxBnsName({
        name: 'test.btc',
        status: 'name-revoke',
        address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .addTxBnsName({
        name: 'id.blockstack',
        status: 'name-revoke',
        address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .build();
    await db.update(block3);
    const query3 = await supertest(api.server).get(
      `/v1/names/${subdomain.fully_qualified_subdomain}/zonefile/${subdomain.zonefile_hash}`
    );
    expect(query3.status).toBe(404);
    const query4 = await supertest(api.server).get(`/v1/names/${name}/zonefile/${zonefileHash}`);
    expect(query4.status).toBe(404);
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
        tx_id: '',
        tx_index: 0,
      },
      [dbName]
    );

    const query1 = await supertest(api.server).get(`/v1/names/invalid/zonefile/${zonefileHash}`);
    expect(query1.status).toBe(404);
    expect(query1.body.error).toBe('No such name or zonefile');
    expect(query1.type).toBe('application/json');
  });

  test('Fail zonefile by name - No zonefile found', async () => {
    const name = 'test.btc';
    const zonefileHash = 'test-hash';
    const zonefile = 'test-zone-file';

    const block = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x22' })
      .addTxBnsName({
        name: name,
        address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
        namespace_id: 'btc',
        expire_block: 10000,
        zonefile: zonefile,
        zonefile_hash: zonefileHash,
        canonical: true,
        status: 'name_register',
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV(name),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        recipient: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      })
      .build();
    await db.update(block);

    const query1 = await supertest(api.server).get(`/v1/names/${name}/zonefile/invalidHash`);
    expect(query1.status).toBe(404);
    expect(query1.body.error).toBe('No such name or zonefile');
    expect(query1.type).toBe('application/json');
  });

  test('names by address returns the correct ownership', async () => {
    const blockchain = 'stacks';
    const address = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';
    const address2 = 'SP32YHGEETJCWCF0ABZ5D7Y79EG4PHC7P9EQ8GXHB';
    const address3 = 'SP5PKX2FA7XXMC7YWZFF3CA0EQCGZBVCP3D3PD5S';
    const name = 'test-name.btc';

    const block = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: dbBlock.index_block_hash,
    })
      .addTx({ tx_id: '0x22' })
      .addTxBnsName({
        name: name,
        address: address,
        namespace_id: 'btc',
        expire_block: 10000,
        zonefile: 'test-zone-file',
        zonefile_hash: 'zonefileHash',
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV(name),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        recipient: address,
      })
      .build();
    await db.update(block);

    // Register another name in block 1 (imported from v1, so no nft_event produced)
    const dbName2: DbBnsName = {
      name: 'imported.btc',
      address: address,
      namespace_id: 'btc',
      expire_block: 10000,
      zonefile: 'test-zone-file',
      zonefile_hash: 'zonefileHash',
      registered_at: 1,
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
        tx_id: '',
        tx_index: 0,
      },
      [dbName2]
    );

    const query1 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query1.status).toBe(200);
    expect(query1.body.names).toStrictEqual(['imported.btc', 'test-name.btc']);
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
      tx_id: '0x5454',
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
    expect(query2.type).toBe('application/json');
    expect(query2.body.names).toStrictEqual([
      'address_test.id.blockstack',
      'imported.btc',
      'test-name.btc',
    ]);

    // Transfer name to somebody else.
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: '0xf3f3' })
      .addTxNftEvent({
        sender: address,
        recipient: address2,
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        value: bnsNameCV(name),
      })
      .build();
    await db.update(block3);
    const query3 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query3.status).toBe(200);
    expect(query3.type).toBe('application/json');
    expect(query3.body.names).toStrictEqual(['address_test.id.blockstack', 'imported.btc']);

    // New guy owns the name.
    const query4 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address2}`);
    expect(query4.status).toBe(200);
    expect(query4.type).toBe('application/json');
    expect(query4.body.names).toStrictEqual(['test-name.btc']);

    // Transfer imported name to another user.
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03',
    })
      .addTx({ tx_id: '0xf3f4' })
      .addTxNftEvent({
        sender: address,
        recipient: address3,
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        value: bnsNameCV('imported.btc'),
      })
      .build();
    await db.update(block4);
    const query5 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query5.status).toBe(200);
    expect(query5.type).toBe('application/json');
    expect(query5.body.names).toStrictEqual(['address_test.id.blockstack']);

    // Other guy owns the name.
    const query6 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address3}`);
    expect(query6.status).toBe(200);
    expect(query6.type).toBe('application/json');
    expect(query6.body.names).toStrictEqual(['imported.btc']);

    await db.resolveBnsSubdomains(
      {
        index_block_hash: dbBlock.index_block_hash,
        parent_index_block_hash: dbBlock.parent_index_block_hash,
        microblock_hash: '',
        microblock_sequence: I32_MAX,
        microblock_canonical: true,
      },
      [
        {
          namespace_id: 'btc',
          name: 'imported.btc',
          fully_qualified_subdomain: 'test.imported.btc',
          resolver: 'https://registrar.blockstack.org',
          owner: address3,
          zonefile: 'test',
          zonefile_hash: 'test-hash',
          zonefile_offset: 0,
          parent_zonefile_hash: 'p-test-hash',
          parent_zonefile_index: 0,
          block_height: dbBlock.block_height,
          tx_index: 0,
          tx_id: '0x5454',
          canonical: true,
        },
        {
          namespace_id: 'btc',
          name: 'imported.btc',
          fully_qualified_subdomain: 'test2.imported.btc',
          resolver: 'https://registrar.blockstack.org',
          owner: address3,
          zonefile: 'test',
          zonefile_hash: 'test-hash',
          zonefile_offset: 0,
          parent_zonefile_hash: 'p-test-hash',
          parent_zonefile_index: 0,
          block_height: dbBlock.block_height,
          tx_index: 0,
          tx_id: '0x5454',
          canonical: true,
        },
      ]
    );

    // New subdomain resolves.
    const query9 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address3}`);
    expect(query9.status).toBe(200);
    expect(query9.type).toBe('application/json');
    expect(query9.body.names).toStrictEqual([
      'imported.btc',
      'test.imported.btc',
      'test2.imported.btc',
    ]);

    // Revoked name stops resolving.
    const block5 = new TestBlockBuilder({
      block_height: 5,
      index_block_hash: '0x05',
      parent_index_block_hash: '0x04',
    })
      .addTx({ tx_id: '0xf3f5' })
      .addTxBnsName({
        name: 'imported.btc',
        status: 'name-revoke',
        address: address3,
      })
      .addTxBnsName({
        name: 'id.blockstack',
        status: 'name-revoke',
        address: address3,
      })
      .build();
    await db.update(block5);
    const query7 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address3}`);
    expect(query7.status).toBe(200);
    expect(query7.type).toBe('application/json');
    expect(query7.body.names).toStrictEqual([]);
    const query8 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query8.status).toBe(200);
    expect(query8.type).toBe('application/json');
    expect(query8.body.names).toStrictEqual([]);
  });

  test('name-transfer zonefile change is reflected', async () => {
    const blockchain = 'stacks';
    const address = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKA';
    const name = 'test-name1.test';

    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: dbBlock.index_block_hash,
    })
      .addTx({ tx_id: '0x22' })
      .addTxBnsName({
        name: name,
        address: address,
        namespace_id: 'test',
        expire_block: 10000,
        zonefile: 'test-zone-file',
        zonefile_hash: 'zonefileHash',
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV(name),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        recipient: address,
      })
      .build();
    await db.update(block2);

    const query1 = await supertest(api.server).get(`/v1/addresses/${blockchain}/${address}`);
    expect(query1.status).toBe(200);
    expect(query1.body.names[0]).toBe(name);
    expect(query1.type).toBe('application/json');

    const address1 = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKT';
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: '0x23' })
      .addTxBnsName({
        name: name,
        address: address1,
        namespace_id: 'test',
        expire_block: 10000,
        zonefile: 'test-zone-file',
        zonefile_hash: 'zonefileHash',
        status: 'name-transfer',
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        value: bnsNameCV(name),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        sender: address,
        recipient: address1,
      })
      .build();
    await db.update(block3);

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
    expect(query1.status).not.toBe(200);
    expect(query1.type).toBe('application/json');
  });

  test('Success get zonefile by name', async () => {
    const zonefile = 'test-zone-file';
    const address = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';
    const name = 'zonefile-test-name.btc';

    const block = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x22' })
      .addTxBnsName({
        name: name,
        address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
        namespace_id: 'btc',
        expire_block: 10000,
        zonefile: zonefile,
        zonefile_hash: 'zonefileHash',
        canonical: true,
        status: 'name-register',
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV(name),
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        recipient: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      })
      .build();
    await db.update(block);

    const query1 = await supertest(api.server).get(`/v1/names/${name}/zonefile`);
    expect(query1.status).toBe(200);
    expect(query1.body.zonefile).toBe(zonefile);
    expect(query1.type).toBe('application/json');

    const subdomain: DbBnsSubdomain = {
      namespace_id: 'btc',
      name: 'zonefile-test-name.btc',
      fully_qualified_subdomain: 'zonefile_test.zonefile-test-name.btc',
      resolver: 'https://registrar.blockstack.org',
      owner: address,
      zonefile: 'test-zone-file',
      zonefile_hash: 'test-hash',
      zonefile_offset: 0,
      parent_zonefile_hash: 'p-test-hash',
      parent_zonefile_index: 0,
      block_height: dbBlock.block_height,
      tx_index: 0,
      tx_id: '0x22',
      canonical: true,
    };
    await db.resolveBnsSubdomains(
      {
        index_block_hash: '0x02',
        parent_index_block_hash: '0x1234',
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

    // Revoke name
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxBnsName({
        name: name,
        status: 'name-revoke',
        address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      })
      .build();
    await db.update(block3);

    const query3 = await supertest(api.server).get(`/v1/names/${name}/zonefile`);
    expect(query3.status).toBe(404);

    const query4 = await supertest(api.server).get(
      `/v1/names/${subdomain.fully_qualified_subdomain}/zonefile`
    );
    expect(query4.status).toBe(404);
  });

  test('Fail get zonefile by name - invalid name', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/invalidName/zonefile`);
    expect(query1.status).toBe(404);
    expect(query1.body.error).toBe('No such name or zonefile does not exist');
    expect(query1.type).toBe('application/json');
  });

  test('Success: names', async () => {
    const query1 = await supertest(api.server).get(`/v1/names`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(query1.body.length).toBe(2);

    // Revoke one name
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxBnsName({
        name: 'xyz.abc',
        status: 'name-revoke',
        address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .build();
    await db.update(block2);

    const query2 = await supertest(api.server).get(`/v1/names`);
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(query2.body.length).toBe(1);
  });

  test('Invalid page from /v1/names', async () => {
    const query1 = await supertest(api.server).get('/v1/names?page=1');
    expect(query1.status).toBe(400);
  });

  test('Success: name info', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/xyz.abc`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');

    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxBnsName({
        name: 'xyz.abc',
        status: 'name-revoke',
        address: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .build();
    await db.update(block2);

    const query2 = await supertest(api.server).get(`/v1/names/xyz.abc`);
    expect(query2.status).toBe(404);
  });

  test('Failure: name info', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/testname`);
    expect(query1.status).toBe(404);
  });

  test('Success: fetching name info', async () => {
    const query1 = await supertest(api.server).get(`/v1/names/xyz.abc`);
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
      tx_id: '0x1234',
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
    expect(query.body).toStrictEqual({
      address: 'test-address',
      blockchain: 'stacks',
      last_txid: '0x1234',
      resolver: 'https://registrar.blockstack.org',
      status: 'registered_subdomain',
      zonefile: 'test',
      zonefile_hash: 'test-hash',
    });
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
      tx_id: '0x1234',
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

  test('Success: subdomains in name', async () => {
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
    const query = await supertest(api.server).get(`/v1/names/id.blockstack/subdomains`);
    const expectedResult = ['zone_test.id.blockstack'];
    expect(query.body).toEqual(expectedResult);

    // Revoke name
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxBnsName({
        name: 'id.blockstack',
        status: 'name-revoke',
        address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      })
      .build();
    await db.update(block2);
    const query2 = await supertest(api.server).get(`/v1/names/id.blockstack/subdomains`);
    expect(query2.body).toEqual([]);
  });

  test('name is returned correctly after a micro re-orgd transfer', async () => {
    const name = 'bro.btc';
    const addr1 = 'SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR';
    const addr2 = 'SP2JWXVBMB0DW53KC1PJ80VC7T6N2ZQDBGCDJDMNR';
    const addr3 = 'SP2619TX0ZEZQ9A4QMS29WH1HKA86413NZHDZ2Z04';
    const value = bnsNameCV(name);

    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x1234',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxBnsName({ name: name, status: 'name-register', address: addr1 })
      .addTxNftEvent({
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        value: value,
        recipient: addr1,
      })
      .build();
    await db.update(block2);

    const mb1 = new TestMicroblockStreamBuilder()
      // Correct microblock with name transfer
      .addMicroblock({
        parent_index_block_hash: '0x02',
        microblock_hash: '0x11',
        microblock_sequence: 0,
      })
      .addTx({ tx_id: '0xf111' })
      .addTxBnsName({ name: name, status: 'name-update', address: addr2 })
      .addTxNftEvent({
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        value: value,
        sender: addr1,
        recipient: addr2,
      })
      // Re-orgd microblock with name transfer
      .addMicroblock({
        parent_index_block_hash: '0x02',
        microblock_hash: '0x12',
        microblock_sequence: 0,
      })
      .addTx({ tx_id: '0xf112' })
      .addTxBnsName({ name: name, status: 'name-update', address: addr3 })
      .addTxNftEvent({
        asset_identifier: 'ST000000000000000000002AMW42H.bns::names',
        value: value,
        sender: addr1,
        recipient: addr3,
      })
      .build();
    await db.updateMicroblocks(mb1);

    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
      parent_microblock_hash: '0x11',
    })
      .addTx()
      .build();
    await db.update(block3);

    const query = await supertest(api.server).get(`/v1/names/${name}`);
    expect(query.body.address).toEqual(addr2);
    expect(query.body.last_txid).toEqual('0xf111');
  });
});
