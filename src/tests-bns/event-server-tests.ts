import { ChainID } from '@stacks/transactions';
import { bnsNameCV, httpPostRequest } from '../helpers';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../test-utils/test-builders';
import { DbAssetEventTypeId, DbBnsZoneFile } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';
import { getGenesisBlockData } from '../event-replay/helpers';
import { NextFunction } from 'express';

describe('BNS event server tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let eventServer: EventStreamServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: true });
    client = db.sql;
    eventServer = await startEventServer({
      datastore: db,
      chainId: ChainID.Mainnet,
      serverHost: '127.0.0.1',
      serverPort: 0,
      httpLogLevel: 'debug',
    });
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    await db?.close();
    await runMigrations(undefined, 'down');
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

  test('name-transfer called by a contract other than BNS', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x09458029b7c0e43e015bd3202c0f9512c2b394e0481bfd2bdd096ae7b5b862f2',
      index_block_hash: '0xad9403fc8d8eaef47816555cac51dca9d934384aa9b2581f9b9085509b2af915',
      burn_block_height: 743853,
      burn_block_hash: '0x00000000000000000008b9d65609c6b39bb89d7da35433e4b287835d7112d6d4',
      burn_block_time: 1657123396,
    })
      .addTx({
        tx_id: '0x1234',
        sender_address: 'SPP117ENNNDQVQ1G3E0N1AP178GXBTC2YNQ3H7J'
      })
      .addTxBnsNamespace({
        namespace_id: 'btc',
        lifetime: 1000
      })
      .addTxBnsName({
        name: 'dayslikewater.btc',
        namespace_id: 'btc',
        zonefile_hash: 'b472a266d0bd89c13706a4132ccfb16f7c3b9fcb',
        address: 'SPP117ENNNDQVQ1G3E0N1AP178GXBTC2YNQ3H7J'
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV('dayslikewater.btc'),
        asset_identifier: 'SP000000000000000000002Q6VF78.bns::names',
        recipient: 'SPP117ENNNDQVQ1G3E0N1AP178GXBTC2YNQ3H7J',
      })
      .build();
    await db.update(block);
    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0xccdd11fef1792979bc54a9b686e9cc4fc3d64f2a9b2d8ee9d34fe27bfab783a4',
        microblock_sequence: 0,
        parent_index_block_hash: '0xad9403fc8d8eaef47816555cac51dca9d934384aa9b2581f9b9085509b2af915'
      })
      .build();
    await db.updateMicroblocks(microblock);

    const name1 = await db.getName({
      name: 'dayslikewater.btc',
      includeUnanchored: true,
      chainId: ChainID.Mainnet
    });
    expect(name1.found).toBe(true);
    expect(name1.result?.namespace_id).toBe('btc');
    expect(name1.result?.tx_id).toBe('0x1234');
    expect(name1.result?.status).toBe('name-register');
    expect(name1.result?.expire_block).toBe(1001);
    expect(name1.result?.address).toBe('SPP117ENNNDQVQ1G3E0N1AP178GXBTC2YNQ3H7J');

    const payload = {
      "events": [
        {
          "txid": "0xa75ebee2c824c4943bf8494b101ea7ee7d44191b4a8f761582ce99ef28befb19",
          "type": "contract_event",
          "committed": true,
          "event_index": 74,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e646578010000000000000000000000000000e52b04686173680200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb086d657461646174610c00000004046e616d65020000000d646179736c696b657761746572096e616d6573706163650200000003627463026f700d0000000d6e616d652d7472616e736665720974782d73656e6465720516016084eead6adbeee180dc0a855609d10eaf4c17",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        },
        {
          "txid": "0xa75ebee2c824c4943bf8494b101ea7ee7d44191b4a8f761582ce99ef28befb19",
          "type": "nft_transfer_event",
          "committed": true,
          "event_index": 73,
          "nft_transfer_event": {
            "sender": "SPP117ENNNDQVQ1G3E0N1AP178GXBTC2YNQ3H7J",
            "raw_value": "0x0c00000002046e616d65020000000d646179736c696b657761746572096e616d6573706163650200000003627463",
            "recipient": "SP1TY00PDWJVNVEX7H7KJGS2K2YXHTQMY8C0G1NVP",
            "asset_identifier": "SP000000000000000000002Q6VF78.bns::names"
          }
        },
        {
          "txid": "0xa75ebee2c824c4943bf8494b101ea7ee7d44191b4a8f761582ce99ef28befb19",
          "type": "stx_transfer_event",
          "committed": true,
          "event_index": 71,
          "stx_transfer_event": {
            "amount": "2500",
            "sender": "SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.bns-marketplace-v3",
            "recipient": "SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C"
          }
        }
      ],
      "block_hash": "0x7d18920cc47f731f186fb9f731d2e8d5029bbab6d73fd012ac3e10637a8e4a37",
      "miner_txid": "0xbed35e9e7eb7f98583c87743d3860ab63f2506f7f1efe24740cd37f7708de0b4",
      "block_height": 2,
      "transactions": [
        {
          "txid": "0xa75ebee2c824c4943bf8494b101ea7ee7d44191b4a8f761582ce99ef28befb19",
          "raw_tx": "0x00000000010400016084eead6adbeee180dc0a855609d10eaf4c1700000000000000020000000000000bb80000e452e9d87e94a2a4364e89af3ab44b3ce1117afb6505721ff5b801294e1280f0616ee4d21a6ef9bcca1ea15ac65477e79df3427f7fd6c41c80938f8cca6d2cd0030200000002000316a6a7a70f41adbe8eae708ed7ec2cbf41a272182012626e732d6d61726b6574706c6163652d76330500000000000186a0020216016084eead6adbeee180dc0a855609d10eaf4c1716000000000000000000000000000000000000000003626e73056e616d65730c00000002046e616d65020000000d646179736c696b657761746572096e616d6573706163650200000003627463100216a6a7a70f41adbe8eae708ed7ec2cbf41a272182012626e732d6d61726b6574706c6163652d76330a6163636570742d626964000000030200000003627463020000000d646179736c696b6577617465720a0200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb",
          "status": "success",
          "tx_index": 25,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 381500,
            "read_count": 42,
            "read_length": 96314,
            "write_count": 9,
            "write_length": 359
          },
          "microblock_hash": null,
          "microblock_sequence": null,
          "microblock_parent_hash": null
        }
      ],
      "anchored_cost": {
        "runtime": 44194708,
        "read_count": 4105,
        "read_length": 11476905,
        "write_count": 546,
        "write_length": 47312
      },
      "burn_block_hash": "0x00000000000000000005e28a41cdb7461953b9424b4fd44a9211a145a1c0346d",
      "burn_block_time": 1657125225,
      "index_block_hash": "0xb70205d38a8666cbd071239b4ec28ae7d12a2c32341118d7c6d4d1e22f56014e",
      "burn_block_height": 743854,
      "parent_block_hash": "0x09458029b7c0e43e015bd3202c0f9512c2b394e0481bfd2bdd096ae7b5b862f2",
      "parent_microblock": "0xccdd11fef1792979bc54a9b686e9cc4fc3d64f2a9b2d8ee9d34fe27bfab783a4",
      "matured_miner_rewards": [],
      "parent_burn_block_hash": "0x00000000000000000008b9d65609c6b39bb89d7da35433e4b287835d7112d6d4",
      "parent_index_block_hash": "0xad9403fc8d8eaef47816555cac51dca9d934384aa9b2581f9b9085509b2af915",
      "parent_burn_block_height": 743853,
      "confirmed_microblocks_cost": {
        "runtime": 48798,
        "read_count": 10,
        "read_length": 40042,
        "write_count": 3,
        "write_length": 19
      },
      "parent_microblock_sequence": 0,
      "parent_burn_block_timestamp": 1657123396
    };

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    const name2 = await db.getName({
      name: 'dayslikewater.btc',
      includeUnanchored: true,
      chainId: ChainID.Mainnet
    });
    expect(name2.found).toBe(true);
    expect(name2.result?.namespace_id).toBe('btc');
    expect(name2.result?.tx_id).toBe('0xa75ebee2c824c4943bf8494b101ea7ee7d44191b4a8f761582ce99ef28befb19');
    expect(name2.result?.status).toBe('name-transfer');
    expect(name2.result?.expire_block).toBe(1001); // Unchanged as it was not renewed
    expect(name2.result?.address).toBe('SP1TY00PDWJVNVEX7H7KJGS2K2YXHTQMY8C0G1NVP');
  });

  test('name-renewal called with no zonefile_hash', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0xf81ef7f114213b9034a4378345a931a97c781fab398c3d7a2053f0d0bf48d311',
      index_block_hash: '0xaec282925b5096c0bd98588d25a97e134bcc4f19b6600859fa267cf0ee4eaf2d',
      burn_block_height: 726955,
      burn_block_hash: '0x00000000000000000001523f01cb4304d39527454d2eec79817b50c033a5c5d9',
      burn_block_time: 1647068146,
    })
      .addTx({
        tx_id: '0x1234',
        sender_address: 'SP3GWTV1SMF9HDS4VY5NMM833CHH266W4YBASVYMZ'
      })
      .addTxBnsNamespace({
        namespace_id: 'id',
        lifetime: 1000
      })
      .addTxBnsName({
        name: 'friedger.id',
        namespace_id: 'id',
        zonefile_hash: 'b472a266d0bd89c13706a4132ccfb16f7c3b9fcb',
        address: 'SP3GWTV1SMF9HDS4VY5NMM833CHH266W4YBASVYMZ'
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV('friedger.id'),
        asset_identifier: 'SP000000000000000000002Q6VF78.bns::names',
        recipient: 'SP3GWTV1SMF9HDS4VY5NMM833CHH266W4YBASVYMZ',
      })
      .build();
    await db.update(block);
    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x640362ec47c40de3337491993e42efe60d05187431633ab03c3f5d33e70d1f8e',
        microblock_sequence: 0,
        parent_index_block_hash: '0xaec282925b5096c0bd98588d25a97e134bcc4f19b6600859fa267cf0ee4eaf2d'
      })
      .build();
    await db.updateMicroblocks(microblock);

    const name1 = await db.getName({
      name: 'friedger.id',
      includeUnanchored: true,
      chainId: ChainID.Mainnet
    });
    expect(name1.found).toBe(true);
    expect(name1.result?.namespace_id).toBe('id');
    expect(name1.result?.tx_id).toBe('0x1234');
    expect(name1.result?.status).toBe('name-register');
    expect(name1.result?.expire_block).toBe(1001);
    expect(name1.result?.address).toBe('SP3GWTV1SMF9HDS4VY5NMM833CHH266W4YBASVYMZ');

    const payload = {
      "events": [],
      "block_hash": "0xaaee893667244adcb8581abac372f1f8c385d402b71e8e8b4ac91e8066024fd5",
      "miner_txid": "0x6ff493c6b98b9cff0638c7c5276af8e627b8ed779965a5f1c11bbc0810834b3e",
      "block_height": 2,
      "transactions": [
        {
          "txid": "0xf037c8da8210e2a348bbecd3bc44901de875d3774c5fce49cb75d95f2dc2ca4d",
          "raw_tx": "0x00000000010500e1cd6c39a3d316e49bf16b4a20636462231b84f200000000000000000000000000000000000094f2c8529dcb8a55a5cfd4434c68cae9cd54f26f01c656369585db3ba364150a4fead679adf35cf5ba1026656b3873daf3380f48ec6dcc175ada868e531decf5001d04c185cad28a3f5299d3fcbcbcbe66b2e1e227000000000000000000000000000186a0000064cc0eb565e85c0d4110c9a760c8fdad21999409f89320e355f326c144b8ada4268244f80734170cea96f683d2431b59f07f276a10efc80793d4dceef8feb2310302000000000216000000000000000000000000000000000000000003626e730c6e616d652d72656e6577616c000000050200000002696402000000086672696564676572010000000000000000000000000001a72a0909",
          "status": "success",
          "tx_index": 2,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 184253,
            "read_count": 11,
            "read_length": 43250,
            "write_count": 1,
            "write_length": 143
          },
          "microblock_hash": null,
          "microblock_sequence": null,
          "microblock_parent_hash": null
        }
      ],
      "anchored_cost": {
        "runtime": 28375070,
        "read_count": 8888,
        "read_length": 1085153,
        "write_count": 593,
        "write_length": 156284
      },
      "burn_block_hash": "0x0000000000000000000552fb5fd8c08ad8f1ef30c239369a8a3380ec1566047a",
      "burn_block_time": 1647068392,
      "index_block_hash": "0x9ff46918054b1aa94571a60e14921a56977f26af2adcbf4a7f64138566feba48",
      "burn_block_height": 726956,
      "parent_block_hash": "0xf81ef7f114213b9034a4378345a931a97c781fab398c3d7a2053f0d0bf48d311",
      "parent_microblock": "0x640362ec47c40de3337491993e42efe60d05187431633ab03c3f5d33e70d1f8e",
      "matured_miner_rewards": [],
      "parent_burn_block_hash": "0x00000000000000000001523f01cb4304d39527454d2eec79817b50c033a5c5d9",
      "parent_index_block_hash": "0xaec282925b5096c0bd98588d25a97e134bcc4f19b6600859fa267cf0ee4eaf2d",
      "parent_burn_block_height": 726955,
      "confirmed_microblocks_cost": {
        "runtime": 360206,
        "read_count": 38,
        "read_length": 95553,
        "write_count": 8,
        "write_length": 378
      },
      "parent_microblock_sequence": 0,
      "parent_burn_block_timestamp": 1647068146
    };

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    const name2 = await db.getName({
      name: 'friedger.id',
      includeUnanchored: true,
      chainId: ChainID.Mainnet
    });
    expect(name2.found).toBe(true);
    expect(name2.result?.namespace_id).toBe('id');
    expect(name2.result?.tx_id).toBe('0xf037c8da8210e2a348bbecd3bc44901de875d3774c5fce49cb75d95f2dc2ca4d');
    expect(name2.result?.status).toBe('name-renewal');
    expect(name2.result?.expire_block).toBe(1002); // Updated correctly
    expect(name2.result?.address).toBe('SP3GWTV1SMF9HDS4VY5NMM833CHH266W4YBASVYMZ');
  });

  test('/attachments/new with re-orged zonefiles', async () => {
    const block1 = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x0101',
    })
      .addTx()
      .addTxBnsNamespace({ namespace_id: 'btc' })
      .addTxBnsName({ name: 'jnj.btc', namespace_id: 'btc' })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV('jnj.btc'),
        asset_identifier: 'SP000000000000000000002Q6VF78.bns::names',
        recipient: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .build();
    await db.update(block1);

    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x0200',
      parent_index_block_hash: '0x0101'
    })
      .addTx({ tx_id: '0x1212' })
      .addTxBnsName({
        name: 'jnj.btc',
        namespace_id: 'btc',
        status: 'name-update', // Canonical update
        tx_id: '0x1212',
        zonefile_hash: '0x9198e0b61a029671e53bd59aa229e7ae05af35a3'
      })
      .build();
    await db.update(block2);

    const block2b = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x0201',
      parent_index_block_hash: '0x0101'
    })
      .addTx({ tx_id: '0x121266' })
      .addTxBnsName({
        name: 'jnj.btc',
        namespace_id: 'btc',
        status: 'name-update', // Non-canonical update
        tx_id: '0x121266',
        zonefile_hash: '0xffff'
      })
      .build();
    await db.update(block2b);

    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x0300',
      parent_index_block_hash: '0x0200'
    })
      .addTx({ tx_id: '0x3333' })
      .build();
    await db.update(block3);

    const payload = [
      {
        "tx_id": "0x1212", // Canonical
        "content": "0x244f524947494e206a6e6a2e6274632e0a2454544c20333630300a5f687474702e5f74637009494e095552490931300931092268747470733a2f2f676169612e626c6f636b737461636b2e6f72672f6875622f317a38417a79684334326e3854766f4661554c326e7363614347487151515755722f70726f66696c652e6a736f6e220a0a",
        "metadata": "0x0c00000004046e616d6502000000036a6e6a096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e64657205163763c6b37100efa8261e5fc1b1e8c18cd3fed9b6",
        "contract_id": "SP000000000000000000002Q6VF78.bns",
        "block_height": 17307,
        "content_hash": "0x9198e0b61a029671e53bd59aa229e7ae05af35a3",
        "attachment_index": 823,
        "index_block_hash": "0x0200"
      },
      {
        "tx_id": "0x121266", // Non-canonical
        "content": "0x",
        "metadata": "0x0c00000004046e616d6502000000036a6e6a096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e64657205163763c6b37100efa8261e5fc1b1e8c18cd3fed9b6",
        "contract_id": "SP000000000000000000002Q6VF78.bns",
        "block_height": 17307,
        "content_hash": "0xffff",
        "attachment_index": 823,
        "index_block_hash": "0x0201"
      },
    ];

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/attachments/new',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    const name = await db.getName({ name: 'jnj.btc', chainId: ChainID.Mainnet, includeUnanchored: true });
    expect(name.found).toBe(true);
    expect(name.result?.zonefile_hash).toBe('9198e0b61a029671e53bd59aa229e7ae05af35a3');
    expect(name.result?.index_block_hash).toBe('0x0200');
    expect(name.result?.tx_id).toBe('0x1212');
    expect(name.result?.status).toBe('name-update');
  });

  test('/attachments/new with duplicate zonefiles for the same tx', async () => {
    const block1 = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x0101',
    })
      .addTx({ tx_id: '0x1234' })
      .addTxBnsNamespace({ namespace_id: 'btc' })
      .addTxBnsName({
        name: 'jnj.btc',
        namespace_id: 'btc',
        zonefile_hash: '0x9198e0b61a029671e53bd59aa229e7ae05af35a3'
      })
      .addTxNftEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        value: bnsNameCV('jnj.btc'),
        asset_identifier: 'SP000000000000000000002Q6VF78.bns::names',
        recipient: 'ST5RRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1ZA',
      })
      .build();
    await db.update(block1);

    const payload = [
      {
        "tx_id": "0x1234",
        "content": "0x",
        "metadata": "0x0c00000004046e616d6502000000036a6e6a096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e64657205163763c6b37100efa8261e5fc1b1e8c18cd3fed9b6",
        "contract_id": "SP000000000000000000002Q6VF78.bns",
        "block_height": 1,
        "content_hash": "0x9198e0b61a029671e53bd59aa229e7ae05af35a3",
        "attachment_index": 823,
        "index_block_hash": "0x0101"
      },
      {
        "tx_id": "0x1234",
        "content": "0x244f524947494e206a6e6a2e6274632e0a2454544c20333630300a5f687474702e5f74637009494e095552490931300931092268747470733a2f2f676169612e626c6f636b737461636b2e6f72672f6875622f317a38417a79684334326e3854766f4661554c326e7363614347487151515755722f70726f66696c652e6a736f6e220a0a",
        "metadata": "0x0c00000004046e616d6502000000036a6e6a096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e64657205163763c6b37100efa8261e5fc1b1e8c18cd3fed9b6",
        "contract_id": "SP000000000000000000002Q6VF78.bns",
        "block_height": 1,
        "content_hash": "0x9198e0b61a029671e53bd59aa229e7ae05af35a3", // Same zonefile_hash but different content, this should overwrite the entry above
        "attachment_index": 823,
        "index_block_hash": "0x0101"
      },
      {
        "tx_id": "0x1234",
        "content": "0x244f524947494e206a6e6a2e6274632e0a2454544c20333630300a5f687474702e5f74637009494e095552490931300931092268747470733a2f2f676169612e626c6f636b737461636b2e6f72672f6875622f317a38417a79684334326e3854766f4661554c326e7363614347487151515755722f70726f66696c652e6a736f6e220a0a",
        "metadata": "0x0c00000004046e616d6502000000036a6e6a096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e64657205163763c6b37100efa8261e5fc1b1e8c18cd3fed9b6",
        "contract_id": "SP000000000000000000002Q6VF78.bns",
        "block_height": 1,
        "content_hash": "0x9198e0b61a029671e53bd59aa229e7ae05af35a3", // Also overwrite
        "attachment_index": 823,
        "index_block_hash": "0x0101"
      },
    ];

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/attachments/new',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    // To validate table data we'll query it directly. There should only be one zonefile.
    const result = await client<DbBnsZoneFile[]>`SELECT * FROM zonefiles`;
    expect(result.count).toBe(1);
    expect(result[0].zonefile).toBe('$ORIGIN jnj.btc.\n$TTL 3600\n_http._tcp\tIN\tURI\t10\t1\t"https://gaia.blockstack.org/hub/1z8AzyhC42n8TvoFaUL2nscaCGHqQQWUr/profile.json"\n\n');
  });

  test('name-register and name-transfer for several names in one block', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x161bd86201417a55fb0dd851ac0e6b10c67a0b443e593008a4cf46fb6938b369',
      index_block_hash: '0x8cc3d58350082f3161ae34deaad77c1c8887947ff0295be59ec5caccf984fe78',
      burn_block_height: 756266,
      burn_block_hash: '0x00000000000000000002e78c9c19a055ca0e680674e1a2f0f01a48c04a24f627',
      burn_block_time: 1664489645,
    })
      .addTx({
        tx_id: '0x1234',
        sender_address: 'SP3GWTV1SMF9HDS4VY5NMM833CHH266W4YBASVYMZ'
      })
      .addTxBnsNamespace({
        namespace_id: 'btc',
        lifetime: 1000
      })
      .build();
    await db.update(block);
    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0xc44f4e3ed66bacaaa5cbe5b9c35b4e2ce2467933b57974fa03b539a2b2b88063',
        microblock_sequence: 0,
        parent_index_block_hash: '0x8cc3d58350082f3161ae34deaad77c1c8887947ff0295be59ec5caccf984fe78'
      })
      .build();
    await db.updateMicroblocks(microblock);

    const payload = {
      // In the block message, events are not sorted by `event_index`.
      "events": [
        {
          "txid": "0xd5803813a0befbf7e426ca897a5940c691a18e5959170e12ddb9e71c91ea4f12",
          "type": "nft_mint_event",
          "committed": true,
          "event_index": 405,
          "nft_mint_event": {
            "raw_value": "0x0c00000002046e616d6502000000086b6574656c6f6e65096e616d6573706163650200000003627463",
            "recipient": "SP253DQBW2ZBKE10PBQVBDJ5XSQQ4P06PVP9PR6S8",
            "asset_identifier": "SP000000000000000000002Q6VF78.bns::names"
          }
        },
        {
          "txid": "0xd5803813a0befbf7e426ca897a5940c691a18e5959170e12ddb9e71c91ea4f12",
          "type": "contract_event",
          "committed": true,
          "event_index": 406,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e64657801000000000000000000000000000144ea04686173680200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb086d657461646174610c00000004046e616d6502000000086b6574656c6f6e65096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e64657205168a36dd7c17d73704165df6b6c8bdcdee4b00d6dd",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        },
        {
          "txid": "0xa106e30d1df4607a993ff2ec0d68a4acfb3d5ab2ae597179869df8d6da8f1b95",
          "type": "nft_transfer_event",
          "committed": true,
          "event_index": 407,
          "nft_transfer_event": {
            "sender": "SP253DQBW2ZBKE10PBQVBDJ5XSQQ4P06PVP9PR6S8",
            "raw_value": "0x0c00000002046e616d6502000000086b6574656c6f6e65096e616d6573706163650200000003627463",
            "recipient": "SP2WPXVTZE2RG4SZGJT5HTZ7JK6CAWTEV0A55HFH7",
            "asset_identifier": "SP000000000000000000002Q6VF78.bns::names"
          }
        },
        {
          "txid": "0xa106e30d1df4607a993ff2ec0d68a4acfb3d5ab2ae597179869df8d6da8f1b95",
          "type": "contract_event",
          "committed": true,
          "event_index": 408,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e64657801000000000000000000000000000144eb04686173680200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb086d657461646174610c00000004046e616d6502000000086b6574656c6f6e65096e616d6573706163650200000003627463026f700d0000000d6e616d652d7472616e736665720974782d73656e64657205168a36dd7c17d73704165df6b6c8bdcdee4b00d6dd",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        },
        {
          "txid": "0x1784633b879ffcf15c18dcf627047a44358f2f0660c14f5188c9f17b28abb8af",
          "type": "nft_mint_event",
          "committed": true,
          "event_index": 381,
          "nft_mint_event": {
            "raw_value": "0x0c00000002046e616d65020000000f637269636b6574776972656c657373096e616d6573706163650200000003627463",
            "recipient": "SP2MM4ETXDE26HQ64F29VG05Q577DEPTSDJ2DQV8N",
            "asset_identifier": "SP000000000000000000002Q6VF78.bns::names"
          }
        },
        {
          "txid": "0x1784633b879ffcf15c18dcf627047a44358f2f0660c14f5188c9f17b28abb8af",
          "type": "contract_event",
          "committed": true,
          "event_index": 382,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e64657801000000000000000000000000000144e204686173680200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb086d657461646174610c00000004046e616d65020000000f637269636b6574776972656c657373096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e6465720516a9423b5d6b8468dcc47893b800b729ced75b596c",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        },
        {
          "txid": "0x28715dc6e09e75cec4d26d6a52426c8cc13c6e5a16d5252886c33ffc6bcceef7",
          "type": "nft_transfer_event",
          "committed": true,
          "event_index": 389,
          "nft_transfer_event": {
            "sender": "SP2MM4ETXDE26HQ64F29VG05Q577DEPTSDJ2DQV8N",
            "raw_value": "0x0c00000002046e616d65020000000f637269636b6574776972656c657373096e616d6573706163650200000003627463",
            "recipient": "SP1QFKSVQP3J2PF45KFFCVBR4Q24Y09G0PJDECHS7",
            "asset_identifier": "SP000000000000000000002Q6VF78.bns::names"
          }
        },
        {
          "txid": "0x28715dc6e09e75cec4d26d6a52426c8cc13c6e5a16d5252886c33ffc6bcceef7",
          "type": "contract_event",
          "committed": true,
          "event_index": 390,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e64657801000000000000000000000000000144e304686173680200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb086d657461646174610c00000004046e616d65020000000f637269636b6574776972656c657373096e616d6573706163650200000003627463026f700d0000000d6e616d652d7472616e736665720974782d73656e6465720516a9423b5d6b8468dcc47893b800b729ced75b596c",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        }
      ],
      "block_hash": "0x41e158fe192103d2a5f895c6f9093a548ecc35db3a4c3c5de0e616fd3894338e",
      "miner_txid": "0x9c48f6c748177cd049db40172e5044e5a98f8fe5b798f33212f876121e764b72",
      "block_height": 2,
      "transactions": [
        {
          "txid": "0x1784633b879ffcf15c18dcf627047a44358f2f0660c14f5188c9f17b28abb8af",
          "raw_tx": "0x00000000010400a9423b5d6b8468dcc47893b800b729ced75b596c00000000000000010000000000014ed6010055b3a6e2581eaaf686bc9596a4c9cf62cbdb30ffaad167c094824b5d89598ce1101ff56aeb58e2020c10954da05cd80b733ec79ecd71db1921aa202d377aac740302000000000216000000000000000000000000000000000000000003626e730d6e616d652d7265676973746572000000040200000003627463020000000f637269636b6574776972656c65737302000000149a3db4f009ad960c5a0cad7ad9c19f21fa0fe3680200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb",
          "status": "success",
          "tx_index": 274,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 311527,
            "read_count": 17,
            "read_length": 43206,
            "write_count": 4,
            "write_length": 242
          },
          "microblock_hash": null,
          "microblock_sequence": null,
          "microblock_parent_hash": null
        },
        {
          "txid": "0x28715dc6e09e75cec4d26d6a52426c8cc13c6e5a16d5252886c33ffc6bcceef7",
          "raw_tx": "0x00000000010400a9423b5d6b8468dcc47893b800b729ced75b596c00000000000000020000000000014941010173c47aad0c8e5e8e2c655f488e4b8f514a63fd0190ae392f6cc6f22c1ec93aa44facb412a9d6504efd7945eeb52407011069ca1d3a7138e7a889c7c15aa82df2030200000001020216a9423b5d6b8468dcc47893b800b729ced75b596c16000000000000000000000000000000000000000003626e73056e616d65730c00000002046e616d65020000000f637269636b6574776972656c657373096e616d6573706163650200000003627463100216000000000000000000000000000000000000000003626e730d6e616d652d7472616e73666572000000040200000003627463020000000f637269636b6574776972656c65737305166ef9e777b0e42b3c859bdecdaf04b889e02600b40a0200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb",
          "status": "success",
          "tx_index": 276,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 183670,
            "read_count": 19,
            "read_length": 44047,
            "write_count": 5,
            "write_length": 266
          },
          "microblock_hash": null,
          "microblock_sequence": null,
          "microblock_parent_hash": null
        },
        {
          "txid": "0xd5803813a0befbf7e426ca897a5940c691a18e5959170e12ddb9e71c91ea4f12",
          "raw_tx": "0x000000000104008a36dd7c17d73704165df6b6c8bdcdee4b00d6dd0000000000000001000000000001449f0101bd23afc22da4e356847d76d07261a861488389d4864c8d42ce002be439e0e78b3aa1088a8aaac189f7c85e674fd871b787f1fb0cd5a19acd827a011f5e38921c0302000000000216000000000000000000000000000000000000000003626e730d6e616d652d726567697374657200000004020000000362746302000000086b6574656c6f6e6502000000146cd23e487d9068d24e1e1bc90636a6e48c1546a50200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb",
          "status": "success",
          "tx_index": 285,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 229244,
            "read_count": 17,
            "read_length": 43199,
            "write_count": 4,
            "write_length": 228
          },
          "microblock_hash": null,
          "microblock_sequence": null,
          "microblock_parent_hash": null
        },
        {
          "txid": "0xa106e30d1df4607a993ff2ec0d68a4acfb3d5ab2ae597179869df8d6da8f1b95",
          "raw_tx": "0x000000000104008a36dd7c17d73704165df6b6c8bdcdee4b00d6dd00000000000000020000000000015cb70101ac9a2e87c627c605ac68f0c40d59ff6bd5543705a5710ee4679d936a664d20f60a0b91e98770cb3597ea25af005e9eb083a827e860b6ba975c0a819205b4792f0302000000010202168a36dd7c17d73704165df6b6c8bdcdee4b00d6dd16000000000000000000000000000000000000000003626e73056e616d65730c00000002046e616d6502000000086b6574656c6f6e65096e616d6573706163650200000003627463100216000000000000000000000000000000000000000003626e730d6e616d652d7472616e7366657200000004020000000362746302000000086b6574656c6f6e650516b96eef5f70b10267f0968b1d7cf29998ae69db020a0200000014b472a266d0bd89c13706a4132ccfb16f7c3b9fcb",
          "status": "success",
          "tx_index": 286,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 183264,
            "read_count": 19,
            "read_length": 44026,
            "write_count": 5,
            "write_length": 252
          },
          "microblock_hash": null,
          "microblock_sequence": null,
          "microblock_parent_hash": null
        }
      ],
      "anchored_cost": {
        "runtime": 37717625,
        "read_count": 3184,
        "read_length": 10513899,
        "write_count": 710,
        "write_length": 42932
      },
      "burn_block_hash": "0x0000000000000000000213c1512c2bffae7378f2b890bfea3ee6dc8e2e7836a2",
      "burn_block_time": 1664490688,
      "index_block_hash": "0x2eb444d32bb66a6acc3ba66aedabbb19c3adde8b6a9717765960bdc67ea32070",
      "burn_block_height": 756268,
      "parent_block_hash": "0x161bd86201417a55fb0dd851ac0e6b10c67a0b443e593008a4cf46fb6938b369",
      "parent_microblock": "0xc44f4e3ed66bacaaa5cbe5b9c35b4e2ce2467933b57974fa03b539a2b2b88063",
      "matured_miner_rewards": [],
      "parent_burn_block_hash": "0x00000000000000000002e78c9c19a055ca0e680674e1a2f0f01a48c04a24f627",
      "parent_index_block_hash": "0x8cc3d58350082f3161ae34deaad77c1c8887947ff0295be59ec5caccf984fe78",
      "parent_burn_block_height": 756266,
      "confirmed_microblocks_cost": {
        "runtime": 5707388,
        "read_count": 545,
        "read_length": 2095326,
        "write_count": 127,
        "write_length": 8025
      },
      "parent_microblock_sequence": 0,
      "parent_burn_block_timestamp": 1664489645
    };

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    const name = await db.getName({
      name: 'cricketwireless.btc',
      includeUnanchored: true,
      chainId: ChainID.Mainnet
    });
    expect(name.found).toBe(true);
    expect(name.result?.namespace_id).toBe('btc');
    expect(name.result?.tx_id).toBe('0x28715dc6e09e75cec4d26d6a52426c8cc13c6e5a16d5252886c33ffc6bcceef7');
    expect(name.result?.status).toBe('name-transfer');
    expect(name.result?.address).toBe('SP1QFKSVQP3J2PF45KFFCVBR4Q24Y09G0PJDECHS7');
  });

  test('name-register and name-transfer in same tx from non-BNS contract', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      block_hash: '0x08cdd83644176e87cd5fdc584a5193de84c4c54cbe8b3839225e75f396f64468',
      index_block_hash: '0x82239cdbd3903ca032d300101990120947132a8a005a92d7a1cdcd5a61b35ba1',
      burn_block_height: 749980,
      burn_block_hash: '0x000000000000000000089afaf672605818e368521d9ad2d8e4b5763956b75363',
      burn_block_time: 1660833970,
    })
      .addTx({
        tx_id: '0x1234',
        sender_address: 'SP3GWTV1SMF9HDS4VY5NMM833CHH266W4YBASVYMZ'
      })
      .addTxBnsNamespace({
        namespace_id: 'mega',
        lifetime: 1000
      })
      .build();
    await db.update(block);
    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_hash: '0x2ad76cc1eadb6e0dd155a7b5ac82ff81a2c664552dacb99a524a410856330529',
        microblock_sequence: 0,
        parent_index_block_hash: '0x82239cdbd3903ca032d300101990120947132a8a005a92d7a1cdcd5a61b35ba1'
      })
      .build();
    await db.updateMicroblocks(microblock);

    const payload = {
      "events": [
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "type": "contract_event",
          "committed": true,
          "event_index": 85,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e646578010000000000000000000000000000f65804686173680200000000086d657461646174610c00000004046e616d650200000003617065096e616d65737061636502000000046d656761026f700d0000000d6e616d652d7472616e736665720974782d73656e64657206161809f2ab9182b6ff1678f82846131c0709e51cf91b72796465722d68616e646c65732d636f6e74726f6c6c65722d7631",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        },
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "type": "stx_burn_event",
          "committed": true,
          "event_index": 81,
          "stx_burn_event": {
            "amount": "1",
            "sender": "SPC0KWNBJ61BDZRPF3W2GHGK3G3GKS8WZ7ND33PS.ryder-handles-controller-v1"
          }
        },
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "type": "nft_transfer_event",
          "committed": true,
          "event_index": 84,
          "nft_transfer_event": {
            "sender": "SPC0KWNBJ61BDZRPF3W2GHGK3G3GKS8WZ7ND33PS.ryder-handles-controller-v1",
            "raw_value": "0x0c00000002046e616d650200000003617065096e616d65737061636502000000046d656761",
            "recipient": "SPV48Q8E5WP4TCQ63E9TV6KF9R4HP01Z8WS3FBTG",
            "asset_identifier": "SP000000000000000000002Q6VF78.bns::names"
          }
        },
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "type": "nft_mint_event",
          "committed": true,
          "event_index": 82,
          "nft_mint_event": {
            "raw_value": "0x0c00000002046e616d650200000003617065096e616d65737061636502000000046d656761",
            "recipient": "SPC0KWNBJ61BDZRPF3W2GHGK3G3GKS8WZ7ND33PS.ryder-handles-controller-v1",
            "asset_identifier": "SP000000000000000000002Q6VF78.bns::names"
          }
        },
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "type": "stx_transfer_event",
          "committed": true,
          "event_index": 79,
          "stx_transfer_event": {
            "amount": "3000000",
            "sender": "SPC0KWNBJ61BDZRPF3W2GHGK3G3GKS8WZ7ND33PS.ryder-handles-controller-v1",
            "recipient": "SP2J9XB6CNJX9C36D5SY4J85SA0P1MQX7R5VFKZZX"
          }
        },
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "type": "stx_transfer_event",
          "committed": true,
          "event_index": 80,
          "stx_transfer_event": {
            "amount": "1",
            "sender": "SP3C8QH2R3909YQZ7WVZ71N8RJ6Y0P317T8MG8XSZ",
            "recipient": "SPC0KWNBJ61BDZRPF3W2GHGK3G3GKS8WZ7ND33PS.ryder-handles-controller-v1"
          }
        },
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "type": "contract_event",
          "committed": true,
          "event_index": 83,
          "contract_event": {
            "topic": "print",
            "raw_value": "0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e646578010000000000000000000000000000f65704686173680200000000086d657461646174610c00000004046e616d650200000003617065096e616d65737061636502000000046d656761026f700d0000000d6e616d652d72656769737465720974782d73656e64657206161809f2ab9182b6ff1678f82846131c0709e51cf91b72796465722d68616e646c65732d636f6e74726f6c6c65722d7631",
            "contract_identifier": "SP000000000000000000002Q6VF78.bns"
          }
        }
      ],
      "block_hash": "0xbcf632eaa887b66a6356bf9410eb61377cced2d3f444a2286fb59b12a63e48e4",
      "miner_txid": "0x037d5016d21839a46f136ad846ea99967eda65bf5cdb31feabc60c8eaef5b96d",
      "block_height": 2,
      "transactions": [
        {
          "txid": "0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16",
          "raw_tx": "0x00000000010400d88bc4581a409f5fe7e6fe70d51891bc0b0c27d2000000000000001100000000000003e80001fff157398074931aca859d34de1f3070359b8493033cd79fde329ecd66e4bd090235cf61f9916f76cdbaa37ff4d2ee3358322f6a58ec2fb05717115c913fd6e103010000000002161809f2ab9182b6ff1678f82846131c0709e51cf91b72796465722d68616e646c65732d636f6e74726f6c6c65722d76310d6e616d652d72656769737465720000000602000000046d656761020000000361706502000000057337306b35020000004107d00910104bba0ee68b131ceead109ccea598a267a2000140b3277809f1ab535dcef753028c00e7239be1477801ac7d5b8c10e0a7b242261285212da194bdad01051636445d0e2f2c4d32e61b93ad9a6f4e091b003f470200000000",
          "status": "success",
          "tx_index": 25,
          "raw_result": "0x0703",
          "contract_abi": null,
          "execution_cost": {
            "runtime": 643399,
            "read_count": 69,
            "read_length": 231108,
            "write_count": 16,
            "write_length": 1948
          },
          "microblock_hash": null,
          "microblock_sequence": null,
          "microblock_parent_hash": null
        }
      ],
      "anchored_cost": {
        "runtime": 39996577,
        "read_count": 4234,
        "read_length": 13859444,
        "write_count": 676,
        "write_length": 53049
      },
      "burn_block_hash": "0x0000000000000000000867b5dd6ec7ebb50404acabcdb35193b6b2fcd3ea7a37",
      "burn_block_time": 1660834638,
      "index_block_hash": "0xe43e505d4c7ca5f64a6d9617fbb658a84344610eb0e6495f8f9b7ab3b2648f61",
      "burn_block_height": 749981,
      "parent_block_hash": "0x08cdd83644176e87cd5fdc584a5193de84c4c54cbe8b3839225e75f396f64468",
      "parent_microblock": "0x2ad76cc1eadb6e0dd155a7b5ac82ff81a2c664552dacb99a524a410856330529",
      "matured_miner_rewards": [],
      "parent_burn_block_hash": "0x000000000000000000089afaf672605818e368521d9ad2d8e4b5763956b75363",
      "parent_index_block_hash": "0x82239cdbd3903ca032d300101990120947132a8a005a92d7a1cdcd5a61b35ba1",
      "parent_burn_block_height": 749980,
      "confirmed_microblocks_cost": {
        "runtime": 0,
        "read_count": 0,
        "read_length": 0,
        "write_count": 0,
        "write_length": 0
      },
      "parent_microblock_sequence": 0,
      "parent_burn_block_timestamp": 1660833970
    };

    await httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      throwOnNotOK: true,
    });

    const name = await db.getName({
      name: 'ape.mega',
      includeUnanchored: true,
      chainId: ChainID.Mainnet
    });
    expect(name.found).toBe(true);
    expect(name.result?.namespace_id).toBe('mega');
    expect(name.result?.tx_id).toBe('0xf9f9144793f6d4da9aba92a54ab601eb23bfe7f44c1edb29c2920bf5e7d2ac16');
    expect(name.result?.status).toBe('name-transfer');
    expect(name.result?.expire_block).toBe(1002);
    expect(name.result?.address).toBe('SPV48Q8E5WP4TCQ63E9TV6KF9R4HP01Z8WS3FBTG');

    const list = await db.getNamesList({ page: 0, includeUnanchored: true });
    expect(list.results.length).toBe(1);
    expect(list.results).toStrictEqual(['ape.mega']);

    const namespaceList = await db.getNamespaceNamesList({
      namespace: 'mega',
      page: 0,
      includeUnanchored: true
    });
    expect(namespaceList.results.length).toBe(1);
    expect(namespaceList.results).toStrictEqual(['ape.mega']);
  });
})
