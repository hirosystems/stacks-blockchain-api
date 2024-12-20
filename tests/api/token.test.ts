import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { ApiServer, startApiServer } from '../../src/api/init';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../utils/test-builders';
import { DbAssetEventTypeId } from '../../src/datastore/common';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { migrate } from '../utils/test-helpers';

describe('/extended/v1/tokens tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
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
    expect(result1.results[0].block_height).toEqual(block1.block.block_height);

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
    expect(result2.results[0].block_height).toEqual(block1.block.block_height);

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
    expect(result3.results[0].block_height).toEqual(block2.block.block_height);

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
    expect(result4.results[0].block_height).toEqual(block2.block.block_height);

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
    expect(result5.results[0].block_height).toEqual(block1.block.block_height);

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
    expect(result6.results[0].block_height).toEqual(block3.block.block_height);

    // Transfer NFT from addr2 to addr3 in microblock
    const microblock1 = new TestMicroblockStreamBuilder()
      .addMicroblock({ microblock_hash: '0x11', parent_index_block_hash: '0x03' })
      .addTx({ tx_id: '0x5499' })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr2,
        recipient: addr3,
      })
      .build();
    await db.updateMicroblocks(microblock1);

    // Confirm unanchored txs
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03',
      parent_microblock_hash: '0x11',
    })
      .addTx({ tx_id: '0x5499' })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr2,
        recipient: addr3,
      })
      .build();
    await db.update(block4);

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
      .addMicroblock({ microblock_hash: '0x12', parent_index_block_hash: '0x05' })
      .addTx({ tx_id: '0xf7f7', microblock_canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
      })
      .build();
    await db.updateMicroblocks(microblock2);

    // Confirm txs
    const block6 = new TestBlockBuilder({
      block_height: 6,
      index_block_hash: '0x06',
      parent_index_block_hash: '0x05',
    })
      .addTx({ tx_id: '0xf7f7', microblock_canonical: false })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
      })
      .build();
    await db.update(block6);

    // Transfer NFT from addr3 to addr2 and back in the same block
    const microblock3 = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x13',
        parent_index_block_hash: '0x06',
        microblock_sequence: 0,
      })
      .addTx({ tx_id: '0x1009' })
      .addTxStxEvent({ event_index: 0 })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
        event_index: 1, // Higher event index
      })
      .addMicroblock({
        microblock_hash: '0x14',
        parent_index_block_hash: '0x06',
        microblock_sequence: 1,
      })
      .addTx({ tx_id: '0x100a' })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr2,
        recipient: addr3,
        event_index: 0, // Lower event index but higher microblock index
      })
      .build();
    await db.updateMicroblocks(microblock3);
    // Confirm txs
    const block7 = new TestBlockBuilder({
      block_height: 7,
      index_block_hash: '0x07',
      parent_index_block_hash: '0x06',
    })
      .addTx({ tx_id: '0x1009' })
      .addTxStxEvent({ event_index: 0 })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
        event_index: 1, // Higher event index
      })
      .addTx({ tx_id: '0x100a' })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr2,
        recipient: addr3,
        event_index: 0, // Lower event index but higher microblock index
      })
      .build();
    await db.update(block7);

    // Request: addr2 still has 0 NFTs
    const request14 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}`
    );
    expect(request14.status).toBe(200);
    expect(request14.type).toBe('application/json');
    const result14 = JSON.parse(request14.text);
    expect(result14.total).toEqual(0);

    // Transfer NFT from addr3 to addr2 and back in the same tx
    const block8 = new TestBlockBuilder({
      block_height: 8,
      index_block_hash: '0x08',
      parent_index_block_hash: '0x07',
    })
      .addTx({ tx_id: '0x100c' })
      // Reversed events but correct event_index
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr2,
        recipient: addr3,
        event_index: 2,
      })
      .addTxNftEvent({
        asset_identifier: assetId2,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: addr2,
        event_index: 1,
      })
      .build();
    await db.update(block8);

    // Request: addr2 still has 0 NFTs
    const request15 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/holdings?principal=${addr2}`
    );
    expect(request15.status).toBe(200);
    expect(request15.type).toBe('application/json');
    const result15 = JSON.parse(request15.text);
    expect(result15.total).toEqual(0);
  });

  test('/nft/history', async () => {
    const addr1 = 'SP3BK1NNSWN719Z6KDW05RBGVS940YCN6X84STYPR';
    const addr2 = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const addr3 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const marketplace = 'SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v4';
    const contractAddr1 = 'SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173';
    const valueHex = '0x01000000000000000000000000000009c5';
    const assetId = `${contractAddr1}.the-explorer-guild::The-Explorer-Guild`;

    // Mint NFT
    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({ tx_id: '0x1001' })
      .addTxStxEvent({ sender: addr1, recipient: contractAddr1 })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: valueHex,
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
        value: valueHex,
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
        value: valueHex,
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
      parent_microblock_hash: '0x11',
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
        value: valueHex,
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
        value: valueHex,
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
        value: valueHex,
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

    // List NFT to marketplace and purchase in the same block
    const microblock3 = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x13',
        parent_index_block_hash: '0x06',
        microblock_sequence: 0,
      })
      .addTx({ tx_id: '0x1009' })
      .addTxStxEvent({ event_index: 0 })
      // List
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr3,
        recipient: marketplace,
        value: valueHex,
        event_index: 1, // Higher event index
      })
      .addMicroblock({
        microblock_hash: '0x14',
        parent_index_block_hash: '0x06',
        microblock_sequence: 1,
      })
      .addTx({ tx_id: '0x100a' })
      // Purchase
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: marketplace,
        recipient: addr2,
        value: valueHex,
        event_index: 0, // Lower event index but higher microblock index
      })
      .build();
    await db.updateMicroblocks(microblock3);
    // Confirm txs
    const block7 = new TestBlockBuilder({
      block_height: 7,
      index_block_hash: '0x07',
      parent_index_block_hash: '0x06',
      parent_microblock_hash: '0x14',
    })
      .addTx({ tx_id: '0x100b' })
      .build();
    await db.update(block7);

    // Request: events appear in the correct order
    const request10 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${valueHex}`
    );
    expect(request10.status).toBe(200);
    expect(request10.type).toBe('application/json');
    const result10 = JSON.parse(request10.text);
    expect(result10.total).toEqual(5);
    expect(result10.results[0].sender).toEqual(marketplace);
    expect(result10.results[0].recipient).toEqual(addr2);
    expect(result10.results[0].tx_id).toEqual('0x100a');
    expect(result10.results[1].sender).toEqual(addr3);
    expect(result10.results[1].recipient).toEqual(marketplace);
    expect(result10.results[1].tx_id).toEqual('0x1009');

    // Mint and transfer NFT in the same tx
    const newValueHex = '0x01000000000000000000000000000009c6';
    const block8 = new TestBlockBuilder({
      block_height: 8,
      index_block_hash: '0x08',
      parent_index_block_hash: '0x07',
    })
      .addTx({ tx_id: '0x100c' })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: newValueHex,
        event_index: 1,
      })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        sender: addr1,
        recipient: marketplace,
        value: newValueHex,
        event_index: 2,
      })
      .build();
    await db.update(block8);

    // Request: events appear in the correct event_index order
    const request11 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/history?asset_identifier=${assetId}&value=${newValueHex}`
    );
    expect(request11.status).toBe(200);
    expect(request11.type).toBe('application/json');
    const result11 = JSON.parse(request11.text);
    expect(result11.total).toEqual(2);
    expect(result11.results[0].asset_event_type).toEqual('transfer');
    expect(result11.results[1].asset_event_type).toEqual('mint');
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
        value: '0x01000000000000000000000000000009c5',
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
        value: '0x01000000000000000000000000000009c6',
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
        value: '0x01000000000000000000000000000009c7',
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
      parent_microblock_hash: '0x11',
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
        value: '0x01000000000000000000000000000009c8',
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
        value: '0x01000000000000000000000000000009c8',
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
        value: '0x01000000000000000000000000000009c8',
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

    // Mint two NFTs in the same block
    const microblock3 = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x13',
        parent_index_block_hash: '0x06',
        microblock_sequence: 0,
      })
      .addTx({ tx_id: '0x1009' })
      .addTxStxEvent({ event_index: 0 })
      // Mint #1
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: '0x01000000000000000000000000000009c8',
        event_index: 1, // Higher event index
      })
      .addMicroblock({
        microblock_hash: '0x14',
        parent_index_block_hash: '0x06',
        microblock_sequence: 1,
      })
      .addTx({ tx_id: '0x100a' })
      // Mint #2
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: '0x01000000000000000000000000000009c9',
        event_index: 0, // Lower event index but higher microblock index
      })
      .build();
    await db.updateMicroblocks(microblock3);
    // Confirm txs
    const block7 = new TestBlockBuilder({
      block_height: 7,
      index_block_hash: '0x07',
      parent_index_block_hash: '0x06',
      parent_microblock_hash: '0x14',
    })
      .addTx({ tx_id: '0x100b' })
      .build();
    await db.update(block7);

    // Request: events appear in the correct order
    const request10 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request10.status).toBe(200);
    expect(request10.type).toBe('application/json');
    const result10 = JSON.parse(request10.text);
    expect(result10.total).toEqual(5);
    expect(result10.results[0].value.hex).toEqual('0x01000000000000000000000000000009c9');
    expect(result10.results[0].tx_id).toEqual('0x100a');
    expect(result10.results[1].value.hex).toEqual('0x01000000000000000000000000000009c8');
    expect(result10.results[1].tx_id).toEqual('0x1009');

    // Mint two NFTs in the same tx
    const block8 = new TestBlockBuilder({
      block_height: 8,
      index_block_hash: '0x08',
      parent_index_block_hash: '0x07',
    })
      .addTx({ tx_id: '0x100c' })
      // Reversed events but correct event_index
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: '0x01000000000000000000000000000009cb',
        event_index: 2,
      })
      .addTxNftEvent({
        asset_identifier: assetId,
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: addr1,
        value: '0x01000000000000000000000000000009ca',
        event_index: 1,
      })
      .build();
    await db.update(block8);

    // Request: events appear in the correct event_index order
    const request11 = await supertest(api.server).get(
      `/extended/v1/tokens/nft/mints?asset_identifier=${assetId}`
    );
    expect(request11.status).toBe(200);
    expect(request11.type).toBe('application/json');
    const result11 = JSON.parse(request11.text);
    expect(result11.total).toEqual(7);
    expect(result11.results[0].value.hex).toEqual('0x01000000000000000000000000000009cb');
    expect(result11.results[1].value.hex).toEqual('0x01000000000000000000000000000009ca');
  });

  test('/ft/holders - stx', async () => {
    const addr1 = 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR';

    // Transfer stx to addr
    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({ tx_id: '0x5454' })
      .addTxStxEvent({ recipient: addr1, amount: 1000n })
      .build();
    await db.update(block1);

    const request1 = await supertest(api.server).get(`/extended/v1/tokens/ft/stx/holders`);
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');

    const request1Body = request1.body as { results: any[] };
    const balance1 = request1Body.results.find(b => b.address === addr1)?.balance;
    expect(balance1).toBe('1000');
  });

  test('/ft/holders - ft', async () => {
    const addr1 = 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR';
    const ftID = 'SPA0SZQ6KCCYMJV5XVKSNM7Y1DGDXH39A11ZX2Y8.gamestop::GME';

    // Transfer ft to addr
    const block1 = new TestBlockBuilder({ block_height: 1, index_block_hash: '0x01' })
      .addTx({ tx_id: '0x5454' })
      .addTxFtEvent({
        recipient: addr1,
        amount: 1000n,
        asset_identifier: ftID,
      })
      .build();
    await db.update(block1);

    const request1 = await supertest(api.server).get(`/extended/v1/tokens/ft/${ftID}/holders`);
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');

    const request1Body = request1.body as { results: any[] };
    const balance1 = request1Body.results.find(b => b.address === addr1)?.balance;
    expect(balance1).toBe('1000');
  });
});
