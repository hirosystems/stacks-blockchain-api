import { Pool, PoolClient, Client, ClientBase, PoolConfig } from 'pg';
import {
  bufferToHexPrefixString,
  stopwatch,
  timeout,
  logger,
  logError,
  FoundOrNot,
  hexToBuffer,
} from '../helpers';
import { DbTx } from './common';
import {
  abiColumn,
  ContractTxQueryResult,
  getPgClientConfig,
  getSqlQueryString,
  isPgConnectionError,
  parseTxQueryResult,
  runMigrations,
  SQL_QUERY_LEAK_DETECTION,
  TX_COLUMNS,
} from './helpers';
import { PgPrimaryStore } from './pg-primary-store';
import { PgNotifier } from './postgres-notifier';

export class PgStoreFactory {
  // static create(): PgStore {
  //   //
  // }
}

export abstract class PgStore {
  readonly eventReplay: boolean;
  readonly pool: Pool;

  constructor(pool: Pool, eventReplay: boolean = false) {
    this.pool = pool;
    this.eventReplay = eventReplay;
  }

  static async connect({
    skipMigrations = false,
    withNotifier = true,
    eventReplay = false,
    usageName,
  }: {
    skipMigrations?: boolean;
    withNotifier?: boolean;
    eventReplay?: boolean;
    usageName: string;
  }): Promise<PgStore> {
    const initTimer = stopwatch();
    let connectionError: Error | undefined;
    let connectionOkay = false;
    let lastElapsedLog = 0;
    do {
      const clientConfig = getPgClientConfig({ usageName: `${usageName};init-connection-poll` });
      const client = new Client(clientConfig);
      try {
        await client.connect();
        connectionOkay = true;
        break;
      } catch (error: any) {
        const pgConnectionError = isPgConnectionError(error);
        if (!pgConnectionError) {
          logError('Cannot connect to pg', error);
          throw error;
        }
        const timeElapsed = initTimer.getElapsed();
        if (timeElapsed - lastElapsedLog > 2000) {
          lastElapsedLog = timeElapsed;
          logError('Pg connection failed, retrying..');
        }
        connectionError = error;
        await timeout(100);
      } finally {
        client.end(() => {});
      }
    } while (initTimer.getElapsed() < Number.MAX_SAFE_INTEGER);
    if (!connectionOkay) {
      connectionError = connectionError ?? new Error('Error connecting to database');
      throw connectionError;
    }

    if (!skipMigrations) {
      const clientConfig = getPgClientConfig({ usageName: `${usageName};schema-migrations` });
      await runMigrations(clientConfig);
    }
    let notifier: PgNotifier | undefined = undefined;
    if (withNotifier) {
      notifier = new PgNotifier(
        getPgClientConfig({ usageName: `${usageName}:notifier`, primary: true })
      );
    }
    const poolConfig: PoolConfig = getPgClientConfig({
      usageName: `${usageName};datastore-crud`,
      getPoolConfig: true,
    });
    const pool = new Pool(poolConfig);
    pool.on('error', error => {
      logger.error(`Postgres connection pool error: ${error.message}`, error);
    });
    const store = new PgPrimaryStore(pool, notifier, eventReplay);
    await store.connectPgNotifier();
    return store;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getConnectionApplicationName(): Promise<string> {
    const statResult = await this.query(async client => {
      const result = await client.query<{ application_name: string }>(
        // Get `application_name` for current connection (each connection has a unique PID)
        'select application_name from pg_stat_activity WHERE pid = pg_backend_pid()'
      );
      return result.rows[0].application_name;
    });
    return statResult;
  }

  /**
   * Execute queries against the connection pool.
   */
  async query<T>(cb: (client: ClientBase) => Promise<T>): Promise<T> {
    const client = await this.connectWithRetry();
    try {
      if (SQL_QUERY_LEAK_DETECTION) {
        // Monkey patch in some query leak detection. Taken from the lib's docs:
        // https://node-postgres.com/guides/project-structure
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const query = client.query;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const release = client.release;
        const lastQueries: any[] = [];
        const timeout = setTimeout(() => {
          const queries = lastQueries.map(q => getSqlQueryString(q));
          logger.error(`Pg client has been checked out for more than 5 seconds`);
          logger.error(`Last query: ${queries.join('|')}`);
        }, 5000);
        // @ts-expect-error hacky typing
        client.query = (...args) => {
          lastQueries.push(args[0]);
          // @ts-expect-error hacky typing
          return query.apply(client, args);
        };
        client.release = () => {
          clearTimeout(timeout);
          client.query = query;
          client.release = release;
          return release.apply(client);
        };
      }
      const result = await cb(client);
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Execute queries within a sql transaction.
   */
  async queryTx<T>(cb: (client: ClientBase) => Promise<T>): Promise<T> {
    return await this.query(async client => {
      try {
        await client.query('BEGIN');
        const result = await cb(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Creates a postgres pool client connection. If the connection fails due to a transient error, it is retried until successful.
   * You'd expect that the pg lib to handle this, but it doesn't, see https://github.com/brianc/node-postgres/issues/1789
   */
  protected async connectWithRetry(): Promise<PoolClient> {
    for (let retryAttempts = 1; ; retryAttempts++) {
      try {
        const client = await this.pool.connect();
        return client;
      } catch (error: any) {
        // Check for transient errors, and retry after 1 second
        const pgConnectionError = isPgConnectionError(error);
        if (pgConnectionError) {
          logger.warn(`${pgConnectionError}, will retry, attempt #${retryAttempts}`);
          await timeout(1000);
        } else {
          throw error;
        }
      }
    }
  }

  async getChainTip(
    client: ClientBase
  ): Promise<{ blockHeight: number; blockHash: string; indexBlockHash: string }> {
    const currentTipBlock = await client.query<{
      block_height: number;
      block_hash: Buffer;
      index_block_hash: Buffer;
    }>(
      // The `chain_tip` materialized view is not available during event replay.
      // Since `getChainTip()` is used heavily during event ingestion, we'll fall back to
      // a classic query.
      this.eventReplay
        ? `
          SELECT block_height, block_hash, index_block_hash
          FROM blocks
          WHERE canonical = true AND block_height = (SELECT MAX(block_height) FROM blocks)
          `
        : `SELECT block_height, block_hash, index_block_hash FROM chain_tip`
    );
    const height = currentTipBlock.rows[0]?.block_height ?? 0;
    return {
      blockHeight: height,
      blockHash: bufferToHexPrefixString(currentTipBlock.rows[0]?.block_hash ?? Buffer.from([])),
      indexBlockHash: bufferToHexPrefixString(
        currentTipBlock.rows[0]?.index_block_hash ?? Buffer.from([])
      ),
    };
  }

  async getTxStrict(args: { txId: string; indexBlockHash: string }): Promise<FoundOrNot<DbTx>> {
    return this.query(async client => {
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE tx_id = $1 AND index_block_hash = $2
        ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(args.txId), hexToBuffer(args.indexBlockHash)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      const tx = parseTxQueryResult(row);
      return { found: true, result: tx };
    });
  }
}
