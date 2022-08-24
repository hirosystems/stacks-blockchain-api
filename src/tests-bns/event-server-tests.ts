import { ChainID } from '@stacks/transactions';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { httpPostRequest } from '../helpers';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../test-utils/test-builders';

describe('BNS event server tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: EventStreamServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect({ usageName: 'tests', withNotifier: false });
    client = await db.pool.connect();
    eventServer = await startEventServer({
      datastore: db,
      chainId: ChainID.Mainnet,
      serverHost: '127.0.0.1',
      serverPort: 0,
      httpLogLevel: 'debug',
    });
  });

  test('namespace-ready called by a contract other than BNS', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x29fe7ba9674b9196fefa28764a35a4603065dc25c9dcf83c56648066f36a8dce',
      burn_block_height: 749661,
      burn_block_hash: '0x000000000000000000021e9777470811a937006cf47efceadefca2e8031c4b5f',
      burn_block_time: 1660638853,
    })
      .addTx()
      .build();
    await db.update(block);
    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x8455c986ef89d09968b96fee0ef5b4625aa3860aa68e70123efa129f48e55c6b',
        microblock_sequence: 0,
        parent_index_block_hash: '0x29fe7ba9674b9196fefa28764a35a4603065dc25c9dcf83c56648066f36a8dce'
      })
      .build();
    await db.updateMicroblocks(microblock);
    const payload = {
      "events": [
        {
          "txid": "0x605aa0554fb5ee7995f9780aa54d63b3d32550b0def95e31bdf3beb0fedefdae",
          "type": "contract_event",
          "committed": true,
          "event_index": 50,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c00000003096e616d65737061636502000000046672656e0a70726f706572746965730c000000061963616e2d7570646174652d70726963652d66756e6374696f6e030b6c61756e636865642d61740a0100000000000000000000000000011886086c69666574696d65010000000000000000000000000000cd50106e616d6573706163652d696d706f727406161809f2ab9182b6ff1678f82846131c0709e51cf914636f6d6d756e6974792d68616e646c65732d76320e70726963652d66756e6374696f6e0c000000050462617365010000000c9f2c9cd04674edea3fffffff076275636b6574730b00000010010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000105636f6566660100000000000000000000000000000001116e6f2d766f77656c2d646973636f756e740100000000000000000000000000000001116e6f6e616c7068612d646973636f756e7401000000000000000000000000000000010b72657665616c65642d61740100000000000000000000000000011886067374617475730d000000057265616479",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        }
      ],
      "block_hash": "0x6be6bfbf5e63ee4333c794b0489a791625ad0724722647b748379fe916bbff55",
      "miner_txid": "0x1c01668438115f757cfc14210f7f7ba0bee7f9d235c44b8e35c8653ac5879205",
      "block_height": 2,
      "transactions": [
        {
          "txid": "0x605aa0554fb5ee7995f9780aa54d63b3d32550b0def95e31bdf3beb0fedefdae",
          "raw_tx": "0x000000000104001809f2ab9182b6ff1678f82846131c0709e51cf900000000000000110000000000000bb80001e2ae2533ed444dcc3dc0118da5c8bbfe5da4c1943b63e3fd9b7389e3f7f384ee417a65d899182ff7791b174a426b947860df5b4006a0cb767aca275af847428d03020000000002161809f2ab9182b6ff1678f82846131c0709e51cf914636f6d6d756e6974792d68616e646c65732d7632106e616d6573706163652d72657665616c0000000402000000046672656e0200000003626f74010000000000000000000000000000cd5009",
          "status": "success",
          "tx_index": 46,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 201050,
            "read_count": 20,
            "read_length": 92368,
            "write_count": 4,
            "write_length": 1386
          },
          "microblock_hash": "0x8455c986ef89d09968b96fee0ef5b4625aa3860aa68e70123efa129f48e55c6b",
          "microblock_sequence": 0,
          "microblock_parent_hash": "0xea7982ba6a5206b9efc2ab2567eedef3babae4d167619bdc74c7e148717dc208"
        }
      ],
      "anchored_cost": {
        "runtime": 19669668,
        "read_count": 1420,
        "read_length": 8457322,
        "write_count": 143,
        "write_length": 9331
      },
      "burn_block_hash": "0x00000000000000000004afca18622e18a1f36ff19dc1aece341868c042b7f4ac",
      "burn_block_time": 1660639379,
      "index_block_hash": "0xd3944c1cf261982ad5d86ad14b1545a2393c0039e378706323927b3a7031a621",
      "burn_block_height": 749662,
      "parent_block_hash": "0xea7982ba6a5206b9efc2ab2567eedef3babae4d167619bdc74c7e148717dc208",
      "parent_microblock": "0x8455c986ef89d09968b96fee0ef5b4625aa3860aa68e70123efa129f48e55c6b",
      "matured_miner_rewards": [],
      "parent_burn_block_hash": "0x000000000000000000021e9777470811a937006cf47efceadefca2e8031c4b5f",
      "parent_index_block_hash": "0x29fe7ba9674b9196fefa28764a35a4603065dc25c9dcf83c56648066f36a8dce",
      "parent_burn_block_height": 749661,
      "confirmed_microblocks_cost": {
        "runtime": 174668984,
        "read_count": 12067,
        "read_length": 54026355,
        "write_count": 1701,
        "write_length": 134399
      },
      "parent_microblock_sequence": 0,
      "parent_burn_block_timestamp": 1660638853
    };

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    const namespaces = await db.getNamespaceList({ includeUnanchored: true });
    expect(namespaces.results).toStrictEqual(['fren']);

    const namespace = await db.getNamespace({ namespace: 'fren', includeUnanchored: true });
    expect(namespace.found).toBe(true);
    expect(namespace.result?.namespace_id).toBe('fren');
    expect(namespace.result?.lifetime).toBe(52560);
    expect(namespace.result?.status).toBe('ready');
    expect(namespace.result?.ready_block).toBe(2);
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
