import * as supertest from 'supertest';
import { PgSqlClient, timeout } from '@hirosystems/api-toolkit';
import { ChainID } from '@stacks/common';
import { ApiServer, startApiServer } from '../../src/api/init';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { importEventsFromTsv } from '../../src/event-replay/event-replay';
import { migrate } from '../utils/test-helpers';

describe('PoX tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: true,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });

    // set chainId env, because TSV import reads it manually
    process.env['STACKS_CHAIN_ID'] = ChainID.Testnet.toString();
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('api with empty cycles', async () => {
    const cycles0 = await supertest(api.server).get(`/extended/v2/pox/cycles`);
    expect(cycles0.status).toBe(200);
    expect(JSON.parse(cycles0.text)).toStrictEqual({
      limit: 20,
      offset: 0,
      results: [],
      total: 0,
    });
  });

  test('api', async () => {
    await importEventsFromTsv('tests/api/tsv/epoch-3-transition.tsv', 'archival', true, true);
    const cycles = await supertest(api.server).get(`/extended/v2/pox/cycles`);
    expect(cycles.status).toBe(200);
    expect(cycles.type).toBe('application/json');
    expect(JSON.parse(cycles.text)).toStrictEqual({
      limit: 20,
      offset: 0,
      results: [
        {
          block_height: 50,
          cycle_number: 14,
          index_block_hash: '0xf5be33abc4e508bdaf2191e88339372edcb3358c44e2a31e1b9b44f2880dde09',
          total_signers: 3,
          total_stacked_amount: '1372502700000000000',
          total_weight: 9,
        },
        {
          block_height: 22,
          cycle_number: 13,
          index_block_hash: '0x5077c7d971dd83cd3ba19dca579e3cc8dcf17913186b66093c94520e50d3b7b2',
          total_signers: 3,
          total_stacked_amount: '1372502700000000000',
          total_weight: 9,
        },
        {
          block_height: 13,
          cycle_number: 12,
          index_block_hash: '0x62d06851fe03f17cb45a488ae70bd8e0c5c308c523f37814ad4df36bd2108713',
          total_signers: 3,
          total_stacked_amount: '1372502700000000000',
          total_weight: 9,
        },
        {
          block_height: 6,
          cycle_number: 11,
          index_block_hash: '0xe1fb9b3beaa302392d183151d3e5394f86eb64c3d46616b8ec18f5ebe734c4cb',
          total_signers: 0,
          total_stacked_amount: '0',
          total_weight: 0,
        },
      ],
      total: 4,
    });
    const cycle = await supertest(api.server).get(`/extended/v2/pox/cycles/14`);
    expect(cycle.status).toBe(200);
    expect(cycle.type).toBe('application/json');
    expect(JSON.parse(cycle.text)).toStrictEqual({
      block_height: 50,
      cycle_number: 14,
      index_block_hash: '0xf5be33abc4e508bdaf2191e88339372edcb3358c44e2a31e1b9b44f2880dde09',
      total_signers: 3,
      total_stacked_amount: '1372502700000000000',
      total_weight: 9,
    });
    const signers = await supertest(api.server).get(`/extended/v2/pox/cycles/14/signers`);
    expect(signers.status).toBe(200);
    expect(signers.type).toBe('application/json');
    expect(JSON.parse(signers.text)).toStrictEqual({
      limit: 100,
      offset: 0,
      results: [
        {
          signing_key: '0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d',
          signer_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          stacked_amount: '686251350000000000',
          stacked_amount_percent: 50,
          weight: 5,
          weight_percent: 55.55555555555556,
          pooled_stacker_count: 0,
          solo_stacker_count: 1,
        },
        {
          signing_key: '0x029874497a7952483aa23890e9d0898696f33864d3df90939930a1f45421fe3b09',
          signer_address: 'STF9B75ADQAVXQHNEQ6KGHXTG7JP305J2GRWF3A2',
          stacked_amount: '457500900000000000',
          stacked_amount_percent: 33.333333333333336,
          weight: 3,
          weight_percent: 33.33333333333333,
          pooled_stacker_count: 0,
          solo_stacker_count: 1,
        },
        {
          signing_key: '0x02dcde79b38787b72d8e5e0af81cffa802f0a3c8452d6b46e08859165f49a72736',
          signer_address: 'ST18MDW2PDTBSCR1ACXYRJP2JX70FWNM6YY2VX4SS',
          stacked_amount: '228750450000000000',
          stacked_amount_percent: 16.666666666666668,
          weight: 1,
          weight_percent: 11.11111111111111,
          pooled_stacker_count: 0,
          solo_stacker_count: 1,
        },
      ],
      total: 3,
    });
    const signer = await supertest(api.server).get(
      `/extended/v2/pox/cycles/14/signers/0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d`
    );
    expect(signer.status).toBe(200);
    expect(signer.type).toBe('application/json');
    expect(JSON.parse(signer.text)).toStrictEqual({
      signing_key: '0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d',
      signer_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      stacked_amount: '686251350000000000',
      stacked_amount_percent: 50,
      weight: 5,
      weight_percent: 55.55555555555556,
      pooled_stacker_count: 0,
      solo_stacker_count: 1,
    });
    const stackers = await supertest(api.server).get(
      `/extended/v2/pox/cycles/14/signers/0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d/stackers`
    );
    expect(stackers.status).toBe(200);
    expect(stackers.type).toBe('application/json');
    expect(JSON.parse(stackers.text)).toStrictEqual({
      limit: 100,
      offset: 0,
      results: [
        {
          pox_address: 'mk4zAE1iVWf5PJAgeX83rSXnzF5zQBiqf1',
          stacked_amount: '686251350000000000',
          stacker_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          stacker_type: 'solo',
        },
      ],
      total: 1,
    });
  });

  describe('regtest-env stack-stx in-reward-phase', () => {
    // TEST CASE
    // steph (STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6) stacks (using signer 029fb154a570a1645af3dd43c3c668a979b59d21a46dd717fd799b13be3b2a0dc7)
    //
    // current cycle: 5
    // stephs stacks
    // snapshot 1
    // wait for prepare phase (i.e. pox-anchor block mined)
    // snapshot 2
    // wait for cycle 6
    // snapshot 3

    test('snapshot 1', async () => {
      await importEventsFromTsv(
        'tests/api/tsv/regtest-env-pox-4-stack-stx-in-reward-phase-S1.tsv',
        'archival',
        true,
        true
      );

      const cycles = await supertest(api.server).get(`/extended/v2/pox/cycles`);
      expect(cycles.status).toBe(200);
      expect(cycles.type).toBe('application/json');
      expect(JSON.parse(cycles.text).results.length).toBe(0); // regtest doesn't send pox-set earlier
    });

    test('snapshot 2', async () => {
      await importEventsFromTsv(
        'tests/api/tsv/regtest-env-pox-4-stack-stx-in-reward-phase-S2.tsv',
        'archival',
        true,
        true
      );

      const cycles = await supertest(api.server).get(`/extended/v2/pox/cycles`);
      expect(cycles.status).toBe(200);
      expect(cycles.type).toBe('application/json');
      expect(JSON.parse(cycles.text).results[0]).toEqual(
        expect.objectContaining({
          cycle_number: 6, // !!! next cycle (even though we're still in cycle 5)
          total_signers: 3, // no addition signer
          total_weight: 21, // additional weight from steph's stacking
        })
      );
    });

    test('snapshot 3', async () => {
      await importEventsFromTsv(
        'tests/api/tsv/regtest-env-pox-4-stack-stx-in-reward-phase-S3.tsv',
        'archival',
        true,
        true
      );

      const cycles = await supertest(api.server).get(`/extended/v2/pox/cycles`);
      expect(cycles.status).toBe(200);
      expect(cycles.type).toBe('application/json');
      expect(JSON.parse(cycles.text)).toStrictEqual({
        limit: 20,
        offset: 0,
        results: [
          {
            block_height: 14,
            cycle_number: 6, // current cycle
            index_block_hash: '0xb2c9e06611349a04e98012748547a5dea6d60fd6d69e43244b9c0a483f1f7c86',
            total_signers: 3,
            total_stacked_amount: '17501190000000000',
            total_weight: 21,
          },
        ],
        total: 1,
      });

      const cycle = await supertest(api.server).get(`/extended/v2/pox/cycles/6`);
      expect(cycle.status).toBe(200);
      expect(cycle.type).toBe('application/json');
      expect(JSON.parse(cycle.text)).toStrictEqual({
        block_height: 14,
        cycle_number: 6,
        index_block_hash: '0xb2c9e06611349a04e98012748547a5dea6d60fd6d69e43244b9c0a483f1f7c86',
        total_signers: 3,
        total_stacked_amount: '17501190000000000',
        total_weight: 21,
      });

      const signers = await supertest(api.server).get(`/extended/v2/pox/cycles/6/signers`);
      expect(signers.status).toBe(200);
      expect(signers.type).toBe('application/json');
      expect(JSON.parse(signers.text)).toStrictEqual({
        limit: 100,
        offset: 0,
        results: [
          {
            signing_key: '0x028efa20fa5706567008ebaf48f7ae891342eeb944d96392f719c505c89f84ed8d',
            signer_address: 'ST3AM1A56AK2C1XAFJ4115ZSV26EB49BVQ10MGCS0',
            stacked_amount: '7500510000000000',
            stacked_amount_percent: 42.857142857142854,
            weight: 9,
            weight_percent: 42.857142857142854,
            pooled_stacker_count: 0,
            solo_stacker_count: 1,
          },
          {
            signing_key: '0x023f19d77c842b675bd8c858e9ac8b0ca2efa566f17accf8ef9ceb5a992dc67836',
            signer_address: 'ST3PF13W7Z0RRM42A8VZRVFQ75SV1K26RXEP8YGKJ',
            stacked_amount: '5000340000000000',
            stacked_amount_percent: 28.571428571428573,
            weight: 6,
            weight_percent: 28.57142857142857,
            pooled_stacker_count: 0,
            solo_stacker_count: 1,
          },
          {
            // steph doubled the weight of this signer
            signing_key: '0x029fb154a570a1645af3dd43c3c668a979b59d21a46dd717fd799b13be3b2a0dc7',
            signer_address: 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP',
            stacked_amount: '5000340000000000',
            stacked_amount_percent: 28.571428571428573,
            weight: 6,
            weight_percent: 28.57142857142857,
            pooled_stacker_count: 0,
            solo_stacker_count: 2,
          },
        ],
        total: 3,
      });

      const signer = await supertest(api.server).get(
        `/extended/v2/pox/cycles/6/signers/0x029fb154a570a1645af3dd43c3c668a979b59d21a46dd717fd799b13be3b2a0dc7`
      );
      expect(signer.status).toBe(200);
      expect(signer.type).toBe('application/json');
      expect(JSON.parse(signer.text)).toStrictEqual({
        signing_key: '0x029fb154a570a1645af3dd43c3c668a979b59d21a46dd717fd799b13be3b2a0dc7',
        signer_address: 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP',
        stacked_amount: '5000340000000000',
        stacked_amount_percent: 28.571428571428573,
        weight: 6,
        weight_percent: 28.57142857142857,
        pooled_stacker_count: 0,
        solo_stacker_count: 2,
      });

      const stackers = await supertest(api.server).get(
        `/extended/v2/pox/cycles/6/signers/0x029fb154a570a1645af3dd43c3c668a979b59d21a46dd717fd799b13be3b2a0dc7/stackers`
      );
      expect(stackers.status).toBe(200);
      expect(stackers.type).toBe('application/json');
      expect(JSON.parse(stackers.text)).toStrictEqual({
        limit: 100,
        offset: 0,
        results: [
          {
            pox_address: 'n2v875jbJ4RjBnTjgbfikDfnwsDV5iUByw',
            stacked_amount: '2500170000000000',
            stacker_address: 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP', // signer
            stacker_type: 'solo',
          },
          {
            pox_address: 'mhYeZXrSEuyf2wbJ14qZ2apG7ofMLDj9Ss',
            stacked_amount: '2500170000000000',
            stacker_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6', // steph
            stacker_type: 'solo',
          },
        ],
        total: 2,
      });
    });
  });
});
