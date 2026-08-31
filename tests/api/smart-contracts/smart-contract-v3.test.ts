import { describe, test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';

const CONTRACT_ID = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
const SOURCE_CODE = '(define-public (hello) (ok u1))';

describe('v3 smart contract', () => {
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

  async function get(contractId: string, query = '') {
    return await api.fastifyApp.inject({
      method: 'GET',
      url: `/extended/v3/smart-contracts/${contractId}${query}`,
    });
  }

  /** Deploys a contract in its own block. */
  async function deploy(args: {
    blockHeight: number;
    txId: string;
    contractId?: string;
    status?: DbTxStatus;
    clarityVersion?: number;
    typeId?: DbTxTypeId;
  }) {
    await db.update(
      new TestBlockBuilder({
        block_height: args.blockHeight,
        index_block_hash: hex(args.blockHeight),
        parent_index_block_hash: hex(args.blockHeight - 1),
      })
        .addTx({
          tx_id: args.txId,
          type_id: args.typeId ?? DbTxTypeId.VersionedSmartContract,
          status: args.status ?? DbTxStatus.Success,
          smart_contract_contract_id: args.contractId ?? CONTRACT_ID,
          smart_contract_source_code: SOURCE_CODE,
          smart_contract_clarity_version: args.clarityVersion ?? 3,
        })
        .build()
    );
  }

  test('returns a deployed contract with its deployment transaction', async () => {
    await deploy({ blockHeight: 1, txId: hex(0x11) });

    const res = await get(CONTRACT_ID);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);

    assert.equal(body.contract_id, CONTRACT_ID);
    assert.equal(body.clarity_version, 3);
    assert.equal(body.tx_id, hex(0x11));
    assert.equal(body.block.height, 1);
    assert.equal(typeof body.block.hash, 'string');
    assert.equal(typeof body.block.index_hash, 'string');
    assert.equal(typeof body.block.time, 'number');
    assert.equal(body.block.tx_index, 0);
    assert.equal(typeof body.bitcoin_block.height, 'number');
    assert.equal(typeof body.bitcoin_block.time, 'number');
  });

  test('omits source code unless requested', async () => {
    await deploy({ blockHeight: 1, txId: hex(0x11) });

    const lean = JSON.parse((await get(CONTRACT_ID)).body);
    assert.equal(lean.source_code, undefined);

    const included = JSON.parse((await get(CONTRACT_ID, '?include=source_code')).body);
    assert.equal(included.source_code, SOURCE_CODE);
  });

  test('rejects an unknown include field', async () => {
    await deploy({ blockHeight: 1, txId: hex(0x11) });

    const res = await get(CONTRACT_ID, '?include=abi');
    assert.equal(res.statusCode, 400);
  });

  test('404s for a contract that was never deployed', async () => {
    await deploy({ blockHeight: 1, txId: hex(0x11) });

    const res = await get('ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.nonexistent');
    assert.equal(res.statusCode, 404);
  });

  test('404s when the deploy transaction failed', async () => {
    await deploy({ blockHeight: 1, txId: hex(0x11), status: DbTxStatus.AbortByResponse });

    const res = await get(CONTRACT_ID);
    assert.equal(res.statusCode, 404);
  });

  test('ignores a failed deploy and returns the successful one', async () => {
    await deploy({ blockHeight: 1, txId: hex(0x11), status: DbTxStatus.AbortByResponse });
    await deploy({ blockHeight: 2, txId: hex(0x22), status: DbTxStatus.Success });

    const res = await get(CONTRACT_ID);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.tx_id, hex(0x22));
    assert.equal(body.block.height, 2);
  });

  test('returns a null clarity version for an unversioned deploy', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
      })
        .addTx({
          tx_id: hex(0x11),
          type_id: DbTxTypeId.SmartContract,
          status: DbTxStatus.Success,
          smart_contract_contract_id: CONTRACT_ID,
          smart_contract_source_code: SOURCE_CODE,
        })
        .build()
    );

    const res = await get(CONTRACT_ID);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).clarity_version, null);
  });

  test('404s once the deploy block is reorged out', async () => {
    await deploy({ blockHeight: 1, txId: hex(0x11) });
    assert.equal((await get(CONTRACT_ID)).statusCode, 200);

    // Re-org: a competing chain replaces block 1, orphaning the deploy.
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: hex(0xaa),
        index_block_hash: hex(0xbb),
        parent_index_block_hash: hex(0),
      })
        .addTx({ tx_id: hex(0x99) })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: hex(0xcc),
        index_block_hash: hex(0xdd),
        parent_index_block_hash: hex(0xbb),
      })
        .addTx({ tx_id: hex(0x98) })
        .build()
    );

    assert.equal((await get(CONTRACT_ID)).statusCode, 404);
  });
});
