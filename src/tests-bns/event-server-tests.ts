import { ChainID } from '@stacks/transactions';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { bnsNameCV, httpPostRequest } from '../helpers';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../test-utils/test-builders';
import { DbAssetEventTypeId, DbBnsZoneFile } from '../datastore/common';

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
    const result = await client.query<DbBnsZoneFile>(`SELECT * FROM zonefiles`);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].zonefile).toBe('$ORIGIN jnj.btc.\n$TTL 3600\n_http._tcp\tIN\tURI\t10\t1\t"https://gaia.blockstack.org/hub/1z8AzyhC42n8TvoFaUL2nscaCGHqQQWUr/profile.json"\n\n');
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
