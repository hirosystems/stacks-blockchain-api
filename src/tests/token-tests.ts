import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { cycleMigrations, PgDataStore, runMigrations } from '../datastore/postgres-store';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../test-utils/test-builders';
import { DbAssetEventTypeId } from '../datastore/common';
import { hexToBuffer } from '../helpers';

describe('/extended/v1/tokens tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
  });

  test('/nft/holdings', async () => {
    const addr1 = 'SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR';
    const addr2 = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const addr3 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const contractAddr1 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const assetId1 = `${contractAddr1}.the-explorer-guild::The-Explorer-Guild`;
    const contractAddr2 = 'SP2BE8TZATXEVPGZ8HAFZYE5GKZ02X0YDKAN7ZTGW';
    const assetId2 = `${contractAddr2}.arties::arties`;

    // Mint NFT
    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({ tx_id: '0x5454' })
      .addTxStxEvent({ sender: addr1, recipient: contractAddr1 })
      .addTxNftEvent({
        asset_identifier: assetId1,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
      })
      .build();
    await db.update(block1);

    // Request: default
    const request1 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr1}`
    );
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    const result1 = JSON.parse(request1.text);
    expect(result1.total).toEqual(1);
    expect(result1.results[0].asset_identifier).toEqual(assetId1);
    expect(result1.results[0].tx_id).toEqual('0x5454');

    // Request: with metadata
    const request2 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr1}&tx_metadata=true`
    );
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    const result2 = JSON.parse(request2.text);
    expect(result2.total).toEqual(1);
    expect(result2.results[0].asset_identifier).toEqual(assetId1);
    expect(result2.results[0].tx.tx_id).toEqual('0x5454');

    // Mint another NFT
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x5464' })
      .addTxStxEvent({ sender: addr1, recipient: contractAddr2 })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
      })
      .build();
    await db.update(block2);

    // Request: default, two assets
    const request3 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr1}`
    );
    expect(request3.status).toBe(200);
    expect(request3.type).toBe('application/json');
    const result3 = JSON.parse(request3.text);
    expect(result3.total).toEqual(2);
    expect(result3.results[0].asset_identifier).toEqual(assetId2);
    expect(result3.results[0].tx_id).toEqual('0x5464');

    // Request: filtered by asset id
    const request4 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr1}&asset_identifiers=${assetId2}`
    );
    expect(request4.status).toBe(200);
    expect(request4.type).toBe('application/json');
    const result4 = JSON.parse(request4.text);
    expect(result4.total).toEqual(1); // 1 result only
    expect(result4.results[0].asset_identifier).toEqual(assetId2);
    expect(result4.results[0].tx_id).toEqual('0x5464');

    // Transfer one NFT from addr1 to addr2
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: '0x5484' })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr1,
        recipient: addr2,
      })
      .build();
    await db.update(block3);

    // Request: addr1 only has one NFT left
    const request5 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr1}`
    );
    expect(request5.status).toBe(200);
    expect(request5.type).toBe('application/json');
    const result5 = JSON.parse(request5.text);
    expect(result5.total).toEqual(1);
    expect(result5.results[0].asset_identifier).toEqual(assetId1);
    expect(result5.results[0].tx_id).toEqual('0x5454');

    // Request: addr2 has the other
    const request6 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}`
    );
    expect(request6.status).toBe(200);
    expect(request6.type).toBe('application/json');
    const result6 = JSON.parse(request6.text);
    expect(result6.total).toEqual(1);
    expect(result6.results[0].asset_identifier).toEqual(assetId2);
    expect(result6.results[0].tx_id).toEqual('0x5484');

    // Transfer NFT from addr2 to addr3 in microblock
    const microblock1 = new TestMicroblockStreamBuilder()
      .addMicroblock({ parent_index_block_hash: '0x03' })
      .addTx({ tx_id: '0x5499' })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr2,
        recipient: addr3,
      })
      .build();
    await db.updateMicroblocks(microblock1);

    // Request: unanchored shows addr2 with 0 NFTs
    const request7 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}&unanchored=true`
    );
    expect(request7.status).toBe(200);
    expect(request7.type).toBe('application/json');
    const result7 = JSON.parse(request7.text);
    expect(result7.total).toEqual(0);

    // Request: anchored shows addr2 still with 1 NFT
    const request8 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}`
    );
    expect(request8.status).toBe(200);
    expect(request8.type).toBe('application/json');
    const result8 = JSON.parse(request8.text);
    expect(result8.total).toEqual(1);

    // Confirm unanchored txs
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03',
    })
      .addTx({ tx_id: '0x5555' })
      .build();
    await db.update(block4);

    // Request: unanchored still shows addr2 with 0 NFTs
    const request9 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}&unanchored=true`
    );
    expect(request9.status).toBe(200);
    expect(request9.type).toBe('application/json');
    const result9 = JSON.parse(request9.text);
    expect(result9.total).toEqual(0);

    // Request: anchored now shows addr2 with 0 NFTs
    const request10 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}`
    );
    expect(request10.status).toBe(200);
    expect(request10.type).toBe('application/json');
    const result10 = JSON.parse(request10.text);
    expect(result10.total).toEqual(0);

    // Transfer NFT from addr3 back to addr2 in a re-orged tx
    const block5 = new TestBlockBuilder({
      block_height: 5,
      index_block_hash: '0x05',
      parent_index_block_hash: '0x04',
    })
      .addTx({ tx_id: '0x6161', canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
      })
      .build();
    await db.update(block5);

    // Request: addr2 still has 0 NFTs
    const request11 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}`
    );
    expect(request11.status).toBe(200);
    expect(request11.type).toBe('application/json');
    const result11 = JSON.parse(request11.text);
    expect(result11.total).toEqual(0);

    // Transfer NFT from addr3 back to addr2 again in a micro re-orged tx
    const microblock2 = new TestMicroblockStreamBuilder()
      .addMicroblock({ parent_index_block_hash: '0x05' })
      .addTx({ tx_id: '0xf7f7', microblock_canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
      })
      .build();
    await db.updateMicroblocks(microblock1);

    // Request: addr2 still has 0 NFTs unanchored
    const request12 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}&unanchored=true`
    );
    expect(request12.status).toBe(200);
    expect(request12.type).toBe('application/json');
    const result12 = JSON.parse(request12.text);
    expect(result12.total).toEqual(0);

    // Request: addr2 still has 0 NFTs anchored
    const request13 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}`
    );
    expect(request13.status).toBe(200);
    expect(request13.type).toBe('application/json');
    const result13 = JSON.parse(request13.text);
    expect(result13.total).toEqual(0);
  });

  test('/nft/history', async () => {
    const addr1 = 'SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR';
    const addr2 = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const addr3 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const contractAddr1 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const valueHex = '0x01000000000000000000000000000009c5';
    const value = hexToBuffer(valueHex);
    const assetId = `${contractAddr1}.the-explorer-guild::The-Explorer-Guild`;

    // Mint NFT
    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({ tx_id: '0x1001' })
      .addTxStxEvent({ sender: addr1, recipient: contractAddr1 })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: value,
      })
      .build();
    await db.update(block1);

    // Request: default
    const request1 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}`
    );
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    const result1 = JSON.parse(request1.text);
    expect(result1.total).toEqual(1);
    expect(result1.results[0].sender).toEqual(null);
    expect(result1.results[0].recipient).toEqual(addr1);
    expect(result1.results[0].tx_id).toEqual('0x1001');

    // Request: with metadata
    const request2 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}&tx_metadata=true`
    );
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    const result2 = JSON.parse(request2.text);
    expect(result2.total).toEqual(1);
    expect(result2.results[0].sender).toEqual(null);
    expect(result2.results[0].recipient).toEqual(addr1);
    expect(result2.results[0].tx.tx_id).toEqual('0x1001');

    // Transfer NFT to addr2
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x1002' })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr1,
        recipient: addr2,
        value: value,
      })
      .build();
    await db.update(block2);

    // Request: new event appears in history
    const request3 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}`
    );
    expect(request3.status).toBe(200);
    expect(request3.type).toBe('application/json');
    const result3 = JSON.parse(request3.text);
    expect(result3.total).toEqual(2);
    expect(result3.results[0].sender).toEqual(addr1);
    expect(result3.results[0].recipient).toEqual(addr2);
    expect(result3.results[0].tx_id).toEqual('0x1002');
    expect(result3.results[1].tx_id).toEqual('0x1001');

    // Transfer NFT from addr2 to addr3 in microblock
    const microblock1 = new TestMicroblockStreamBuilder()
      .addMicroblock({ microblock_hash: '0x11', parent_index_block_hash: '0x02' })
      .addTx({ tx_id: '0x1003' })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr2,
        recipient: addr3,
        value: value,
      })
      .build();
    await db.updateMicroblocks(microblock1);

    // Request: new event appears in unanchored history
    const request4 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}&unanchored=true`
    );
    expect(request4.status).toBe(200);
    expect(request4.type).toBe('application/json');
    const result4 = JSON.parse(request4.text);
    expect(result4.total).toEqual(3);
    expect(result4.results[0].sender).toEqual(addr2);
    expect(result4.results[0].recipient).toEqual(addr3);
    expect(result4.results[0].tx_id).toEqual('0x1003');

    // Request: new event does not appear in anchored history
    const request5 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}`
    );
    expect(request5.status).toBe(200);
    expect(request5.type).toBe('application/json');
    const result5 = JSON.parse(request5.text);
    expect(result5.total).toEqual(2);
    expect(result5.results[0].sender).toEqual(addr1);
    expect(result5.results[0].recipient).toEqual(addr2);
    expect(result5.results[0].tx_id).toEqual('0x1002');

    // Confirm unanchored txs
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: '0x1004' })
      .build();
    await db.update(block3);

    // Request: new event now appears in anchored history
    const request6 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}`
    );
    expect(request6.status).toBe(200);
    expect(request6.type).toBe('application/json');
    const result6 = JSON.parse(request6.text);
    expect(result6.total).toEqual(3);
    expect(result6.results[0].sender).toEqual(addr2);
    expect(result6.results[0].recipient).toEqual(addr3);
    expect(result6.results[0].tx_id).toEqual('0x1003');

    // Transfer NFT back to addr2 in a re-org tx
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03',
    })
      .addTx({ tx_id: '0x1005', canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
        value: value,
      })
      .build();
    await db.update(block4);

    // Request: non-canonical event does not appear in history
    const request7 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}`
    );
    expect(request7.status).toBe(200);
    expect(request7.type).toBe('application/json');
    const result7 = JSON.parse(request7.text);
    expect(result7.total).toEqual(3);
    expect(result7.results[0].sender).toEqual(addr2);
    expect(result7.results[0].recipient).toEqual(addr3);
    expect(result7.results[0].tx_id).toEqual('0x1003');

    // Transfer NFT back to addr2 in a microblock re-org tx
    const microblock2 = new TestMicroblockStreamBuilder()
      .addMicroblock({ microblock_hash: '0x12', parent_index_block_hash: '0x04' })
      .addTx({ tx_id: '0x1006', microblock_canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
        value: value,
      })
      .build();
    await db.updateMicroblocks(microblock2);

    // Request: non-canonical event does not appear in unanchored history
    const request8 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}&unanchored=true`
    );
    expect(request8.status).toBe(200);
    expect(request8.type).toBe('application/json');
    const result8 = JSON.parse(request8.text);
    expect(result8.total).toEqual(3);
    expect(result8.results[0].sender).toEqual(addr2);
    expect(result8.results[0].recipient).toEqual(addr3);
    expect(result8.results[0].tx_id).toEqual('0x1003');

    // Confirm unanchored txs
    const block5 = new TestBlockBuilder({
      block_height: 5,
      index_block_hash: '0x05',
      parent_index_block_hash: '0x04',
    })
      .addTx({ tx_id: '0x1007' })
      .build();
    await db.update(block5);

    // Transfer NFT back to addr2 in a canonical tx but re-org event
    const block6 = new TestBlockBuilder({
      block_height: 6,
      index_block_hash: '0x06',
      parent_index_block_hash: '0x05',
    })
      .addTx({ tx_id: '0x1008' })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
        value: value,
        canonical: false,
      })
      .build();
    await db.update(block6);

    // Request: non-canonical event does not appear in history
    const request9 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}`
    );
    expect(request9.status).toBe(200);
    expect(request9.type).toBe('application/json');
    const result9 = JSON.parse(request9.text);
    expect(result9.total).toEqual(3);
    expect(result9.results[0].sender).toEqual(addr2);
    expect(result9.results[0].recipient).toEqual(addr3);
    expect(result9.results[0].tx_id).toEqual('0x1003');
  });

  test('/nft/mints', async () => {
    const addr1 = 'SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR';
    const addr2 = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const addr3 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const contractAddr1 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const assetId = `${contractAddr1}.the-explorer-guild::The-Explorer-Guild`;

    // Mint NFT
    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({ tx_id: '0x1001' })
      .addTxStxEvent({ sender: addr1, recipient: contractAddr1 })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: hexToBuffer('0x01000000000000000000000000000009c5'),
      })
      .build();
    await db.update(block1);

    // Request: default
    const request1 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    const result1 = JSON.parse(request1.text);
    expect(result1.total).toEqual(1);
    expect(result1.results[0].recipient).toEqual(addr1);
    expect(result1.results[0].value.hex).toEqual('0x01000000000000000000000000000009c5');
    expect(result1.results[0].tx_id).toEqual('0x1001');

    // Request: with metadata
    const request2 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}&tx_metadata=true`
    );
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    const result2 = JSON.parse(request2.text);
    expect(result2.total).toEqual(1);
    expect(result2.results[0].recipient).toEqual(addr1);
    expect(result2.results[0].value.hex).toEqual('0x01000000000000000000000000000009c5');
    expect(result2.results[0].tx.tx_id).toEqual('0x1001');

    // Mint another NFT
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x1002' })
      .addTxStxEvent({ sender: addr2, recipient: contractAddr1 })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr2,
        value: hexToBuffer('0x01000000000000000000000000000009c6'),
      })
      .build();
    await db.update(block2);

    // Request: new minted NFT is returned
    const request3 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request3.status).toBe(200);
    expect(request3.type).toBe('application/json');
    const result3 = JSON.parse(request3.text);
    expect(result3.total).toEqual(2);
    expect(result3.results[0].recipient).toEqual(addr2);
    expect(result3.results[0].value.hex).toEqual('0x01000000000000000000000000000009c6');
    expect(result3.results[0].tx_id).toEqual('0x1002');

    // Mint NFT in microblock
    const microblock1 = new TestMicroblockStreamBuilder()
      .addMicroblock({ microblock_hash: '0x11', parent_index_block_hash: '0x02' })
      .addTx({ tx_id: '0x1003' })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr3,
        value: hexToBuffer('0x01000000000000000000000000000009c7'),
      })
      .build();
    await db.updateMicroblocks(microblock1);

    // Request: new mint appears in unanchored history
    const request4 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}&unanchored=true`
    );
    expect(request4.status).toBe(200);
    expect(request4.type).toBe('application/json');
    const result4 = JSON.parse(request4.text);
    expect(result4.total).toEqual(3);
    expect(result4.results[0].recipient).toEqual(addr3);
    expect(result4.results[0].value.hex).toEqual('0x01000000000000000000000000000009c7');
    expect(result4.results[0].tx_id).toEqual('0x1003');

    // Request: new mint does not appear in anchored history
    const request5 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request5.status).toBe(200);
    expect(request5.type).toBe('application/json');
    const result5 = JSON.parse(request5.text);
    expect(result5.total).toEqual(2);
    expect(result5.results[0].recipient).toEqual(addr2);
    expect(result5.results[0].value.hex).toEqual('0x01000000000000000000000000000009c6');
    expect(result5.results[0].tx_id).toEqual('0x1002');

    // Confirm unanchored txs
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: '0x1004' })
      .build();
    await db.update(block3);

    // Request: new mint now appears in anchored history
    const request6 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request6.status).toBe(200);
    expect(request6.type).toBe('application/json');
    const result6 = JSON.parse(request6.text);
    expect(result6.total).toEqual(3);
    expect(result6.results[0].recipient).toEqual(addr3);
    expect(result6.results[0].value.hex).toEqual('0x01000000000000000000000000000009c7');
    expect(result6.results[0].tx_id).toEqual('0x1003');

    // Mint NFT in a re-org tx
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03',
    })
      .addTx({ tx_id: '0x1005', canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: hexToBuffer('0x01000000000000000000000000000009c8'),
      })
      .build();
    await db.update(block4);

    // Request: non-canonical event does not appear in history
    const request7 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request7.status).toBe(200);
    expect(request7.type).toBe('application/json');
    const result7 = JSON.parse(request7.text);
    expect(result7.total).toEqual(3);
    expect(result7.results[0].recipient).toEqual(addr3);
    expect(result7.results[0].value.hex).toEqual('0x01000000000000000000000000000009c7');
    expect(result7.results[0].tx_id).toEqual('0x1003');

    // Mint NFT in a microblock re-org tx
    const microblock2 = new TestMicroblockStreamBuilder()
      .addMicroblock({ microblock_hash: '0x12', parent_index_block_hash: '0x04' })
      .addTx({ tx_id: '0x1006', microblock_canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: hexToBuffer('0x01000000000000000000000000000009c8'),
      })
      .build();
    await db.updateMicroblocks(microblock2);

    // Request: non-canonical event does not appear in unanchored history
    const request8 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}&unanchored=true`
    );
    expect(request8.status).toBe(200);
    expect(request8.type).toBe('application/json');
    const result8 = JSON.parse(request8.text);
    expect(result8.total).toEqual(3);
    expect(result8.results[0].recipient).toEqual(addr3);
    expect(result8.results[0].value.hex).toEqual('0x01000000000000000000000000000009c7');
    expect(result8.results[0].tx_id).toEqual('0x1003');

    // Confirm unanchored txs
    const block5 = new TestBlockBuilder({
      block_height: 5,
      index_block_hash: '0x05',
      parent_index_block_hash: '0x04',
    })
      .addTx({ tx_id: '0x1007' })
      .build();
    await db.update(block5);

    // Mint NFT in a canonical tx but re-org event
    const block6 = new TestBlockBuilder({
      block_height: 6,
      index_block_hash: '0x06',
      parent_index_block_hash: '0x05',
    })
      .addTx({ tx_id: '0x1008' })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: hexToBuffer('0x01000000000000000000000000000009c8'),
        canonical: false,
      })
      .build();
    await db.update(block6);

    // Request: non-canonical event does not appear in history
    const request9 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request9.status).toBe(200);
    expect(request9.type).toBe('application/json');
    const result9 = JSON.parse(request9.text);
    expect(result9.total).toEqual(3);
    expect(result9.results[0].recipient).toEqual(addr3);
    expect(result9.results[0].value.hex).toEqual('0x01000000000000000000000000000009c7');
    expect(result9.results[0].tx_id).toEqual('0x1003');
  });

  afterEach(async () => {
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
