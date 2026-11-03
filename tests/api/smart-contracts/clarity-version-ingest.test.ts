import { describe, test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { EventStreamServer, startEventServer } from '../../../src/event-stream/event-server.ts';
import { httpPostRequest } from '../../../src/helpers.ts';
import { migrate } from '../../test-helpers.ts';

/**
 * An unversioned `SmartContract` deploy (payload type id 1), which carries no Clarity version on
 * the wire. Deploys `hello-world` from ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.
 */
const UNVERSIONED_DEPLOY_RAW_TX =
  '0x808000000004006d78de7b0625dfbfc16c3a8a5735f6dc3dc3f2ce000000000000000000000000000000c8' +
  '0000c4e4b5ccb0001d3dba300fea573316f2bd4f4bc0e23507dc539a7e7591142b66161bb4aa3a96d6d33ab5445' +
  'd4a2717a5adac36009d855c41087452aa9d1f03b0030200000000010b68656c6c6f2d776f726c640000001f2864' +
  '6566696e652d7075626c6963202868656c6c6f2920286f6b2075312929';
const TX_ID = '0x93f5d67bbff343245d539033a9bbee22001d4f406f8c80ee5a6a4e0115b409c8';
const CONTRACT_ID = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.hello-world';
const UNVERSIONED_DEPLOY = {
  txId: TX_ID,
  rawTx: UNVERSIONED_DEPLOY_RAW_TX,
  contractId: CONTRACT_ID,
};

/**
 * A `VersionedSmartContract` deploy (payload type id 6) declaring Clarity 7, from the
 * `@stacks/codec` test vectors. Deploys `counter` from ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND. Its
 * signature does not verify, which ingestion does not check.
 */
const CLARITY_7_DEPLOY = {
  txId: '0x00e3af90b60567e7b8c79f6d9042e000031fcf84b6c96c96f6a6ecbac0b71740',
  rawTx:
    '0x8080000000040005572d04565d56f67e84ad7e20deedd8e7bba2fd00000000000000000000000000000bb8' +
    '00010c3287ab0587cf952022e079d261baeacc533d8c92b754136271450eb121ba4c0849f3c47f5a6f967dd1088e' +
    '8242a9f9ed0454bfadaa19c71d25c8812e47160a030200000000060707636f756e7465720000004e28646566696e' +
    '652d646174612d76617220636f756e742075696e74207530290a28646566696e652d726561642d6f6e6c79202867' +
    '65742d636f756e742920287661722d67657420636f756e742929',
  contractId: 'ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND.counter',
};

type Deploy = typeof UNVERSIONED_DEPLOY;

/** A contract interface as the node sends it for a deploy it just executed. */
function contractInterface(clarityVersion: string | null) {
  return {
    functions: [],
    variables: [],
    maps: [],
    fungible_tokens: [],
    non_fungible_tokens: [],
    ...(clarityVersion ? { epoch: 'Epoch21', clarity_version: clarityVersion } : {}),
  };
}

function newBlockPayload(contract_interface: object | null, deploy: Deploy) {
  return {
    block_height: 1,
    block_hash: '0x9947cef1f6758fd2074aa62189f4daa4dcdae1a46410ef9cb4dd0224aa10814f',
    index_block_hash: '0x7d0cf996be2f9f18a2c791de4b374ec90ad6fb26405d0d27f0e5c368be74b575',
    parent_block_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    parent_index_block_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    parent_microblock: '0x0000000000000000000000000000000000000000000000000000000000000000',
    parent_microblock_sequence: 0,
    burn_block_hash: '0x3f96d68c6f023d9f209956b372bfbd56e1790fab59597b954a1d70e864fd39c1',
    burn_block_height: 713000,
    burn_block_time: 1729517584,
    block_time: 1729517589,
    parent_burn_block_hash: '0x3f96d68c6f023d9f209956b372bfbd56e1790fab59597b954a1d70e864fd39c1',
    parent_burn_block_height: 712999,
    parent_burn_block_timestamp: 1729517584,
    miner_txid: '0x50aee39a8f19ddda51765338b54f631b0845907d44402c925d6cc1c12143ed7c',
    events: [],
    matured_miner_rewards: [],
    reward_set: null,
    cycle_number: null,
    signer_bitvec: null,
    anchored_cost: {
      runtime: 0,
      read_count: 0,
      read_length: 0,
      write_count: 0,
      write_length: 0,
    },
    confirmed_microblocks_cost: {
      runtime: 0,
      read_count: 0,
      read_length: 0,
      write_count: 0,
      write_length: 0,
    },
    transactions: [
      {
        txid: deploy.txId,
        raw_tx: deploy.rawTx,
        status: 'success',
        tx_index: 0,
        raw_result: '0x0703',
        burnchain_op: null,
        contract_interface,
        contract_abi: null,
        execution_cost: {
          runtime: 0,
          read_count: 0,
          read_length: 0,
          write_count: 0,
          write_length: 0,
        },
        microblock_hash: null,
        microblock_sequence: null,
        microblock_parent_hash: null,
      },
    ],
  };
}

describe('clarity version ingestion', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let eventServer: EventStreamServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    eventServer = await startEventServer({
      datastore: db,
      chainId: STACKS_TESTNET.chainId,
      serverHost: '127.0.0.1',
      serverPort: 0,
    });
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  async function ingest(contract_interface: object | null, deploy: Deploy = UNVERSIONED_DEPLOY) {
    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(newBlockPayload(contract_interface, deploy)), 'utf8'),
      throwOnNotOK: true,
    });
  }

  async function storedVersions(deploy: Deploy = UNVERSIONED_DEPLOY) {
    const [contract] = await db.sql<{ clarity_version: number | null }[]>`
      SELECT clarity_version FROM smart_contracts WHERE contract_id = ${deploy.contractId}
    `;
    const [tx] = await db.sql<{ smart_contract_clarity_version: number | null }[]>`
      SELECT smart_contract_clarity_version FROM txs WHERE tx_id = ${deploy.txId}
    `;
    return {
      smartContract: contract?.clarity_version ?? null,
      tx: tx?.smart_contract_clarity_version ?? null,
    };
  }

  async function endpointVersion(deploy: Deploy = UNVERSIONED_DEPLOY) {
    const res = await api.fastifyApp.inject({
      method: 'GET',
      url: `/extended/v3/smart-contracts/${deploy.contractId}`,
    });
    assert.equal(res.statusCode, 200);
    return JSON.parse(res.body).clarity_version;
  }

  test('records the version the node resolved for an unversioned deploy', async () => {
    await ingest(contractInterface('Clarity2'));

    // Both stored copies, since `txs` is what the endpoint reads and `smart_contracts` is where
    // the ABI lives.
    assert.deepEqual(await storedVersions(), { smartContract: 2, tx: 2 });
    assert.equal(await endpointVersion(), 2);
  });

  test('records the declared version of a Clarity 7 versioned deploy', async () => {
    // The payload's own version wins over the ABI's; decoding it needs @stacks/codec >= 2.2.0, and a
    // decode failure in `/new_block` would halt ingestion.
    await ingest(contractInterface('Clarity7'), CLARITY_7_DEPLOY);

    assert.deepEqual(await storedVersions(CLARITY_7_DEPLOY), { smartContract: 7, tx: 7 });
    assert.equal(await endpointVersion(CLARITY_7_DEPLOY), 7);
  });

  test('stays null when the node reports no version', async () => {
    // A contract interface from a node predating the `clarity_version` field.
    await ingest(contractInterface(null));

    assert.deepEqual(await storedVersions(), { smartContract: null, tx: null });
    assert.equal(await endpointVersion(), null);
  });

  test('stays null when there is no contract interface at all', async () => {
    await ingest(null);

    assert.deepEqual(await storedVersions(), { smartContract: null, tx: null });
  });
});
