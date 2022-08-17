import { ChainID } from '@stacks/transactions';
import { PoolClient } from 'pg';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { httpPostRequest } from '../helpers';
import { cycleMigrations, PgDataStore, runMigrations } from '../datastore/postgres-store';

describe('event server tests', () => {
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

  test('/attachments/new', async () => {
    const payload = [
      {
        tx_id: '0x7450a4442241e5b0bf7861bce50e9be3ac4ccee9fad9ac58c0b3625d46621e7c',
        content: '0x',
        metadata:
          '0x0c00000004046e616d650200000005666f726465096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e6465720516bec07ccccdd21e97478e6da5344acb82c9ea5957',
        contract_id: 'SP000000000000000000002Q6VF78.bns',
        block_height: 17328,
        content_hash: '0xb472a266d0bd89c13706a4132ccfb16f7c3b9fcb',
        attachment_index: 892,
        index_block_hash: '0xc61a2f88e37074346141e04202686b695bc599349dd28ef141f54179bab16420',
      },
      {
        tx_id: '0xbf63f6c8be01b1174f9eab4b2c3c4f547027bc3a7355c19ea92de603e1fa6777',
        content: '0x',
        metadata:
          '0x0c00000004046e616d65020000000a67696e61616272616d73096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e6465720516b6cb2277706550c6d5e83559bdd1b08dccc8f52b',
        contract_id: 'SP000000000000000000002Q6VF78.bns',
        block_height: 17328,
        content_hash: '0xb472a266d0bd89c13706a4132ccfb16f7c3b9fcb',
        attachment_index: 881,
        index_block_hash: '0xc61a2f88e37074346141e04202686b695bc599349dd28ef141f54179bab16420',
      },
      {
        attachment_index: 62307,
        block_height: 71353,
        content:
          '0x244f524947494e20736861796b682e6274630a2454544c20333630300a5f687474702e5f74637009494e095552490931300931092268747470733a2f2f676169612e626c6f636b737461636b2e6f72672f6875622f314c68736238545169363562465250656679315044644b5475524e3768355533476a2f70726f66696c652e6a736f6e220a0a',
        content_hash: '0xb79bd4182019b486e7212599b039cd004d018b67',
        contract_id: 'SP000000000000000000002Q6VF78.bns',
        index_block_hash: '0x02247fb448acad5cb3e55951ebf1b1dfc53be29966f29fe80ce90121fac35a02',
        metadata:
          '0x0c00000004046e616d650200000006736861796b68096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e6465720516d3c6c122e746ab7de62086f5ac7105b3b513ce29',
        tx_id: '0xe78532e6a471a476ac7198b7441fb067230387b2d87f889d899ec9da045266de',
      },
      {
        attachment_index: 62308,
        block_height: 71353,
        content:
          '0x244f524947494e20333130322e6274630a2454544c20333630300a5f687474702e5f74637009494e095552490931300931092268747470733a2f2f676169612e626c6f636b737461636b2e6f72672f6875622f314156334e694b585875443744454b696457517270694d53335442434d38666e59562f70726f66696c652e6a736f6e220a0a',
        content_hash: '0x84f8bc2be1be14da498e4618562a145034370deb',
        contract_id: 'SP000000000000000000002Q6VF78.bns',
        index_block_hash: '0x02247fb448acad5cb3e55951ebf1b1dfc53be29966f29fe80ce90121fac35a02',
        metadata:
          '0x0c00000004046e616d65020000000433313032096e616d6573706163650200000003627463026f700d0000000d6e616d652d72656769737465720974782d73656e6465720516dcbb8446e2a3663b5338d27f7aced56e30982c2d',
        tx_id: '0x7b06863101c5228481a03e153fcda7d799b2a1ba0cbeb49e0423f93ddfa171d2',
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
  });

  afterEach(async () => {
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
    await eventServer.closeAsync();
  });
});
