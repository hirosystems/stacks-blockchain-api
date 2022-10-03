import * as fs from 'fs';
import * as supertest from 'supertest';
import { httpPostRequest, logger } from '../helpers';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgWriteStore } from '../datastore/pg-write-store';
import { useWithCleanup } from './test-helpers';
import { getRawEventRequests } from '../datastore/event-requests';
import { startEventServer } from '../event-stream/event-server';
import { ChainID } from '@stacks/transactions';
import { startApiServer } from '../api/init';
import { getTxFromDataStore } from '../api/controllers/db-controller';
import { ContractCallTransaction } from 'docs/generated';

describe('subnet tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  test('NFT use case', async () => {
    await useWithCleanup(
      () => {
        const origLevel = logger.level;
        logger.level = 'error';
        return [, () => (logger.level = origLevel)] as const;
      },
      () => {
        const readStream = fs.createReadStream(
          'src/tests/event-replay-logs/subnet-nft-use-case.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Testnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
          httpLogLevel: 'debug',
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: ChainID.Testnet,
          httpLogLevel: 'debug',
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, rawEventsIterator, eventServer, api) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
          }
        }

        const mintTx = await getTxFromDataStore(db, {
          txId: '0x8d042c14323cfd9d31e121cc48c2c641a8db01dce19a0f6dd531eb33689dff44',
          includeUnanchored: false,
          eventLimit: 10,
          eventOffset: 0,
        });
        expect(mintTx.result?.tx_type).toBe('contract_call');
        const contractCall = mintTx.result as ContractCallTransaction;
        expect(contractCall.contract_call.function_name).toBe('nft-mint?');
        expect(contractCall.sender_address).toBe('ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND');
        expect(contractCall.events[0].event_type).toBe('non_fungible_token_asset');
      }
    );
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
