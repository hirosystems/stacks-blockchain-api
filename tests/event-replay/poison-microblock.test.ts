import { DbTxTypeId } from '../../src/datastore/common';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { importEventsFromTsv } from '../../src/event-replay/event-replay';

describe('poison microblock for height 80743', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db?.close();
  });

  test('test that it does not give 500 error', async () => {
    await importEventsFromTsv(
      'tests/event-replay/tsv/poisonmicroblock.tsv',
      'archival',
      true,
      true
    );
    const poisonTxId = '0x58ffe62029f94f7101b959536ea4953b9bce0ec3f6e2a06254c511bdd5cfa9e7';
    const chainTip = await db.getChainTip(db.sql);
    // query the txs table and check the transaction type
    const searchResult = await db.searchHash({ hash: poisonTxId });
    let entityData: any;
    if (searchResult.result?.entity_data) {
      entityData = searchResult.result?.entity_data;
    }
    // check the transaction type to be contract call for this poison block
    expect(entityData.type_id).toBe(DbTxTypeId.ContractCall);
    expect(searchResult.found).toBe(true);
    expect(chainTip.block_height).toBe(1);
    expect(chainTip.index_block_hash).toBe(
      '0x05ca75b9949195da435e6e36d731dbaa10bb75fda576a52263e25164990bfdaa'
    );
    expect(chainTip.block_hash).toBe(
      '0x6b83b44571365e6e530d679536578c71d6c376b07666f3671786b6fd8fac049c'
    );
  });
});
