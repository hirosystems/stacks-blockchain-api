import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { DbTxTypeId } from '../../src/datastore/common';
import { startApiServer, ApiServer } from '../../src/api/init';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../utils/test-builders';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { PgSqlClient } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';

describe('balance tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('balance calculation after microblock confirmations', async () => {
    const addr1 = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335';
    const addr2 = 'SP2TBW1RSC44JZA4XQ1C2G5SZRGSMM14C5NWAKSDD';

    // Send some initial balance for addr1
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x0001',
        parent_index_block_hash: '',
      })
        .addTx({
          tx_id: '0x1101',
          token_transfer_recipient_address: addr1,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 20_000n,
          fee_rate: 50n,
        })
        .addTxStxEvent({
          amount: 20_000n,
          block_height: 1,
          recipient: addr1,
          tx_id: '0x1101',
        })
        .build()
    );
    // Send STX to addr2 in a microblock in transaction 0x1102
    await db.updateMicroblocks(
      new TestMicroblockStreamBuilder()
        .addMicroblock({
          parent_index_block_hash: '0x0001',
          microblock_hash: '0xff01',
          microblock_sequence: 0,
        })
        .addTx({
          tx_id: '0x1102',
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
          microblock_hash: '0xff01',
          microblock_sequence: 0,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 2,
          sender: addr1,
          recipient: addr2,
          tx_id: '0x1102',
        })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x0002',
        parent_index_block_hash: '0x0001',
        parent_microblock_hash: '0xff01',
        parent_microblock_sequence: 0,
      })
        // Same transaction 0x1102 now appears confirmed in an anchor block
        .addTx({
          tx_id: '0x1102',
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
          microblock_hash: '0xff01',
          microblock_sequence: 0,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 2,
          sender: addr1,
          recipient: addr2,
          tx_id: '0x1102',
        })
        .build()
    );

    // Check that v1 balance matches v2 balance for both accounts.
    let result = await supertest(api.server).get(`/extended/v1/address/${addr1}/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    let v1balance = JSON.parse(result.text).balance;
    expect(v1balance).toBe('17900');
    result = await supertest(api.server).get(`/extended/v2/addresses/${addr1}/balances/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(JSON.parse(result.text).balance).toBe(v1balance);

    result = await supertest(api.server).get(`/extended/v1/address/${addr2}/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    v1balance = JSON.parse(result.text).balance;
    expect(v1balance).toBe('2000');
    result = await supertest(api.server).get(`/extended/v2/addresses/${addr2}/balances/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(JSON.parse(result.text).balance).toBe(v1balance);
  });

  test('balance calculation after block re-orgs', async () => {
    const addr1 = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335';
    const addr2 = 'SP2TBW1RSC44JZA4XQ1C2G5SZRGSMM14C5NWAKSDD';
    const reOrgTxId = '0x897e3d694daf0f8be81238158d66a3486857cd8356bc48be3c5181449d87937c';

    // Send some initial balance for addr1
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x0001',
        parent_index_block_hash: '',
      })
        .addTx({
          tx_id: '0x1101',
          token_transfer_recipient_address: addr1,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 20_000n,
          fee_rate: 50n,
        })
        .addTxStxEvent({
          amount: 20_000n,
          block_height: 1,
          recipient: addr1,
          tx_id: '0x1101',
        })
        .build()
    );
    // Mine block 2
    await db.update(
      new TestBlockBuilder({
        block_height: 2, // 139863
        block_hash: '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        index_block_hash: '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        parent_index_block_hash: '0x0001',
      }).build()
    );
    // Mine block 3 sending STX to addr2
    await db.update(
      new TestBlockBuilder({
        block_height: 3, // 139864
        block_hash: '0x8336ae2698295ee4db1cde0b168f927826dec5acc1735c904a71a963a6961837',
        index_block_hash: '0x8336ae2698295ee4db1cde0b168f927826dec5acc1735c904a71a963a6961837',
        parent_index_block_hash:
          '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
      })
        .addTx({
          tx_id: reOrgTxId,
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 3,
          sender: addr1,
          recipient: addr2,
          tx_id: reOrgTxId,
        })
        .build()
    );
    // Mine block 3 again with a different block hash, repeating the tx
    await db.update(
      new TestBlockBuilder({
        block_height: 3, // 139864
        block_hash: '0x7821f4c33d38fecc22df3c185b574f0c97d5cac47900782340d837181cef8622',
        index_block_hash: '0x7821f4c33d38fecc22df3c185b574f0c97d5cac47900782340d837181cef8622',
        parent_index_block_hash:
          '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
      })
        .addTx({
          tx_id: reOrgTxId,
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 3,
          sender: addr1,
          recipient: addr2,
          tx_id: reOrgTxId,
        })
        .build()
    );
    // Mine block 4. This will re-org the old block 3 txs.
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        index_block_hash: '0x0004',
        parent_index_block_hash:
          '0x7821f4c33d38fecc22df3c185b574f0c97d5cac47900782340d837181cef8622',
      }).build()
    );

    // Check that v1 balance matches v2 balance.
    let result = await supertest(api.server).get(`/extended/v1/address/${addr2}/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    let json = JSON.parse(result.text);
    const v1balance = json.balance;
    expect(v1balance).toBe('2000');

    result = await supertest(api.server).get(`/extended/v2/addresses/${addr2}/balances/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    json = JSON.parse(result.text);
    expect(json.balance).toBe(v1balance);
  });

  test('balance calculation after block re-org orphans microblock txs', async () => {
    const addr1 = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335';
    const addr2 = 'SP2TBW1RSC44JZA4XQ1C2G5SZRGSMM14C5NWAKSDD';
    const reOrgTxId = '0x897e3d694daf0f8be81238158d66a3486857cd8356bc48be3c5181449d87937c';

    // Send some initial balance for addr1
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x0001',
        parent_index_block_hash: '',
      })
        .addTx({
          tx_id: '0x1101',
          token_transfer_recipient_address: addr1,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 20_000n,
          fee_rate: 50n,
          microblock_hash: '0x',
        })
        .addTxStxEvent({
          amount: 20_000n,
          block_height: 1,
          recipient: addr1,
          tx_id: '0x1101',
        })
        .build()
    );
    // Mine block 2
    await db.update(
      new TestBlockBuilder({
        block_height: 2, // 139863
        block_hash: '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        index_block_hash: '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        parent_index_block_hash: '0x0001',
      }).build()
    );
    // Send balance via microblock
    await db.updateMicroblocks(
      new TestMicroblockStreamBuilder()
        .addMicroblock({
          parent_index_block_hash:
            '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
          microblock_hash: '0x31b3e49f9c3b04a3de6d177ec03ba6bae2fef86b29ef8fdf77db146d3cbec3af',
          microblock_sequence: 0,
        })
        .addTx({
          tx_id: reOrgTxId,
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
          microblock_hash: '0x31b3e49f9c3b04a3de6d177ec03ba6bae2fef86b29ef8fdf77db146d3cbec3af',
          microblock_sequence: 0,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 3,
          sender: addr1,
          recipient: addr2,
          tx_id: reOrgTxId,
        })
        .addMicroblock({
          parent_index_block_hash:
            '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
          microblock_hash: '0xa97440de98078abb824b10c931c42f4afc355f70b7aaa12ab02fcdcbcc279774',
          microblock_sequence: 1,
        })
        .addMicroblock({
          parent_index_block_hash:
            '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
          microblock_hash: '0xdcd850cd90b2d9a58239700bc366fafe12dc28b6896cb730bcd09f2cf9d928a8',
          microblock_sequence: 2,
        })
        .build()
    );
    // Mine block 3 confirming microblock txs
    await db.update(
      new TestBlockBuilder({
        block_height: 3, // 139864
        block_hash: '0x8336ae2698295ee4db1cde0b168f927826dec5acc1735c904a71a963a6961837',
        index_block_hash: '0x8336ae2698295ee4db1cde0b168f927826dec5acc1735c904a71a963a6961837',
        parent_index_block_hash:
          '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        parent_microblock_hash:
          '0xdcd850cd90b2d9a58239700bc366fafe12dc28b6896cb730bcd09f2cf9d928a8',
        parent_microblock_sequence: 2,
      })
        .addTx({
          tx_id: reOrgTxId,
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
          microblock_hash: '0x31b3e49f9c3b04a3de6d177ec03ba6bae2fef86b29ef8fdf77db146d3cbec3af',
          microblock_sequence: 0,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 3,
          sender: addr1,
          recipient: addr2,
          tx_id: reOrgTxId,
        })
        .build()
    );
    // Mine block 3 again, ignoring the microblock txs
    await db.update(
      new TestBlockBuilder({
        block_height: 3, // 139864
        block_hash: '0x7821f4c33d38fecc22df3c185b574f0c97d5cac47900782340d837181cef8622',
        index_block_hash: '0x7821f4c33d38fecc22df3c185b574f0c97d5cac47900782340d837181cef8622',
        parent_index_block_hash:
          '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        parent_microblock_hash:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        parent_microblock_sequence: 0,
      })
        .addTx({
          tx_id: reOrgTxId,
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
          microblock_hash: '0x',
          microblock_sequence: 2147483647,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 3,
          sender: addr1,
          recipient: addr2,
          tx_id: reOrgTxId,
        })
        .build()
    );
    // Mine block 4. This will re-org the microblock txs.
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        index_block_hash: '0x0004',
        parent_index_block_hash:
          '0x7821f4c33d38fecc22df3c185b574f0c97d5cac47900782340d837181cef8622',
      }).build()
    );

    // Check that v1 balance matches v2 balance.
    let result = await supertest(api.server).get(`/extended/v1/address/${addr2}/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    let json = JSON.parse(result.text);
    const v1balance = json.balance;
    expect(v1balance).toBe('2000');

    result = await supertest(api.server).get(`/extended/v2/addresses/${addr2}/balances/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    json = JSON.parse(result.text);
    expect(json.balance).toBe(v1balance);
  });

  test('balance calculation after micro-re-orgs', async () => {
    const addr1 = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335';
    const addr2 = 'SP2TBW1RSC44JZA4XQ1C2G5SZRGSMM14C5NWAKSDD';
    const reOrgTxId = '0x897e3d694daf0f8be81238158d66a3486857cd8356bc48be3c5181449d87937c';

    // Send some initial balance for addr1
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x0001',
        parent_index_block_hash: '',
      })
        .addTx({
          tx_id: '0x1101',
          token_transfer_recipient_address: addr1,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 20_000n,
          fee_rate: 50n,
          microblock_hash: '0x',
        })
        .addTxStxEvent({
          amount: 20_000n,
          block_height: 1,
          recipient: addr1,
          tx_id: '0x1101',
        })
        .build()
    );
    // Mine block 2
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        index_block_hash: '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        parent_index_block_hash: '0x0001',
      }).build()
    );
    // Send balance via microblock, then re-org the microblock txs
    await db.updateMicroblocks(
      new TestMicroblockStreamBuilder()
        .addMicroblock({
          parent_index_block_hash:
            '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
          microblock_hash: '0x31b3e49f9c3b04a3de6d177ec03ba6bae2fef86b29ef8fdf77db146d3cbec3af',
          microblock_parent_hash:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          microblock_sequence: 0,
        })
        .addTx({
          tx_id: reOrgTxId,
          sender_address: addr1,
          token_transfer_recipient_address: addr2,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 2000n,
          fee_rate: 100n,
          microblock_hash: '0x31b3e49f9c3b04a3de6d177ec03ba6bae2fef86b29ef8fdf77db146d3cbec3af',
          microblock_sequence: 0,
        })
        .addTxStxEvent({
          amount: 2000n,
          block_height: 3,
          sender: addr1,
          recipient: addr2,
          tx_id: reOrgTxId,
        })
        .addMicroblock({
          parent_index_block_hash:
            '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
          microblock_hash: '0x01010101',
          microblock_parent_hash:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          microblock_sequence: 0,
        })
        .addMicroblock({
          parent_index_block_hash:
            '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
          microblock_hash: '0xa97440de98078abb824b10c931c42f4afc355f70b7aaa12ab02fcdcbcc279774',
          microblock_parent_hash: '0x01010101',
          microblock_sequence: 1,
        })
        .addMicroblock({
          parent_index_block_hash:
            '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
          microblock_hash: '0xdcd850cd90b2d9a58239700bc366fafe12dc28b6896cb730bcd09f2cf9d928a8',
          microblock_parent_hash:
            '0xa97440de98078abb824b10c931c42f4afc355f70b7aaa12ab02fcdcbcc279774',
          microblock_sequence: 2,
        })
        .build()
    );
    // Mine block 3 confirming no microblock txs
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0x8336ae2698295ee4db1cde0b168f927826dec5acc1735c904a71a963a6961837',
        index_block_hash: '0x8336ae2698295ee4db1cde0b168f927826dec5acc1735c904a71a963a6961837',
        parent_index_block_hash:
          '0xe1fedcd0e80593967156cd09f0767d3854a7b1d4b59c24e4a6a3f5a04cf41ec3',
        parent_microblock_hash:
          '0xdcd850cd90b2d9a58239700bc366fafe12dc28b6896cb730bcd09f2cf9d928a8',
        parent_microblock_sequence: 2,
      }).build()
    );
    // Mine block 4. This will re-org the microblock txs.
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        index_block_hash: '0x0004',
        parent_index_block_hash:
          '0x8336ae2698295ee4db1cde0b168f927826dec5acc1735c904a71a963a6961837',
      }).build()
    );

    // Check that v1 balance matches v2 balance.
    let result = await supertest(api.server).get(`/extended/v1/address/${addr2}/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    let json = JSON.parse(result.text);
    const v1balance = json.balance;
    expect(v1balance).toBe('0');

    result = await supertest(api.server).get(`/extended/v2/addresses/${addr2}/balances/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    json = JSON.parse(result.text);
    expect(json.balance).toBe(v1balance);
  });

  test('balance calculation after miner rewards', async () => {
    const addr1 = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335';

    // Send some initial balance for addr1
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x0001',
        parent_index_block_hash: '',
      })
        .addTx({
          tx_id: '0x1101',
          token_transfer_recipient_address: addr1,
          type_id: DbTxTypeId.TokenTransfer,
          token_transfer_amount: 20_000n,
          fee_rate: 50n,
        })
        .addTxStxEvent({
          amount: 20_000n,
          block_height: 1,
          recipient: addr1,
          tx_id: '0x1101',
        })
        .build()
    );
    // Add some miner rewards
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x0002',
        parent_index_block_hash: '0x0001',
      })
        .addMinerReward({
          index_block_hash: '0x0002',
          recipient: addr1,
          coinbase_amount: 2000n,
          tx_fees_anchored: 0n,
          tx_fees_streamed_confirmed: 0n,
          tx_fees_streamed_produced: 0n,
        })
        .build()
    );

    // Check that v1 balance matches v2 balance.
    let result = await supertest(api.server).get(`/extended/v1/address/${addr1}/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    let json = JSON.parse(result.text);
    const v1balance = json.balance;
    const v1Rewards = json.total_miner_rewards_received;
    expect(v1balance).toBe('22000');
    result = await supertest(api.server).get(`/extended/v2/addresses/${addr1}/balances/stx`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    json = JSON.parse(result.text);
    expect(json.balance).toBe(v1balance);
    expect(json.total_miner_rewards_received).toBe(v1Rewards);
  });
});
