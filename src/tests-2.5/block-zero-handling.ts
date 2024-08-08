/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as supertest from 'supertest';
import { BlockQueryResult } from '../datastore/common';
import { parseBlockQueryResult } from '../datastore/helpers';
import { standByUntilBlock, testEnv } from '../test-utils/test-helpers';
import {
  CoinbaseTransaction,
  SmartContractTransaction,
  Transaction,
} from '../api/schemas/entities/transactions';
import { Block } from '../api/schemas/entities/block';

describe('Block-zero event handling', () => {
  const testnetBootAddr = 'ST000000000000000000002AMW42H';
  const genesisBlockTxCount = 8;
  const bootContractNames = ['pox', 'lockup', 'costs', 'cost-voting', 'bns', 'genesis'];

  let blockOne: Block;
  let blockOneTxs: Transaction[] = [];

  test('Wait for block-one', async () => {
    await standByUntilBlock(1);
  });

  test('Ensure block-zero was emitted', async () => {
    // The block-zero event will leave a non-canonical block row at height 0
    const result = await testEnv.db.sql<
      BlockQueryResult[]
    >`SELECT * FROM blocks WHERE block_height = 0`;
    expect(result.count).toBe(1);
    const blockZero = parseBlockQueryResult(result[0]);
    expect(blockZero.canonical).toBe(false);
    expect(blockZero.block_hash).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    );
  });

  test('Block-one has boot block txs', async () => {
    const response = await supertest(testEnv.api.server)
      .get(`/extended/v1/block/by_height/1`)
      .expect(200);
    blockOne = response.body;
    expect(blockOne.txs).toHaveLength(genesisBlockTxCount);
  });

  test('Get block-one txs', async () => {
    for (const txId of blockOne.txs) {
      const txRes = await supertest(testEnv.api.server).get(`/extended/v1/tx/${txId}`).expect(200);
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
      expect(tx).toEqual(expect.objectContaining(blockOneProps));
    }
  });

  test('Block-one txs have contiguous tx indexes', () => {
    // Ensure tx_index values were update correctly after the "block-zero" txs were merged into "block-one"
    for (let i = 0; i < genesisBlockTxCount; i++) {
      expect(blockOneTxs[i].tx_index).toBe(i);
    }
  });

  test('Block-one coinbase tx', () => {
    const firstTx = blockOneTxs[0] as CoinbaseTransaction;
    expect(firstTx.tx_type).toBe('coinbase');
    // sender should be not be the boot address (it should be a miner's address)
    expect(firstTx.sender_address).not.toBe(testnetBootAddr);
  });

  test('Block-one boot txs have boot sender address', () => {
    // All txs other than the coinbase should have the special boot address
    const senderTx: Partial<Transaction> = { sender_address: testnetBootAddr };
    for (const tx of blockOneTxs.slice(1)) {
      expect(tx).toEqual(expect.objectContaining(senderTx));
    }
  });

  test('Boot contracts', () => {
    // Ensure the several boot contracts exist
    const receivedContracts = blockOneTxs.filter(
      (tx): tx is SmartContractTransaction => tx.tx_type === 'smart_contract'
    );

    const bootContractIDs = bootContractNames.map(name => `${testnetBootAddr}.${name}`);
    const receivedContractIDs = receivedContracts.map(tx => tx.smart_contract.contract_id);
    expect(receivedContractIDs).toEqual(bootContractIDs);

    const bootContractTxs = bootContractNames.map(
      name =>
        expect.objectContaining<Partial<SmartContractTransaction>>({
          tx_type: 'smart_contract',
          smart_contract: expect.objectContaining<
            Partial<SmartContractTransaction['smart_contract']>
          >({ contract_id: `${testnetBootAddr}.${name}` }),
        }) as Partial<SmartContractTransaction>
    );

    expect(receivedContracts).toEqual(bootContractTxs);
  });

  test('Genesis contract-log print event', async () => {
    // One of the boot txs is a contract-deploy tx that prints the special genesis message
    const genesisContractID = `${testnetBootAddr}.genesis`;
    const genesisContractTx = blockOneTxs.filter(
      tx => tx.tx_type === 'smart_contract' && tx.smart_contract.contract_id === genesisContractID
    )[0] as SmartContractTransaction;
    expect(genesisContractTx).toBeDefined();

    const genesisLogEvent = [
      {
        event_index: 0,
        event_type: 'smart_contract_log',
        tx_id: genesisContractTx.tx_id,
        contract_log: expect.objectContaining({
          contract_id: genesisContractID,
          topic: 'print',
          value: expect.objectContaining({
            hex: expect.stringContaining('0x'),
            repr: expect.stringContaining('share CPU power with Bitcoin'),
          }),
        }),
      },
    ];

    expect(genesisContractTx.event_count).toBe(1);
    expect(genesisContractTx.events).toEqual(genesisLogEvent);

    const contractEventsRes = await supertest(testEnv.api.server)
      .get(`/extended/v1/contract/${genesisContractID}/events`)
      .expect(200);
    const contractEvents = contractEventsRes.body;
    expect(contractEvents.results).toEqual(genesisLogEvent);
  });

  test('Genesis STX mint events', async () => {
    // One of the boot txs is a special "token_transfer" type that includes `stx_asset` mint events for seeding boot accounts
    const genesisStxMintTx = blockOneTxs.filter(tx => tx.tx_type === 'token_transfer')[0];
    expect(genesisStxMintTx).toBeDefined();

    const stxMintEvent = {
      event_index: 0,
      event_type: 'stx_asset',
      tx_id: genesisStxMintTx.tx_id,
      asset: expect.objectContaining({
        asset_event_type: 'mint',
        sender: '',
        recipient: expect.stringMatching(/^S/), // any stacks address
        amount: expect.stringMatching(/^[1-9]\d*$/), // integer
      }),
    };

    expect(genesisStxMintTx.event_count).toBeGreaterThan(1);
    expect(genesisStxMintTx.events).toEqual(expect.arrayContaining([stxMintEvent]));

    const mintTxEventsRes = await supertest(testEnv.api.server)
      .get(`/extended/v1/tx/events`)
      .query({ tx_id: genesisStxMintTx.tx_id, limit: 50 })
      .expect(200);
    const mintTxEvents = mintTxEventsRes.body.events as any[];
    const firstMintEvent = mintTxEvents.filter(r => r.event_index === 0)[0];
    expect(firstMintEvent).toBeDefined();
    expect(firstMintEvent).toEqual(stxMintEvent);
  });
});
