/* eslint-disable @typescript-eslint/no-non-null-assertion */
import supertest from 'supertest';
import { BlockQueryResult } from '../../../src/datastore/common.ts';
import { parseBlockQueryResult } from '../../../src/datastore/helpers.ts';
import {
  CoinbaseTransaction,
  SmartContractTransaction,
  Transaction,
} from '../../../src/api/schemas/entities/transactions.ts';
import { Block } from '../../../src/api/schemas/entities/block.ts';
import {
  getKryptonContext,
  KryptonContext,
  standByUntilBlock,
  stopKryptonContext,
} from '../krypton-env.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

describe('Block-zero event handling', () => {
  const testnetBootAddr = 'ST000000000000000000002AMW42H';
  const genesisBlockTxCount = 8;
  const bootContractNames = ['pox', 'lockup', 'costs', 'cost-voting', 'bns', 'genesis'];

  let blockOne: Block;
  let blockOneTxs: Transaction[] = [];
  let ctx: KryptonContext;

  before(async () => {
    ctx = await getKryptonContext();
  });

  after(async () => {
    await stopKryptonContext(ctx);
  });

  test('Wait for block-one', async () => {
    await standByUntilBlock(1, ctx);
  });

  test('Ensure block-zero was emitted', async () => {
    // The block-zero event will leave a non-canonical block row at height 0
    const result = await ctx.db.sql<
      BlockQueryResult[]
    >`SELECT * FROM blocks WHERE block_height = 0`;
    assert.equal(result.count, 1);
    const blockZero = parseBlockQueryResult(result[0]);
    assert.equal(blockZero.canonical, false);
    assert.equal(
      blockZero.block_hash,
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    );
  });

  test('Block-one has boot block txs', async () => {
    const response = await supertest(ctx.api.server)
      .get(`/extended/v1/block/by_height/1`)
      .expect(200);
    blockOne = response.body;
    assert.equal(blockOne.txs.length, genesisBlockTxCount);
  });

  test('Get block-one txs', async () => {
    for (const txId of blockOne.txs) {
      const txRes = await supertest(ctx.api.server).get(`/extended/v1/tx/${txId}`).expect(200);
      blockOneTxs.push(txRes.body);
    }
    // Order by tx_index
    blockOneTxs = blockOneTxs.sort((a, b) => a.tx_index - b.tx_index);
  });

  test('Block-one txs have expected block properties', () => {
    // Ensure tx block values were update correctly after the "block-zero" txs were merged into "block-one"
    const blockOneProps: Partial<Transaction> = {
      canonical: true,
      tx_status: 'success',
      block_height: 1,
      block_hash: blockOne.hash,
      parent_block_hash: blockOne.parent_block_hash,
      burn_block_time: blockOne.burn_block_time,
      parent_burn_block_time: 0,
    };
    for (const tx of blockOneTxs) {
      assert.equal(tx.canonical, blockOneProps.canonical);
      assert.equal(tx.tx_status, blockOneProps.tx_status);
      assert.equal(tx.block_height, blockOneProps.block_height);
      assert.equal(tx.block_hash, blockOneProps.block_hash);
      assert.equal(tx.parent_block_hash, blockOneProps.parent_block_hash);
      assert.equal(tx.burn_block_time, blockOneProps.burn_block_time);
      assert.equal(tx.parent_burn_block_time, blockOneProps.parent_burn_block_time);
    }
  });

  test('Block-one txs have contiguous tx indexes', () => {
    // Ensure tx_index values were update correctly after the "block-zero" txs were merged into "block-one"
    for (let i = 0; i < genesisBlockTxCount; i++) {
      assert.equal(blockOneTxs[i].tx_index, i);
    }
  });

  test('Block-one coinbase tx', () => {
    const firstTx = blockOneTxs[0] as CoinbaseTransaction;
    assert.equal(firstTx.tx_type, 'coinbase');
    // sender should be not be the boot address (it should be a miner's address)
    assert.notEqual(firstTx.sender_address, testnetBootAddr);
  });

  test('Block-one boot txs have boot sender address', () => {
    // All txs other than the coinbase should have the special boot address
    const senderTx: Partial<Transaction> = { sender_address: testnetBootAddr };
    for (const tx of blockOneTxs.slice(1)) {
      assert.equal(tx.sender_address, senderTx.sender_address);
    }
  });

  test('Boot contracts', () => {
    // Ensure the several boot contracts exist
    const receivedContracts = blockOneTxs.filter(
      (tx): tx is SmartContractTransaction => tx.tx_type === 'smart_contract'
    );

    const bootContractIDs = bootContractNames.map(name => `${testnetBootAddr}.${name}`);
    const receivedContractIDs = receivedContracts.map(tx => tx.smart_contract.contract_id);
    assert.deepEqual(receivedContractIDs, bootContractIDs);
    for (let i = 0; i < receivedContracts.length; i++) {
      assert.equal(receivedContracts[i].tx_type, 'smart_contract');
      assert.equal(receivedContracts[i].smart_contract.contract_id, bootContractIDs[i]);
    }
  });

  test('Genesis contract-log print event', async () => {
    // One of the boot txs is a contract-deploy tx that prints the special genesis message
    const genesisContractID = `${testnetBootAddr}.genesis`;
    const genesisContractTx = blockOneTxs.filter(
      tx => tx.tx_type === 'smart_contract' && tx.smart_contract.contract_id === genesisContractID
    )[0] as SmartContractTransaction;
    assert.ok(genesisContractTx !== undefined);
    assert.equal(genesisContractTx.event_count, 1);
    assert.equal(genesisContractTx.events.length, 1);
    const txLogEvent: any = genesisContractTx.events[0];
    assert.equal(txLogEvent.event_index, 0);
    assert.equal(txLogEvent.event_type, 'smart_contract_log');
    assert.equal(txLogEvent.tx_id, genesisContractTx.tx_id);
    assert.equal(txLogEvent.contract_log.contract_id, genesisContractID);
    assert.equal(txLogEvent.contract_log.topic, 'print');
    assert.ok(String(txLogEvent.contract_log.value.hex).includes('0x'));
    assert.ok(String(txLogEvent.contract_log.value.repr).includes('share CPU power with Bitcoin'));

    const contractEventsRes = await supertest(ctx.api.server)
      .get(`/extended/v1/contract/${genesisContractID}/events`)
      .expect(200);
    const contractEvents = contractEventsRes.body as { results: any[] };
    assert.equal(contractEvents.results.length, 1);
    const contractLogEvent = contractEvents.results[0];
    assert.equal(contractLogEvent.event_index, 0);
    assert.equal(contractLogEvent.event_type, 'smart_contract_log');
    assert.equal(contractLogEvent.tx_id, genesisContractTx.tx_id);
    assert.equal(contractLogEvent.contract_log.contract_id, genesisContractID);
    assert.equal(contractLogEvent.contract_log.topic, 'print');
    assert.ok(String(contractLogEvent.contract_log.value.hex).includes('0x'));
    assert.ok(
      String(contractLogEvent.contract_log.value.repr).includes('share CPU power with Bitcoin')
    );
  });

  test('Genesis STX mint events', async () => {
    // One of the boot txs is a special "token_transfer" type that includes `stx_asset` mint events for seeding boot accounts
    const genesisStxMintTx = blockOneTxs.filter(tx => tx.tx_type === 'token_transfer')[0];
    assert.ok(genesisStxMintTx !== undefined);
    assert.ok(genesisStxMintTx.event_count > 1);
    const txMintEvent = (genesisStxMintTx.events as any[]).find(r => r.event_index === 0);
    assert.ok(txMintEvent !== undefined);
    assert.equal(txMintEvent.event_type, 'stx_asset');
    assert.equal(txMintEvent.tx_id, genesisStxMintTx.tx_id);
    assert.equal(txMintEvent.asset.asset_event_type, 'mint');
    assert.equal(txMintEvent.asset.sender, '');
    assert.ok(/^S/.test(String(txMintEvent.asset.recipient)));
    assert.ok(/^[1-9]\d*$/.test(String(txMintEvent.asset.amount)));

    const mintTxEventsRes = await supertest(ctx.api.server)
      .get(`/extended/v1/tx/events`)
      .query({ tx_id: genesisStxMintTx.tx_id, limit: 50 })
      .expect(200);
    const mintTxEvents = mintTxEventsRes.body.events as any[];
    const firstMintEvent = mintTxEvents.filter(r => r.event_index === 0)[0];
    assert.ok(firstMintEvent !== undefined);
    assert.equal(firstMintEvent.event_type, 'stx_asset');
    assert.equal(firstMintEvent.tx_id, genesisStxMintTx.tx_id);
    assert.equal(firstMintEvent.asset.asset_event_type, 'mint');
    assert.equal(firstMintEvent.asset.sender, '');
    assert.ok(/^S/.test(String(firstMintEvent.asset.recipient)));
    assert.ok(/^[1-9]\d*$/.test(String(firstMintEvent.asset.amount)));

    // Compare balance endpoints for receiver address
    const address = firstMintEvent.asset.recipient;
    let result = await supertest(ctx.api.server).get(`/extended/v1/address/${address}/stx`);
    assert.equal(result.status, 200);
    assert.equal(result.type, 'application/json');
    const v1balance = JSON.parse(result.text).balance;
    result = await supertest(ctx.api.server).get(`/extended/v2/addresses/${address}/balances/stx`);
    assert.equal(result.status, 200);
    assert.equal(result.type, 'application/json');
    assert.equal(JSON.parse(result.text).balance, v1balance);
  });
});
