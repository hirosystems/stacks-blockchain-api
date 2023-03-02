import { ChainID } from '@stacks/transactions';
import { NextFunction } from 'express';
import { PgSqlClient } from '../datastore/connection';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgWriteStore } from '../datastore/pg-write-store';
import { getGenesisBlockData } from '../event-replay/helpers';
import { bnsImportMiddleware, EventStreamServer, startEventServer } from '../event-stream/event-server';
import { httpPostRequest } from '../helpers';

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

    test('BNS middleware imports bns when it receives the genesis block', async () => {
    process.env.BNS_IMPORT_DIR = 'src/tests-bns/import-test-files';
    const genesisBlock = await getGenesisBlockData('src/tests-event-replay/tsv/mainnet.tsv');
    const bnsImportMiddlewareInitialized = bnsImportMiddleware(db);
    let mockRequest = {
      body: genesisBlock
    } as unknown as Partial<Request>;
    let mockResponse: Partial<Response> = {};
    let nextFunction: NextFunction = jest.fn();
    await bnsImportMiddlewareInitialized(mockRequest as any, mockResponse as any, nextFunction)

    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(true)
    expect(configState.bns_subdomains_imported).toBe(true)
  });

  test('BNS middleware imports bns when it receives the genesis block from block 0', async () => {
    process.env.BNS_IMPORT_DIR = 'src/tests-bns/import-test-files';
    const genesisBlock = await getGenesisBlockData('src/tests-event-replay/tsv/mainnet-block0.tsv');
    const bnsImportMiddlewareInitialized = bnsImportMiddleware(db);
    let mockRequest = {
      body: genesisBlock
    } as unknown as Partial<Request>;
    let mockResponse: Partial<Response> = {};
    let nextFunction: NextFunction = jest.fn();
    await bnsImportMiddlewareInitialized(mockRequest as any, mockResponse as any, nextFunction)

    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(true)
    expect(configState.bns_subdomains_imported).toBe(true)
  });

  test('BNS middleware is async. /new_block posts return before importing BNS finishes', async () => {
    process.env.BNS_IMPORT_DIR = 'src/tests-bns/import-test-files';
    const genesisBlock = await getGenesisBlockData('src/tests-event-replay/tsv/mainnet-block0.tsv');

    httpPostRequest({
      host: '127.0.0.1',
      port: eventServer.serverAddress.port,
      path: '/new_block',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(genesisBlock), 'utf8'),
      throwOnNotOK: true,
    });

    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(false)
    expect(configState.bns_subdomains_imported).toBe(false)

    await new Promise(resolve => {
      db.eventEmitter.on('configStateUpdate', (configState) => {
        if (configState.bns_names_onchain_imported && configState.bns_subdomains_imported) {
          expect(configState.bns_names_onchain_imported).toBe(true)
          expect(configState.bns_subdomains_imported).toBe(true);
          resolve(undefined);
        }
      })
    })
    db.eventEmitter.removeAllListeners('configStateUpdate');
  })
})
