import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbAssetEventTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';
import { serializeCV, uintCV } from '@stacks/transactions';

/**
 * Legacy rows recorded no Stacks block time (`block_time = 0`). v1 and v2 fall back to the anchor
 * Bitcoin block's time; every v3 response that carries a Stacks block time must do the same.
 */
describe('v3 legacy block times', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const sender = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const recipient = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
  const ftAsset = 'SP000000000000000000002Q6VF78.token-a::a';
  const nftAsset = 'SP000000000000000000002Q6VF78.guild::Guild';
  const nftValue = '0x' + serializeCV(uintCV(1));
  const txId = hex(0x11);
  const burnBlockTime = 1_700_000_000;
  const expected = { time: burnBlockTime, time_iso: '2023-11-14T22:13:20.000Z' };

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: hex(1),
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
        parent_block_hash: hex(0),
        burn_block_time: burnBlockTime,
      })
        .addTx({ tx_id: txId, sender_address: sender })
        .addTxStxEvent({ sender, recipient, amount: 1_000n })
        .addTxFtEvent({ sender, recipient, asset_identifier: ftAsset, amount: 10n })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          sender,
          recipient,
          asset_identifier: nftAsset,
          value: nftValue,
        })
        .build()
    );
    await db.sql`UPDATE blocks SET block_time = 0`;
    await db.sql`UPDATE txs SET block_time = 0`;
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  const get = async (url: string) => {
    const res = await api.fastifyApp.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };
  const time = (entity: { block: { time: number; time_iso: string } }) => ({
    time: entity.block.time,
    time_iso: entity.block.time_iso,
  });

  test('transactions fall back to the Bitcoin block time', async () => {
    assert.deepEqual(time(await get(`/extended/v3/transactions/${txId}`)), expected);
    assert.deepEqual(time((await get('/extended/v3/transactions')).results[0]), expected);
    assert.deepEqual(time((await get('/extended/v3/blocks/1/transactions')).results[0]), expected);
    assert.deepEqual(
      time((await get(`/extended/v3/principals/${sender}/transactions`)).results[0].transaction),
      expected
    );
  });

  test('transfers and NFT history fall back to the Bitcoin block time', async () => {
    assert.deepEqual(
      time((await get(`/extended/v3/principals/${recipient}/transfers/stx/inbound`)).results[0]),
      expected
    );
    assert.deepEqual(
      time((await get(`/extended/v3/principals/${recipient}/transfers/ft/${ftAsset}`)).results[0]),
      expected
    );
    assert.deepEqual(
      time((await get(`/extended/v3/tokens/nft/${nftAsset}/${nftValue}/history`)).results[0]),
      expected
    );
  });

  test('blocks fall back to the Bitcoin block time', async () => {
    const block = await get('/extended/v3/blocks/1');
    assert.deepEqual({ time: block.time, time_iso: block.time_iso }, expected);
  });
});
