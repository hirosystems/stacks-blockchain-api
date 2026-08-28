import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbAssetEventTypeId, DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';

// The STX transfer endpoint tests live in their own file (split out of `principals.test.ts`) so
// the per-process heap accumulated by the per-test migrate/connect/serve cycles stays within
// V8's default limit -- the node test runner gives each file its own process.
describe('principal stx transfers', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
  const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
  const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
  const emptyPrincipal = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP2X';

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    // Chain scaffolding: the transfer fixtures in each describe attach their blocks to height 2.
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: hex(1),
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
        parent_block_hash: hex(0),
      })
        .addTx({ tx_id: hex(0x9001), tx_index: 0, status: DbTxStatus.Success })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: hex(2),
        index_block_hash: hex(2),
        parent_index_block_hash: hex(1),
        parent_block_hash: hex(1),
      }).build()
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  describe('/v3/principals/:principal/transfers/stx/inbound', () => {
    const inboundAddr = 'ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND';
    // Matches the `TESTNET_SEND_MANY_CONTRACT_ID` default.
    const sendManyContract = 'ST3F1X4QGV2SM8XD96X45M6RTQXKA1PZJZZCQAB4B.send-many-memo';

    beforeEach(async () => {
      const block3 = new TestBlockBuilder({
        block_height: 3,
        block_hash: hex(3),
        index_block_hash: hex(3),
        parent_index_block_hash: hex(2),
        parent_block_hash: hex(2),
      })
        // tx_index 1: native stx-transfer with memo.
        .addTx({
          tx_id: hex(0x3101),
          block_hash: hex(3),
          index_block_hash: hex(3),
          type_id: DbTxTypeId.TokenTransfer,
          status: DbTxStatus.Success,
          sender_address: testAddr1,
          token_transfer_recipient_address: inboundAddr,
          token_transfer_amount: 1000n,
          token_transfer_memo: '0x686921',
        })
        .addTxStxEvent({ amount: 1000n, sender: testAddr1, recipient: inboundAddr })
        // tx_index 2: send-many bulk send with two legs to `inboundAddr` and one leg to another
        // recipient. Each STX transfer event is followed by its memo print event.
        .addTx({
          tx_id: hex(0x3102),
          block_hash: hex(3),
          index_block_hash: hex(3),
          type_id: DbTxTypeId.ContractCall,
          status: DbTxStatus.Success,
          sender_address: testAddr2,
          contract_call_contract_id: sendManyContract,
          contract_call_function_name: 'send-many',
        })
        .addTxStxEvent({ amount: 200n, sender: testAddr2, recipient: inboundAddr })
        .addTxContractLogEvent({
          contract_identifier: sendManyContract,
          value: '0x020000000568656c6c6f',
        })
        .addTxStxEvent({ amount: 300n, sender: testAddr2, recipient: testAddr4 })
        .addTxContractLogEvent({
          contract_identifier: sendManyContract,
          value: '0x02000000026162',
        })
        .addTxStxEvent({ amount: 400n, sender: testAddr2, recipient: inboundAddr })
        .addTxContractLogEvent({
          contract_identifier: sendManyContract,
          value: '0x0200000002796f',
        })
        // tx_index 3: contract STX events -- a transfer without a memo, a transfer with one,
        // and a mint (no sender).
        .addTx({
          tx_id: hex(0x3103),
          block_hash: hex(3),
          index_block_hash: hex(3),
          type_id: DbTxTypeId.ContractCall,
          status: DbTxStatus.Success,
          sender_address: testAddr4,
          contract_call_contract_id: testContractAddr,
          contract_call_function_name: 'transfer',
        })
        .addTxStxEvent({ amount: 500n, sender: testAddr4, recipient: inboundAddr })
        .addTxStxEvent({
          amount: 600n,
          sender: testAddr4,
          recipient: inboundAddr,
          memo: '0x6d656d6f',
        })
        .addTxStxEvent({
          amount: 750n,
          asset_event_type_id: DbAssetEventTypeId.Mint,
          recipient: inboundAddr,
        })
        .build();
      await db.update(block3);
    });

    test('returns individual inbound transfers newest first with per-leg memos', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 6);
      assert.deepEqual(
        body.results.map((r: { amount: string }) => r.amount),
        ['750', '600', '500', '400', '200', '1000']
      );
      // Each row carries its own decoded memo: the event memo, null when absent, the unwrapped
      // send-many print buffer for bulk-send legs, and the tx memo for native transfers.
      assert.deepEqual(
        body.results.map((r: { memo: unknown }) => r.memo),
        [
          null,
          { hex: '0x6d656d6f', repr: 'memo' },
          null,
          { hex: '0x796f', repr: 'yo' },
          { hex: '0x68656c6c6f', repr: 'hello' },
          { hex: '0x686921', repr: 'hi!' },
        ]
      );
      // Mints are inbound and carry a null sender.
      assert.deepEqual(
        body.results.map((r: { sender: string | null }) => r.sender),
        [null, testAddr4, testAddr4, testAddr2, testAddr2, testAddr1]
      );
      // Every inbound row's recipient is the principal itself.
      assert.deepEqual(
        body.results.map((r: { recipient: string }) => r.recipient),
        Array(6).fill(inboundAddr)
      );
      // One row per event: the send-many tx contributes two separate rows. The tx position is
      // reported as a `transaction` sub-object.
      assert.deepEqual(
        body.results.map((r: { transaction: { tx_id: string; event_index: number } }) => [
          r.transaction.tx_id,
          r.transaction.event_index,
        ]),
        [
          [hex(0x3103), 2],
          [hex(0x3103), 1],
          [hex(0x3103), 0],
          [hex(0x3102), 4],
          [hex(0x3102), 0],
          [hex(0x3101), 0],
        ]
      );
      // Chain position is reported as a `block` sub-object.
      assert.deepEqual(
        body.results.map((r: { block: { height: number; tx_index: number } }) => [
          r.block.height,
          r.block.tx_index,
        ]),
        [
          [3, 2],
          [3, 2],
          [3, 2],
          [3, 1],
          [3, 1],
          [3, 0],
        ]
      );
      assert.equal(body.results[0].block.hash, hex(3));
      assert.equal(body.results[0].block.index_hash, hex(3));
      assert.equal(typeof body.results[0].block.time, 'number');
    });

    test('returns an empty list for a principal with no inbound transfers', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transfers/stx/inbound`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 0);
      assert.deepEqual(body.results, []);
      assert.deepEqual(body.cursor, { next: null, previous: null, current: null });
    });

    test('cursor paginates transfers by event position', async () => {
      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { limit: '2' },
      });
      assert.equal(page1.statusCode, 200);
      const body1 = JSON.parse(page1.body);
      assert.equal(body1.total, 6);
      assert.deepEqual(
        body1.results.map((r: { amount: string }) => r.amount),
        ['750', '600']
      );
      assert.equal(body1.cursor.previous, null);
      assert.notEqual(body1.cursor.next, null);

      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { limit: '2', cursor: body1.cursor.next },
      });
      assert.equal(page2.statusCode, 200);
      const body2 = JSON.parse(page2.body);
      assert.deepEqual(
        body2.results.map((r: { amount: string }) => r.amount),
        ['500', '400']
      );
      assert.notEqual(body2.cursor.previous, null);
      assert.notEqual(body2.cursor.next, null);

      const page3 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { limit: '2', cursor: body2.cursor.next },
      });
      assert.equal(page3.statusCode, 200);
      const body3 = JSON.parse(page3.body);
      assert.deepEqual(
        body3.results.map((r: { amount: string }) => r.amount),
        ['200', '1000']
      );
      assert.equal(body3.cursor.next, null);

      // Following the previous cursor from page 2 returns page 1's contents.
      const backToPage1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { limit: '2', cursor: body2.cursor.previous },
      });
      assert.equal(backToPage1.statusCode, 200);
      assert.deepEqual(
        JSON.parse(backToPage1.body).results.map((r: { amount: string }) => r.amount),
        ['750', '600']
      );
    });

    test('preserves an exact all-zero cursor position', async () => {
      // The oldest transfer sits exactly at (3, 0, 0, 0), so the cursor must be preserved rather
      // than treated as a block boundary -- same convention as transaction cursors.
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { cursor: '3:0:0:0' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].amount, '1000');
    });

    test('resolves a block-boundary cursor to the top of the block', async () => {
      // Block 4's only transfer to the principal is NOT at position zero (a coinbase occupies
      // tx_index 0), so cursor 4:0:0:0 is a block boundary and must resolve to the top of
      // block 4, including its transfer.
      await db.update(
        new TestBlockBuilder({
          block_height: 4,
          block_hash: hex(4),
          index_block_hash: hex(4),
          parent_index_block_hash: hex(3),
          parent_block_hash: hex(3),
        })
          .addTx({
            tx_id: hex(0x3104),
            block_hash: hex(4),
            index_block_hash: hex(4),
            status: DbTxStatus.Success,
            sender_address: testAddr1,
          })
          .addTx({
            tx_id: hex(0x3105),
            block_hash: hex(4),
            index_block_hash: hex(4),
            type_id: DbTxTypeId.TokenTransfer,
            status: DbTxStatus.Success,
            sender_address: testAddr1,
            token_transfer_recipient_address: inboundAddr,
            token_transfer_amount: 700n,
          })
          .addTxStxEvent({ amount: 700n, sender: testAddr1, recipient: inboundAddr })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { cursor: '4:0:0:0' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.results.length, 7);
      assert.equal(body.results[0].amount, '700');
    });

    test('rejects a malformed cursor', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { cursor: 'not-a-cursor' },
      });
      assert.equal(response.statusCode, 400);
    });

    test('rejects a cursor with out-of-range components', async () => {
      // Components beyond their column ranges must 400 instead of failing in postgres as a 500.
      for (const cursor of ['9999999999:0:0:0', '3:0:99999:0', '3:9999999999:0:9999999999']) {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
          query: { cursor },
        });
        assert.equal(response.statusCode, 400, `cursor: ${cursor}`);
      }
    });

    test('reports the endpoint-wide total for a cursor past the oldest event', async () => {
      // A cursor older than the principal's oldest event yields an empty page, but `total` must
      // still reflect the full result set.
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
        query: { cursor: '1:0:0:0' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.deepEqual(body.results, []);
      assert.equal(body.total, 6);
      assert.equal(body.cursor.next, null);
    });

    test('keeps totals accurate across a re-org', async () => {
      // Fork block at height 3: ingested as non-canonical (the original block 3 is the tip), with
      // one transfer to the principal.
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(0x3b01),
          index_block_hash: hex(0x3b01),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({
            tx_id: hex(0x3301),
            block_hash: hex(0x3b01),
            index_block_hash: hex(0x3b01),
            type_id: DbTxTypeId.TokenTransfer,
            status: DbTxStatus.Success,
            sender_address: testAddr1,
            token_transfer_recipient_address: inboundAddr,
            token_transfer_amount: 42n,
          })
          .addTxStxEvent({ amount: 42n, sender: testAddr1, recipient: inboundAddr })
          .build()
      );

      // The original chain is still canonical: totals unchanged.
      let response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(JSON.parse(response.body).total, 6);

      // Extend the fork to make it canonical, orphaning the original block 3 and its 6 inbound
      // events; the fork's single event (ingested non-canonical, so never counted) is restored.
      await db.update(
        new TestBlockBuilder({
          block_height: 4,
          block_hash: hex(0x3b02),
          index_block_hash: hex(0x3b02),
          parent_index_block_hash: hex(0x3b01),
          parent_block_hash: hex(0x3b01),
        }).build()
      );

      response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${inboundAddr}/transfers/stx/inbound`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 1);
      assert.deepEqual(
        body.results.map((r: { amount: string }) => r.amount),
        ['42']
      );
    });
  });

  describe('/v3/principals/:principal/transfers/stx/outbound', () => {
    const outboundAddr = 'ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87NE';
    const selfAddr = 'ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87NF';
    // Matches the `TESTNET_SEND_MANY_CONTRACT_ID` default.
    const sendManyContract = 'ST3F1X4QGV2SM8XD96X45M6RTQXKA1PZJZZCQAB4B.send-many-memo';

    beforeEach(async () => {
      const block3 = new TestBlockBuilder({
        block_height: 3,
        block_hash: hex(3),
        index_block_hash: hex(3),
        parent_index_block_hash: hex(2),
        parent_block_hash: hex(2),
      })
        // tx_index 0: native stx-transfer with memo.
        .addTx({
          tx_id: hex(0x3201),
          block_hash: hex(3),
          index_block_hash: hex(3),
          type_id: DbTxTypeId.TokenTransfer,
          status: DbTxStatus.Success,
          sender_address: outboundAddr,
          token_transfer_recipient_address: testAddr1,
          token_transfer_amount: 1000n,
          token_transfer_memo: '0x686921',
        })
        .addTxStxEvent({ amount: 1000n, sender: outboundAddr, recipient: testAddr1 })
        // tx_index 1: send-many bulk send with three legs to two different recipients. All legs
        // are outbound for the sender.
        .addTx({
          tx_id: hex(0x3202),
          block_hash: hex(3),
          index_block_hash: hex(3),
          type_id: DbTxTypeId.ContractCall,
          status: DbTxStatus.Success,
          sender_address: outboundAddr,
          contract_call_contract_id: sendManyContract,
          contract_call_function_name: 'send-many',
        })
        .addTxStxEvent({ amount: 200n, sender: outboundAddr, recipient: testAddr1 })
        .addTxContractLogEvent({
          contract_identifier: sendManyContract,
          value: '0x020000000568656c6c6f',
        })
        .addTxStxEvent({ amount: 300n, sender: outboundAddr, recipient: testAddr2 })
        .addTxContractLogEvent({
          contract_identifier: sendManyContract,
          value: '0x02000000026162',
        })
        .addTxStxEvent({ amount: 400n, sender: outboundAddr, recipient: testAddr1 })
        .addTxContractLogEvent({
          contract_identifier: sendManyContract,
          value: '0x0200000002796f',
        })
        // tx_index 2: contract STX events -- a transfer without a memo, a transfer with one,
        // and a burn (no recipient).
        .addTx({
          tx_id: hex(0x3203),
          block_hash: hex(3),
          index_block_hash: hex(3),
          type_id: DbTxTypeId.ContractCall,
          status: DbTxStatus.Success,
          sender_address: outboundAddr,
          contract_call_contract_id: testContractAddr,
          contract_call_function_name: 'transfer',
        })
        .addTxStxEvent({ amount: 500n, sender: outboundAddr, recipient: testAddr2 })
        .addTxStxEvent({
          amount: 600n,
          sender: outboundAddr,
          recipient: testAddr2,
          memo: '0x6d656d6f',
        })
        .addTxStxEvent({
          amount: 800n,
          asset_event_type_id: DbAssetEventTypeId.Burn,
          sender: outboundAddr,
        })
        .build();
      await db.update(block3);
    });

    test('returns individual outbound transfers newest first with per-leg recipients', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${outboundAddr}/transfers/stx/outbound`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      // Unlike the inbound view, every send-many leg counts for the sender.
      assert.equal(body.total, 7);
      assert.deepEqual(
        body.results.map((r: { amount: string }) => r.amount),
        ['800', '600', '500', '400', '300', '200', '1000']
      );
      assert.deepEqual(
        body.results.map((r: { memo: unknown }) => r.memo),
        [
          null,
          { hex: '0x6d656d6f', repr: 'memo' },
          null,
          { hex: '0x796f', repr: 'yo' },
          { hex: '0x6162', repr: 'ab' },
          { hex: '0x68656c6c6f', repr: 'hello' },
          { hex: '0x686921', repr: 'hi!' },
        ]
      );
      // Burns are outbound and carry a null recipient.
      assert.deepEqual(
        body.results.map((r: { recipient: string | null }) => r.recipient),
        [null, testAddr2, testAddr2, testAddr1, testAddr2, testAddr1, testAddr1]
      );
      // Every outbound row's sender is the principal itself.
      assert.deepEqual(
        body.results.map((r: { sender: string }) => r.sender),
        Array(7).fill(outboundAddr)
      );
    });

    test('cursor paginates outbound transfers', async () => {
      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${outboundAddr}/transfers/stx/outbound`,
        query: { limit: '4' },
      });
      assert.equal(page1.statusCode, 200);
      const body1 = JSON.parse(page1.body);
      assert.equal(body1.total, 7);
      assert.deepEqual(
        body1.results.map((r: { amount: string }) => r.amount),
        ['800', '600', '500', '400']
      );
      assert.equal(body1.cursor.previous, null);
      assert.notEqual(body1.cursor.next, null);

      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${outboundAddr}/transfers/stx/outbound`,
        query: { limit: '4', cursor: body1.cursor.next },
      });
      assert.equal(page2.statusCode, 200);
      const body2 = JSON.parse(page2.body);
      assert.deepEqual(
        body2.results.map((r: { amount: string }) => r.amount),
        ['300', '200', '1000']
      );
      assert.equal(body2.cursor.next, null);

      // Following the previous cursor from page 2 returns page 1's contents.
      const backToPage1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${outboundAddr}/transfers/stx/outbound`,
        query: { limit: '4', cursor: body2.cursor.previous },
      });
      assert.equal(backToPage1.statusCode, 200);
      assert.deepEqual(
        JSON.parse(backToPage1.body).results.map((r: { amount: string }) => r.amount),
        ['800', '600', '500', '400']
      );
    });

    test('a self-transfer appears in both directions', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 4,
          block_hash: hex(4),
          index_block_hash: hex(4),
          parent_index_block_hash: hex(3),
          parent_block_hash: hex(3),
        })
          .addTx({
            tx_id: hex(0x3204),
            block_hash: hex(4),
            index_block_hash: hex(4),
            type_id: DbTxTypeId.TokenTransfer,
            status: DbTxStatus.Success,
            sender_address: selfAddr,
            token_transfer_recipient_address: selfAddr,
            token_transfer_amount: 50n,
          })
          .addTxStxEvent({ amount: 50n, sender: selfAddr, recipient: selfAddr })
          .build()
      );

      for (const direction of ['inbound', 'outbound']) {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/principals/${selfAddr}/transfers/stx/${direction}`,
        });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.total, 1, `direction: ${direction}`);
        assert.equal(body.results[0].amount, '50');
        assert.equal(body.results[0].sender, selfAddr);
        assert.equal(body.results[0].recipient, selfAddr);
      }
    });

    test('excludes transfers where the principal is only the recipient', async () => {
      // `testAddr1` receives several transfers in this block but sends none.
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transfers/stx/outbound`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(
        body.results.some((r: { block: { height: number } }) => r.block.height === 3),
        false
      );
    });
  });
});
