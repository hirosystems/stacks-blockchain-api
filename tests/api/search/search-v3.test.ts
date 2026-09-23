import { describe, test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbAssetEventTypeId, DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';

const SENDER = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y';
const CONTRACT_ID = `${SENDER}.arkadiko-token`;
const ASSET_ID = `${CONTRACT_ID}::diko`;

/** A 32-byte hash starting with `prefix`, padded out so prefixes stay distinctive. */
function hash(prefix: string): string {
  return `0x${prefix.padEnd(64, '0')}`;
}

describe('v3 search', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  async function search(query: string) {
    const res = await api.fastifyApp.inject({
      method: 'GET',
      url: `/extended/v3/search?${query}`,
    });
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
  }

  /** Types of the results, in the order they were returned. */
  function types(body: { results: { type: string }[] }): string[] {
    return body.results.map(r => r.type);
  }

  /**
   * Seeds a block with a transfer transaction, a contract deploy, and one fungible and one
   * non-fungible token event, which between them cover every entity type search can return.
   */
  async function seed() {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: hash('bbbb1111'),
        index_block_hash: hash('dddd1111'),
        parent_index_block_hash: hash('dddd0000'),
        burn_block_height: 700,
      })
        .addTx({ tx_id: hash('aaaa1111'), sender_address: SENDER })
        .addTxFtEvent({
          asset_identifier: ASSET_ID,
          recipient: SENDER,
          asset_event_type_id: DbAssetEventTypeId.Mint,
        })
        .addTxNftEvent({
          asset_identifier: `${CONTRACT_ID}::diko-nft`,
          recipient: SENDER,
          asset_event_type_id: DbAssetEventTypeId.Mint,
        })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: hash('bbbb2222'),
        index_block_hash: hash('dddd2222'),
        parent_index_block_hash: hash('dddd1111'),
        burn_block_height: 701,
      })
        .addTx({
          tx_id: hash('aaaa2222'),
          sender_address: SENDER,
          type_id: DbTxTypeId.VersionedSmartContract,
          status: DbTxStatus.Success,
          smart_contract_contract_id: CONTRACT_ID,
          smart_contract_source_code: '(define-public (hello) (ok u1))',
          smart_contract_clarity_version: 3,
        })
        .build()
    );
    await db.updateBurnchainBlock({
      burnchainBlockHash: hash('ffff7777'),
      burnchainBlockHeight: 701,
      burnAmount: 3001n,
      rewardAmount: 2706n,
    });
    // A Bitcoin block at height 2 as well, so a height term can match both chains at once.
    await db.updateBurnchainBlock({
      burnchainBlockHash: hash('ffff0002'),
      burnchainBlockHeight: 2,
      burnAmount: 1000n,
      rewardAmount: 900n,
    });
  }

  describe('hash terms', () => {
    test('finds a transaction by its full id and by a prefix', async () => {
      await seed();

      const exact = await search(`q=${hash('aaaa1111')}`);
      assert.equal(exact.statusCode, 200);
      assert.deepEqual(types(exact.body), ['transaction']);
      assert.equal(exact.body.results[0].result.tx_id, hash('aaaa1111'));

      const prefix = await search('q=0xaaaa1111');
      assert.equal(prefix.statusCode, 200);
      assert.deepEqual(types(prefix.body), ['transaction']);
      assert.equal(prefix.body.results[0].result.tx_id, hash('aaaa1111'));
    });

    test('accepts a prefix without the 0x, in any case, and of odd length', async () => {
      await seed();

      // The last two are odd-length prefixes, which still describe a valid range.
      for (const term of ['aaaa1111', 'AAAA1111', '0xAaAa1111', 'aaaa11110', '0xaaaa11110']) {
        const res = await search(`q=${term}`);
        assert.equal(res.statusCode, 200, term);
        assert.equal(res.body.results[0]?.result?.tx_id, hash('aaaa1111'), term);
      }
    });

    test('finds a block by its hash and by its index block hash', async () => {
      await seed();

      const byHash = await search('q=0xbbbb2222');
      assert.deepEqual(types(byHash.body), ['block']);
      assert.equal(byHash.body.results[0].result.hash, hash('bbbb2222'));
      assert.equal(byHash.body.results[0].result.height, 2);

      const byIndexHash = await search('q=0xdddd2222');
      assert.deepEqual(types(byIndexHash.body), ['block']);
      assert.equal(byIndexHash.body.results[0].result.index_hash, hash('dddd2222'));
    });

    test('finds a bitcoin block by its hash', async () => {
      await seed();

      const res = await search('q=0xffff7777');
      assert.deepEqual(types(res.body), ['bitcoin_block']);
      assert.equal(res.body.results[0].result.hash, hash('ffff7777'));
      assert.equal(res.body.results[0].result.height, 701);
    });

    test('a prefix shared by several entities returns them in type order', async () => {
      // The block hash and the transaction id share the queried eight-character prefix and differ
      // afterwards, so one term reaches both entities.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: `0xcccc1111bbbb${'0'.repeat(52)}`,
          index_block_hash: hash('eeee1111'),
          parent_index_block_hash: hash('eeee0000'),
        })
          .addTx({ tx_id: `0xcccc1111aaaa${'0'.repeat(52)}`, sender_address: SENDER })
          .build()
      );

      const res = await search('q=0xcccc');
      // Too short to search at all.
      assert.equal(res.statusCode, 400);

      const valid = await search('q=0xcccc1111');
      assert.deepEqual(types(valid.body), ['block', 'transaction']);
      assert.equal(valid.body.results[0].result.hash, `0xcccc1111bbbb${'0'.repeat(52)}`);
      assert.equal(valid.body.results[1].result.tx_id, `0xcccc1111aaaa${'0'.repeat(52)}`);
    });
  });

  describe('block height terms', () => {
    test('matches both the stacks block and the bitcoin block at that height', async () => {
      await seed();

      const res = await search('q=2');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(types(res.body), ['block', 'bitcoin_block']);
      assert.equal(res.body.results[0].result.height, 2);
      assert.equal(res.body.results[1].result.height, 2);

      // A height only the Bitcoin chain has reached matches on its own.
      const burnOnly = await search('q=701');
      assert.deepEqual(types(burnOnly.body), ['bitcoin_block']);
      assert.equal(burnOnly.body.results[0].result.height, 701);
    });

    test('a height with no minimum length still matches', async () => {
      await seed();

      const res = await search('q=1&type=block');
      assert.deepEqual(types(res.body), ['block']);
      assert.equal(res.body.results[0].result.height, 1);
    });

    test('a height beyond the int4 range is never matched as a height', async () => {
      await seed();

      // Long digit strings are also valid hex, so the term is searched as a hash prefix. What it
      // must not do is reach the int4 height columns, which would error on overflow.
      const res = await search('q=99999999999999');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.results, []);

      const blocksOnly = await search('q=99999999999999&type=block,bitcoin_block');
      assert.equal(blocksOnly.statusCode, 200);
      assert.deepEqual(blocksOnly.body.results, []);
    });

    test('a digits-only term long enough to be a hash searches both classes', async () => {
      // Leading zeros make this both the height 1 and an 8-character hash prefix.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('00000001'),
          index_block_hash: hash('dddd1111'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('00000001'), sender_address: SENDER })
          .build()
      );

      const res = await search('q=00000001');
      // The block is reached twice, as an exact height match and as a hash prefix match, and is
      // returned once. The transaction is reached by the hash prefix alone.
      assert.deepEqual(types(res.body), ['block', 'transaction']);
      assert.equal(res.body.results[0].result.height, 1);
      assert.equal(res.body.results[1].result.tx_id, hash('00000001'));
    });
  });

  describe('address terms', () => {
    test('finds an address by its full value and by a prefix', async () => {
      await seed();

      const exact = await search(`q=${SENDER}&type=address`);
      assert.deepEqual(types(exact.body), ['address']);
      assert.equal(exact.body.results[0].result.principal, SENDER);

      const prefix = await search(`q=${SENDER.slice(0, 10)}&type=address`);
      assert.deepEqual(types(prefix.body), ['address']);
      assert.equal(prefix.body.results[0].result.principal, SENDER);
    });

    test('an address term also surfaces the contracts and assets under that address', async () => {
      await seed();

      const res = await search(`q=${SENDER}`);
      // The address itself ranks first; the contracts and assets it deployed follow.
      assert.equal(types(res.body)[0], 'address');
      assert.deepEqual(types(res.body).sort(), ['address', 'smart_contract', 'token', 'token']);
    });

    test('never returns a contract principal as an address', async () => {
      await seed();

      const res = await search(`q=${SENDER.slice(0, 10)}&type=address`);
      assert.deepEqual(types(res.body), ['address']);
      for (const hit of res.body.results) {
        assert.ok(!hit.result.principal.includes('.'), hit.result.principal);
      }
    });

    test('is not searched as an address below the address minimum', async () => {
      await seed();

      // Four characters is under the address minimum, so no address is matched, though the term
      // is still long enough to be searched as a contract or asset name.
      const res = await search('q=ST27&type=address');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.results, []);

      const tooShortForEverything = await search('q=ST');
      assert.equal(tooShortForEverything.statusCode, 400);
    });
  });

  describe('smart contract terms', () => {
    test('finds a contract by its full id', async () => {
      await seed();

      const res = await search(`q=${CONTRACT_ID}&type=smart_contract`);
      assert.deepEqual(types(res.body), ['smart_contract']);
      assert.equal(res.body.results[0].result.contract_id, CONTRACT_ID);
      assert.equal(res.body.results[0].result.clarity_version, 3);
      assert.equal(res.body.results[0].result.source_code, undefined);
    });

    test('finds a contract by a partial contract id', async () => {
      await seed();

      const res = await search(`q=${SENDER}.arkadi&type=smart_contract`);
      assert.deepEqual(types(res.body), ['smart_contract']);
      assert.equal(res.body.results[0].result.contract_id, CONTRACT_ID);
    });

    test('finds a contract by a name fragment anywhere in the name', async () => {
      await seed();

      const res = await search('q=arkadiko&type=smart_contract');
      assert.deepEqual(types(res.body), ['smart_contract']);
      assert.equal(res.body.results[0].result.contract_id, CONTRACT_ID);
    });
  });

  describe('token terms', () => {
    test('finds a fungible token by its full asset identifier', async () => {
      await seed();

      const res = await search(`q=${ASSET_ID}&type=token`);
      // The NFT asset shares this identifier as a prefix, so it matches too, but the asset named
      // exactly by the term is ranked first.
      assert.deepEqual(types(res.body), ['token', 'token']);
      assert.deepEqual(res.body.results[0].result, {
        asset_identifier: ASSET_ID,
        asset_type: 'ft',
        contract_id: CONTRACT_ID,
        asset_name: 'diko',
      });
    });

    test('finds both the fungible and non-fungible assets by name fragment', async () => {
      await seed();

      const res = await search('q=diko&type=token');
      const identifiers = res.body.results.map(
        (r: { result: { asset_identifier: string } }) => r.result.asset_identifier
      );
      assert.ok(identifiers.includes(ASSET_ID), JSON.stringify(identifiers));
      assert.ok(identifiers.includes(`${CONTRACT_ID}::diko-nft`), JSON.stringify(identifiers));
      const nft = res.body.results.find(
        (r: { result: { asset_identifier: string } }) =>
          r.result.asset_identifier === `${CONTRACT_ID}::diko-nft`
      );
      assert.equal(nft.result.asset_type, 'nft');
    });

    test('does not record the stx pseudo-token as an asset', async () => {
      await seed();

      const res = await search('q=stx&type=token');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.results, []);
    });
  });

  describe('type filtering', () => {
    test('narrows results to the requested types', async () => {
      await seed();

      const all = await search('q=arkadiko');
      assert.deepEqual(types(all.body).sort(), ['smart_contract', 'token', 'token']);

      const contractsOnly = await search('q=arkadiko&type=smart_contract');
      assert.deepEqual(types(contractsOnly.body), ['smart_contract']);

      const commaSeparated = await search('q=2&type=block,bitcoin_block');
      assert.deepEqual(types(commaSeparated.body), ['block', 'bitcoin_block']);

      const repeated = await search('q=2&type=bitcoin_block&type=block');
      assert.deepEqual(types(repeated.body), ['block', 'bitcoin_block']);
    });

    test('returns nothing when the type filter excludes every matching class', async () => {
      await seed();

      const res = await search('q=2&type=token');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.results, []);
    });

    test('rejects an unknown type', async () => {
      const res = await search('q=arkadiko&type=nonsense');
      assert.equal(res.statusCode, 400);
    });
  });

  describe('result limits and empty results', () => {
    test('returns at most 20 results', async () => {
      const builder = new TestBlockBuilder({
        block_height: 1,
        block_hash: hash('bbbb1111'),
        index_block_hash: hash('dddd1111'),
        parent_index_block_hash: hash('dddd0000'),
      });
      // All 25 ids share the same eight-character prefix and vary only after it, so the term
      // below matches every one of them and the response has to be truncated.
      for (let i = 0; i < 25; i++) {
        builder.addTx({
          tx_id: `0x99999999${i.toString(16).padStart(4, '0')}`.padEnd(66, '0'),
          tx_index: i,
          sender_address: SENDER,
        });
      }
      await db.update(builder.build());

      const res = await search('q=0x9999');
      assert.equal(res.statusCode, 400, 'four hex characters is below the minimum');

      const searchable = await search('q=0x99999999');
      assert.equal(searchable.statusCode, 200);
      assert.equal(searchable.body.results.length, 20);
      assert.deepEqual(new Set(types(searchable.body)), new Set(['transaction']));
    });

    test('a term that matches nothing returns an empty list', async () => {
      await seed();

      const res = await search('q=0x1234567890abcdef');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.results, []);
    });

    test('rejects a term that matches no entity class', async () => {
      const res = await search('q=%20%20');
      assert.equal(res.statusCode, 400);
    });
  });

  describe('canonical state', () => {
    test('does not return entities from a non-canonical fork', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb1111'),
          index_block_hash: hash('dddd1111'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa1111'), sender_address: SENDER })
          .build()
      );
      // A competing block at the same height re-orgs the first one out.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb9999'),
          index_block_hash: hash('dddd9999'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa9999'), sender_address: SENDER })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          block_hash: hash('bbbb2222'),
          index_block_hash: hash('dddd2222'),
          parent_index_block_hash: hash('dddd9999'),
        }).build()
      );

      const orphaned = await search('q=0xaaaa1111');
      assert.deepEqual(orphaned.body.results, []);

      const canonical = await search('q=0xaaaa9999');
      assert.deepEqual(types(canonical.body), ['transaction']);
    });
  });

  describe('without the pg_trgm extension', () => {
    /**
     * Drops the extension, and with it the trigram indexes, to stand in for an operator whose
     * server does not ship `pg_trgm`. Must run before the first search of a test, since the store
     * caches whether the extension is installed the first time it looks.
     */
    async function dropTrigrams() {
      await db.sql`DROP EXTENSION IF EXISTS pg_trgm CASCADE`;
    }

    test('still matches contract and asset names by substring', async () => {
      await seed();
      await dropTrigrams();

      const res = await search('q=arkadiko');
      assert.equal(res.statusCode, 200);
      assert.deepEqual(types(res.body).sort(), ['smart_contract', 'token', 'token']);
      assert.equal(res.body.results[0].result.contract_id, CONTRACT_ID);
    });

    test('still serves the term classes that never needed the extension', async () => {
      await seed();
      await dropTrigrams();

      const byHash = await search(`q=${hash('aaaa1111')}`);
      assert.deepEqual(types(byHash.body), ['transaction']);

      const byHeight = await search('q=1&type=block');
      assert.deepEqual(types(byHeight.body), ['block']);

      const byAddress = await search(`q=${SENDER.slice(0, 10)}&type=address`);
      assert.deepEqual(types(byAddress.body), ['address']);

      const byContractPrefix = await search(`q=${SENDER}.arkadi&type=smart_contract`);
      assert.deepEqual(types(byContractPrefix.body), ['smart_contract']);

      const byAssetPrefix = await search(`q=${ASSET_ID}&type=token`);
      assert.equal(byAssetPrefix.body.results[0].result.asset_identifier, ASSET_ID);
    });

    test('ranks substring matches by where the term appears in the name', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb1111'),
          index_block_hash: hash('dddd1111'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({
            tx_id: hash('aaaa1111'),
            sender_address: SENDER,
            type_id: DbTxTypeId.VersionedSmartContract,
            status: DbTxStatus.Success,
            smart_contract_contract_id: `${SENDER}.my-arkadiko-vault`,
            smart_contract_source_code: '(define-public (hello) (ok u1))',
            smart_contract_clarity_version: 3,
          })
          .addTx({
            tx_id: hash('aaaa2222'),
            tx_index: 1,
            sender_address: SENDER,
            type_id: DbTxTypeId.VersionedSmartContract,
            status: DbTxStatus.Success,
            smart_contract_contract_id: CONTRACT_ID,
            smart_contract_source_code: '(define-public (hello) (ok u1))',
            smart_contract_clarity_version: 3,
          })
          .build()
      );
      await dropTrigrams();

      const res = await search('q=arkadiko&type=smart_contract');
      // `arkadiko-token` starts with the term where `my-arkadiko-vault` buries it three characters
      // in, so it ranks first without any similarity score to go on.
      assert.deepEqual(
        res.body.results.map((r: { result: { contract_id: string } }) => r.result.contract_id),
        [CONTRACT_ID, `${SENDER}.my-arkadiko-vault`]
      );
    });
  });

  describe('caching', () => {
    async function get(query: string, etag?: string) {
      return await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/search?${query}`,
        headers: etag ? { 'if-none-match': etag } : undefined,
      });
    }

    test('invalidates the ETag when only the burnchain tip advances', async () => {
      await seed();

      const first = await get('q=0xffff7777');
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'] as string;
      assert.ok(etag);

      const unchanged = await get('q=0xffff7777', etag);
      assert.equal(unchanged.statusCode, 304);

      // A Bitcoin block arrives with no new Stacks block. Search returns bitcoin_block hits, so
      // an ETag keyed only on the Stacks chain tip would wrongly keep serving a 304 here.
      await db.updateBurnchainBlock({
        burnchainBlockHash: hash('ffff8888'),
        burnchainBlockHeight: 800,
        burnAmount: 1n,
        rewardAmount: 1n,
      });

      const afterBurnBlock = await get('q=0xffff7777', etag);
      assert.equal(afterBurnBlock.statusCode, 200);
    });
  });

  describe('review regressions', () => {
    test('an exact contract id outranks the prefix matches that would crowd it out', async () => {
      const exactContract = `${SENDER}.arkadiko`;
      // The exact contract is the oldest, and 21 longer contracts share its prefix — more than the
      // result limit — so ordering by height alone would drop it before ranking ever saw it.
      const builder = new TestBlockBuilder({
        block_height: 1,
        block_hash: hash('bbbb1111'),
        index_block_hash: hash('dddd1111'),
        parent_index_block_hash: hash('dddd0000'),
      });
      builder.addTx({
        tx_id: hash('aaaa0000'),
        tx_index: 0,
        sender_address: SENDER,
        type_id: DbTxTypeId.VersionedSmartContract,
        status: DbTxStatus.Success,
        smart_contract_contract_id: exactContract,
        smart_contract_source_code: '(define-public (hello) (ok u1))',
        smart_contract_clarity_version: 3,
      });
      for (let i = 0; i < 21; i++) {
        builder.addTx({
          tx_id: `0xaaaa1111${i.toString(16).padStart(4, '0')}`.padEnd(66, '0'),
          tx_index: i + 1,
          sender_address: SENDER,
          type_id: DbTxTypeId.VersionedSmartContract,
          status: DbTxStatus.Success,
          smart_contract_contract_id: `${exactContract}-${i}`,
          smart_contract_source_code: '(define-public (hello) (ok u1))',
          smart_contract_clarity_version: 3,
        });
      }
      await db.update(builder.build());

      const res = await search(`q=${exactContract}&type=smart_contract`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.results[0].result.contract_id, exactContract);
    });

    test('a successful contract is not crowded out by failed deploys', async () => {
      // Failed deploys are recorded in `smart_contracts` too, so enough of them matching the term
      // could fill the candidate limit and hide the real contract when details are resolved.
      const builder = new TestBlockBuilder({
        block_height: 1,
        block_hash: hash('bbbb1111'),
        index_block_hash: hash('dddd1111'),
        parent_index_block_hash: hash('dddd0000'),
      });
      builder.addTx({
        tx_id: hash('aaaa0000'),
        tx_index: 0,
        sender_address: SENDER,
        type_id: DbTxTypeId.VersionedSmartContract,
        status: DbTxStatus.Success,
        smart_contract_contract_id: CONTRACT_ID,
        smart_contract_source_code: '(define-public (hello) (ok u1))',
        smart_contract_clarity_version: 3,
      });
      for (let i = 0; i < 21; i++) {
        builder.addTx({
          tx_id: `0xaaaa1111${i.toString(16).padStart(4, '0')}`.padEnd(66, '0'),
          tx_index: i + 1,
          sender_address: SENDER,
          type_id: DbTxTypeId.VersionedSmartContract,
          status: DbTxStatus.AbortByResponse,
          smart_contract_contract_id: `${CONTRACT_ID}-failed-${i}`,
          smart_contract_source_code: '(define-public (hello) (err u1))',
          smart_contract_clarity_version: 3,
        });
      }
      await db.update(builder.build());

      const res = await search('q=arkadiko&type=smart_contract');
      assert.deepEqual(
        res.body.results.map((r: { result: { contract_id: string } }) => r.result.contract_id),
        [CONTRACT_ID]
      );
    });

    test('does not return an address whose activity is only in an orphaned microblock', async () => {
      const microblockOnly = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
      await seed();
      // Count maintenance tracks `canonical` but never `microblock_canonical`, so a principal
      // whose only activity sits in an orphaned microblock still carries a positive count. Written
      // directly, since the API stopped ingesting microblocks at Nakamoto and can no longer
      // produce this state, though historical rows still have it.
      await db.sql`
        INSERT INTO principal_txs (principal, tx_id, block_height, index_block_hash,
          microblock_hash, microblock_sequence, tx_index, canonical, microblock_canonical)
        VALUES (${microblockOnly}, ${hash('aaaa7777')}, 1, ${hash('dddd1111')},
          ${hash('cccc1111')}, 0, 0, true, false)
      `;
      await db.sql`
        INSERT INTO principal_tx_counts (principal, count) VALUES (${microblockOnly}, 1)
      `;

      const res = await search(`q=${microblockOnly}&type=address`);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.results, []);

      // A principal with canonical activity is unaffected.
      const canonical = await search(`q=${SENDER}&type=address`);
      assert.deepEqual(types(canonical.body), ['address']);
    });

    test('does not return an address whose transactions were all orphaned', async () => {
      const orphaned = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb1111'),
          index_block_hash: hash('dddd1111'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa1111'), sender_address: orphaned })
          .build()
      );
      // A competing block at the same height, then one extending it, re-orgs the first block out.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb9999'),
          index_block_hash: hash('dddd9999'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa9999'), sender_address: SENDER })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          block_hash: hash('bbbb2222'),
          index_block_hash: hash('dddd2222'),
          parent_index_block_hash: hash('dddd9999'),
        }).build()
      );

      // The re-org decremented this principal's count to zero and left the row behind, which is
      // what the query's `count > 0` filter exists to catch.
      const res = await search(`q=${orphaned}&type=address`);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.results, []);
    });

    test('searches a bare 64-character hex term as a name as well as a hash', async () => {
      // Valid as a Clarity asset name and as a hash, since it starts with a letter.
      const hexName = 'abcdef0123456789'.repeat(4);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb1111'),
          index_block_hash: hash('dddd1111'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa1111'), sender_address: SENDER })
          .addTxFtEvent({
            asset_identifier: `${CONTRACT_ID}::${hexName}`,
            recipient: SENDER,
            asset_event_type_id: DbAssetEventTypeId.Mint,
          })
          .build()
      );

      const bare = await search(`q=${hexName}`);
      assert.deepEqual(types(bare.body), ['token']);
      assert.equal(bare.body.results[0].result.asset_name, hexName);

      // With the `0x` prefix the term is unambiguously a hash, so names are not searched.
      const prefixed = await search(`q=0x${hexName}`);
      assert.deepEqual(prefixed.body.results, []);
    });
  });

  describe('token canonical state', () => {
    test('drops a token whose only sighting was orphaned by a re-org', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb1111'),
          index_block_hash: hash('dddd1111'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa1111'), sender_address: SENDER })
          .addTxFtEvent({
            asset_identifier: `${CONTRACT_ID}::orphaned`,
            recipient: SENDER,
            asset_event_type_id: DbAssetEventTypeId.Mint,
          })
          .build()
      );

      // Visible while its block is still the canonical tip.
      const beforeReorg = await search('q=orphaned&type=token');
      assert.deepEqual(types(beforeReorg.body), ['token']);

      // A competing block at the same height, then one extending it, orphans the sighting.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb9999'),
          index_block_hash: hash('dddd9999'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa9999'), sender_address: SENDER })
          .addTxFtEvent({
            asset_identifier: ASSET_ID,
            recipient: SENDER,
            asset_event_type_id: DbAssetEventTypeId.Mint,
          })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          block_hash: hash('bbbb2222'),
          index_block_hash: hash('dddd2222'),
          parent_index_block_hash: hash('dddd9999'),
        }).build()
      );

      const afterReorg = await search('q=orphaned&type=token');
      assert.equal(afterReorg.statusCode, 200);
      assert.deepEqual(afterReorg.body.results, []);

      // The row itself is kept, so the asset comes back if its transaction is ever mined.
      const rows = await db.sql<{ asset_identifier: string }[]>`
        SELECT asset_identifier FROM token_assets WHERE asset_identifier LIKE '%orphaned'
      `;
      assert.equal(rows.length, 1);

      // The token seen on the winning fork is still returned.
      const canonicalToken = await search('q=diko&type=token');
      assert.deepEqual(types(canonicalToken.body), ['token']);
      assert.equal(canonicalToken.body.results[0].result.asset_identifier, ASSET_ID);
    });

    test('keeps a token whose transaction is re-mined on the winning fork', async () => {
      const remined = `${CONTRACT_ID}::remined`;
      const mintTx = hash('aaaa1111');
      const mint = (builder: TestBlockBuilder) =>
        builder
          .addTx({ tx_id: mintTx, sender_address: SENDER })
          .addTxFtEvent({
            asset_identifier: remined,
            recipient: SENDER,
            asset_event_type_id: DbAssetEventTypeId.Mint,
          });

      await db.update(
        mint(
          new TestBlockBuilder({
            block_height: 1,
            block_hash: hash('bbbb1111'),
            index_block_hash: hash('dddd1111'),
            parent_index_block_hash: hash('dddd0000'),
          })
        ).build()
      );
      // The winning fork carries the same transaction, which keeps its id because a Stacks
      // transaction id hashes the transaction itself, not its position in a block.
      await db.update(
        mint(
          new TestBlockBuilder({
            block_height: 1,
            block_hash: hash('bbbb9999'),
            index_block_hash: hash('dddd9999'),
            parent_index_block_hash: hash('dddd0000'),
          })
        ).build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          block_hash: hash('bbbb2222'),
          index_block_hash: hash('dddd2222'),
          parent_index_block_hash: hash('dddd9999'),
        }).build()
      );

      // `token_assets` still points at the transaction from the orphaned block, but that id now
      // resolves to a canonical row, so the asset stays visible with no maintenance of its own.
      const res = await search('q=remined&type=token');
      assert.deepEqual(types(res.body), ['token']);
      assert.equal(res.body.results[0].result.asset_identifier, remined);
    });

    test('a later canonical sighting takes over a stale reference', async () => {
      const asset = `${CONTRACT_ID}::switched`;
      const mint = (builder: TestBlockBuilder, txId: string) =>
        builder.addTx({ tx_id: txId, sender_address: SENDER }).addTxFtEvent({
          asset_identifier: asset,
          recipient: SENDER,
          asset_event_type_id: DbAssetEventTypeId.Mint,
        });

      await db.update(
        mint(
          new TestBlockBuilder({
            block_height: 1,
            block_hash: hash('bbbb1111'),
            index_block_hash: hash('dddd1111'),
            parent_index_block_hash: hash('dddd0000'),
          }),
          hash('aaaa1111')
        ).build()
      );
      // Orphan that sighting, which leaves the recorded transaction non-canonical.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hash('bbbb9999'),
          index_block_hash: hash('dddd9999'),
          parent_index_block_hash: hash('dddd0000'),
        })
          .addTx({ tx_id: hash('aaaa9999'), sender_address: SENDER })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          block_hash: hash('bbbb2222'),
          index_block_hash: hash('dddd2222'),
          parent_index_block_hash: hash('dddd9999'),
        }).build()
      );
      const orphaned = await search('q=switched&type=token');
      assert.deepEqual(orphaned.body.results, []);

      // The asset is emitted again on the winning chain by a *different* transaction, which takes
      // over the stale reference.
      await db.update(
        mint(
          new TestBlockBuilder({
            block_height: 3,
            block_hash: hash('bbbb3333'),
            index_block_hash: hash('dddd3333'),
            parent_index_block_hash: hash('dddd2222'),
          }),
          hash('aaaa3333')
        ).build()
      );

      const repaired = await search('q=switched&type=token');
      assert.deepEqual(types(repaired.body), ['token']);
      assert.equal(repaired.body.results[0].result.asset_identifier, asset);
    });

    test('requires every asset to record a transaction', async () => {
      // The backfill resolves one for every asset, so search never has to treat a missing
      // transaction as visible.
      await assert.rejects(
        () => db.sql`
          INSERT INTO token_assets (asset_identifier, asset_type, tx_id)
          VALUES (${`${CONTRACT_ID}::legacy`}, 'ft', NULL)
        `,
        /not-null constraint/
      );
    });
  });
});
