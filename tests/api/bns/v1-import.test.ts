import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { importV1BnsNames, importV1BnsSubdomains } from '../../../src/import-v1/index.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { DataStoreBlockUpdateData, DataStoreBnsBlockTxData } from '../../../src/datastore/common.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('BNS V1 import', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let block: DataStoreBlockUpdateData;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests' });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

    block = new TestBlockBuilder().addTx().build();
    await db.update(block);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('v1-import', async () => {
    const genesis: DataStoreBnsBlockTxData = {
      index_block_hash: block.block.index_block_hash,
      parent_index_block_hash: block.block.parent_index_block_hash,
      microblock_canonical: true,
      microblock_hash: block.block.parent_microblock_hash,
      microblock_sequence: block.block.parent_microblock_sequence,
      tx_id: block.txs[0].tx.tx_id,
      tx_index: block.txs[0].tx.tx_index,
    };
    await importV1BnsNames(db, 'tests/api/bns/import-test-files', genesis);
    await importV1BnsSubdomains(db, 'tests/api/bns/import-test-files', genesis);

    // Names
    const query1 = await supertest(api.server).get(`/v1/names/zumrai.id`);
    assert.equal(query1.status, 200);
    assert.equal(query1.type, 'application/json');
    assert.deepEqual(query1.body, {
      address: 'SP29EJ0SVM2TRZ3XGVTZPVTKF4SV1VMD8C0GA5SK5',
      blockchain: 'stacks',
      expire_block: 52596,
      last_txid: '0x1234',
      status: 'name-register',
      zonefile:
        '$ORIGIN zumrai.id\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1EPno1VcdGx89ukN2we4iVpnFtkHzw8i5d/profile.json"\n\n',
      zonefile_hash: '853cd126478237bc7392e65091f7ffa5a1556a33',
    });

    const query2 = await supertest(api.server).get(
      `/v1/names/zumrai.id/zonefile/853cd126478237bc7392e65091f7ffa5a1556a33`
    );
    assert.equal(query2.status, 200);
    assert.equal(query2.type, 'application/json');
    assert.deepEqual(query2.body, {
      zonefile:
        '$ORIGIN zumrai.id\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1EPno1VcdGx89ukN2we4iVpnFtkHzw8i5d/profile.json"\n\n',
    });

    const query3 = await supertest(api.server).get(`/v1/names/zumrai.id/zonefile`);
    assert.equal(query3.status, 200);
    assert.equal(query3.type, 'application/json');
    assert.deepEqual(query3.body, {
      zonefile:
        '$ORIGIN zumrai.id\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1EPno1VcdGx89ukN2we4iVpnFtkHzw8i5d/profile.json"\n\n',
    });

    const query4 = await supertest(api.server).get(`/v1/names/id.blockstack/subdomains`);
    assert.equal(query4.status, 200);
    assert.equal(query4.type, 'application/json');
    assert.deepEqual(query4.body.sort(), [
        '12312313231.id.blockstack',
        'aichamez.id.blockstack',
        'ale082308as.id.blockstack',
        'alejandro772.id.blockstack',
        'alkorsandor8_2.id.blockstack',
        'amir4good.id.blockstack',
        'anasa680.id.blockstack',
        'ancafajardo.id.blockstack',
        'angelessebastian.id.blockstack',
        'blafus3l.id.blockstack',
        'caomicoje.id.blockstack',
        'con_adrada34516.id.blockstack',
        'cryptichorizon.id.blockstack',
        'drgenius.id.blockstack',
        'drifting_dude.id.blockstack',
        'enavarrocollin.id.blockstack',
        'entryist.id.blockstack',
        'flushreset.id.blockstack',
        'harukoscarlet.id.blockstack',
        'hintonh924.id.blockstack',
        'johnkinney.id.blockstack',
        'jokialternative.id.blockstack',
        'joren_instance.id.blockstack',
        'kerodriguez.id.blockstack',
        'krishares10.id.blockstack',
        'liviaelyse.id.blockstack',
        'luke_mwenya1.id.blockstack',
        'milkyymocha.id.blockstack',
        'mithical.id.blockstack',
        'mrbotham.id.blockstack',
        'mymansgotabeefy1.id.blockstack',
        'neelyblake996.id.blockstack',
        'nihal_t_m.id.blockstack',
        'okamii63.id.blockstack',
        'robertascardoso.id.blockstack',
        'sheridoug.id.blockstack',
        'sipapi19.id.blockstack',
        'slemanb44.id.blockstack',
        'slimttfu.id.blockstack',
        'splevine.id.blockstack',
        'sportsman66.id.blockstack',
        'starbvuks.id.blockstack',
        'subtly_fresh.id.blockstack',
        'svirchok.id.blockstack',
        'theironcook.id.blockstack',
        'thingnotok.id.blockstack',
        'ujku1977.id.blockstack',
        'yanadda9.id.blockstack',
        'yoemmx00.id.blockstack',
        'zachgaming.id.blockstack',
      ].sort());

    const query5 = await supertest(api.server).get(`/v1/names/`);
    assert.equal(query5.status, 200);
    assert.equal(query5.type, 'application/json');
    assert.deepEqual(query5.body.sort(), [
        'id.blockstack',
        '1.id',
        '10.id',
        '10x.id',
        '111111111.id',
        '123.id',
        'zinai.id',
        'zlh.id',
        'zone117x.id',
        'zumminer_crux.id',
        'zumminer_dev_crux.id',
        'zumrai.id',
      ].sort());

    // Namespaces
    const query6 = await supertest(api.server).get(`/v1/namespaces/`);
    assert.equal(query6.status, 200);
    assert.equal(query6.type, 'application/json');
    assert.deepEqual(query6.body, {
      namespaces: ['blockstack', 'graphite', 'helloworld', 'id', 'podcast'],
    });

    const query7 = await supertest(api.server).get(`/v1/namespaces/id/names`);
    assert.equal(query7.status, 200);
    assert.equal(query7.type, 'application/json');
    assert.deepEqual(query7.body.sort(), [
        '1.id',
        '10.id',
        '10x.id',
        '111111111.id',
        '123.id',
        'zinai.id',
        'zlh.id',
        'zone117x.id',
        'zumminer_crux.id',
        'zumminer_dev_crux.id',
        'zumrai.id',
      ].sort());

    // Addresses
    const query8 = await supertest(api.server).get(
      `/v1/addresses/stacks/SP1HPCXTGV31W5659M3WTBEFP5AN55HV4B1Q9T31F`
    );
    assert.equal(query8.status, 200);
    assert.equal(query8.type, 'application/json');
    assert.deepEqual(query8.body, {
      names: ['id.blockstack'],
    });

    // Subdomains
    const query9 = await supertest(api.server).get(`/v1/names/flushreset.id.blockstack`);
    assert.equal(query9.status, 200);
    assert.equal(query9.type, 'application/json');
    assert.deepEqual(query9.body, {
      address: 'SP2S2F9TCAT43KEJT02YTG2NXVCPZXS1426T63D9H',
      blockchain: 'stacks',
      last_txid: '0x1234',
      resolver: 'https://registrar.blockstack.org',
      status: 'registered_subdomain',
      zonefile:
        '$ORIGIN flushreset.id.blockstack\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1HEznKZ7mK5fmibweM7eAk8SwRgJ1bWY92/profile.json"\n\n',
      zonefile_hash: '14dc091ebce8ea117e1276d802ee903cc0fdde81',
    });

    const query10 = await supertest(api.server).get(
      `/v1/names/flushreset.id.blockstack/zonefile/14dc091ebce8ea117e1276d802ee903cc0fdde81`
    );
    assert.equal(query10.status, 200);
    assert.equal(query10.type, 'application/json');
    assert.deepEqual(query10.body, {
      zonefile:
        '$ORIGIN flushreset.id.blockstack\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1HEznKZ7mK5fmibweM7eAk8SwRgJ1bWY92/profile.json"\n\n',
    });

    const query11 = await supertest(api.server).get(`/v1/names/flushreset.id.blockstack/zonefile`);
    assert.equal(query11.status, 200);
    assert.equal(query11.type, 'application/json');
    assert.deepEqual(query11.body, {
      zonefile:
        '$ORIGIN flushreset.id.blockstack\n$TTL 3600\n_http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1HEznKZ7mK5fmibweM7eAk8SwRgJ1bWY92/profile.json"\n\n',
    });

    const dbquery = await db.getSubdomain({
      subdomain: `flushreset.id.blockstack`,
      includeUnanchored: false,
      chainId: ChainID.Testnet,
    });
    assert(dbquery.found);
    if (dbquery.result) {
      assert.equal(dbquery.result.name, 'id.blockstack');
    }
  });
});
