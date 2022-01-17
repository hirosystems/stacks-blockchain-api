import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import PgMigrate, { RunnerOption } from 'node-pg-migrate';
import {
  Pool,
  PoolClient,
  ClientConfig,
  Client,
  ClientBase,
  QueryResult,
  QueryConfig,
  PoolConfig,
} from 'pg';
import * as pgCopyStreams from 'pg-copy-streams';
import * as PgCursor from 'pg-cursor';

import {
  parseArgBoolean,
  parsePort,
  APP_DIR,
  isTestEnv,
  isDevEnv,
  bufferToHexPrefixString,
  hexToBuffer,
  stopwatch,
  timeout,
  logger,
  logError,
  FoundOrNot,
  getOrAdd,
  assertNotNullish,
  batchIterate,
  distinctBy,
  unwrapOptional,
  pipelineAsync,
  isProdEnv,
  has0xPrefix,
  isValidPrincipal,
  isSmartContractTx,
} from '../helpers';
import {
  DataStore,
  DbBlock,
  DbTx,
  DbStxEvent,
  DbFtEvent,
  DbNftEvent,
  DbTxTypeId,
  DbSmartContractEvent,
  DbSmartContract,
  DbEvent,
  DbFaucetRequest,
  DataStoreEventEmitter,
  DbEventTypeId,
  DataStoreBlockUpdateData,
  DbFaucetRequestCurrency,
  DbMempoolTx,
  DbMempoolTxId,
  DbSearchResult,
  DbStxBalance,
  DbStxLockEvent,
  DbFtBalance,
  DbMinerReward,
  DbBurnchainReward,
  DbInboundStxTransfer,
  DbTxStatus,
  AddressNftEventIdentifier,
  DbRewardSlotHolder,
  DbBnsName,
  DbBnsNamespace,
  DbBnsZoneFile,
  DbBnsSubdomain,
  DbConfigState,
  DbTokenOfferingLocked,
  DbTxWithAssetTransfers,
  DataStoreMicroblockUpdateData,
  DbMicroblock,
  DbTxAnchorMode,
  DbGetBlockWithMetadataOpts,
  DbGetBlockWithMetadataResponse,
  DbMicroblockPartial,
  DataStoreTxEventData,
  DbRawEventRequest,
  BlockIdentifier,
  StxUnlockEvent,
  DbNonFungibleTokenMetadata,
  DbFungibleTokenMetadata,
  DbTokenMetadataQueueEntry,
  DbSearchResultWithMetadata,
  DbChainTip,
  NftHoldingInfo,
  NftHoldingInfoWithTxMetadata,
  NftEventWithTxMetadata,
  DbAssetEventTypeId,
} from './common';
import {
  AddressTokenOfferingLocked,
  TransactionType,
  AddressUnlockSchedule,
  Block,
} from '@stacks/stacks-blockchain-api-types';
import { getTxTypeId } from '../api/controllers/db-controller';
import { isProcessableTokenMetadata } from '../event-stream/tokens-contract-handler';
import { ClarityAbi } from '@stacks/transactions';
import {
  PgAddressNotificationPayload,
  PgBlockNotificationPayload,
  PgMicroblockNotificationPayload,
  PgNameNotificationPayload,
  PgNotifier,
  PgTokenMetadataNotificationPayload,
  PgTokensNotificationPayload,
  PgTxNotificationPayload,
} from './postgres-notifier';

const MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATIONS_DIR = path.join(APP_DIR, 'migrations');

type PgClientConfig = ClientConfig & { schema?: string };
export function getPgClientConfig(): PgClientConfig {
  const pgEnvVars = {
    database: process.env['PG_DATABASE'],
    user: process.env['PG_USER'],
    password: process.env['PG_PASSWORD'],
    host: process.env['PG_HOST'],
    port: process.env['PG_PORT'],
    ssl: process.env['PG_SSL'],
    schema: process.env['PG_SCHEMA'],
  };
  const pgConnectionUri = process.env['PG_CONNECTION_URI'];
  const pgConfigEnvVar = Object.entries(pgEnvVars).find(([, v]) => typeof v === 'string')?.[0];
  if (pgConfigEnvVar && pgConnectionUri) {
    throw new Error(
      `Both PG_CONNECTION_URI and ${pgConfigEnvVar} environmental variables are defined. PG_CONNECTION_URI must be defined without others or omitted.`
    );
  }
  if (pgConnectionUri) {
    const uri = new URL(pgConnectionUri);
    const searchParams = Object.fromEntries(
      [...uri.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v])
    );
    // Not really standardized
    const schema: string | undefined =
      searchParams['currentschema'] ??
      searchParams['current_schema'] ??
      searchParams['searchpath'] ??
      searchParams['search_path'] ??
      searchParams['schema'];
    const config: PgClientConfig = {
      connectionString: pgConnectionUri,
      schema,
    };
    return config;
  } else {
    const config: PgClientConfig = {
      database: pgEnvVars.database,
      user: pgEnvVars.user,
      password: pgEnvVars.password,
      host: pgEnvVars.host,
      port: parsePort(pgEnvVars.port),
      ssl: parseArgBoolean(pgEnvVars.ssl),
      schema: pgEnvVars.schema,
    };
    return config;
  }
}

export async function runMigrations(
  clientConfig: PgClientConfig = getPgClientConfig(),
  direction: 'up' | 'down' = 'up',
  opts?: {
    // Bypass the NODE_ENV check when performing a "down" migration which irreversibly drops data.
    dangerousAllowDataLoss?: boolean;
  }
): Promise<void> {
  if (!opts?.dangerousAllowDataLoss && direction !== 'up' && !isTestEnv && !isDevEnv) {
    throw new Error(
      'Whoa there! This is a testing function that will drop all data from PG. ' +
        'Set NODE_ENV to "test" or "development" to enable migration testing.'
    );
  }
  clientConfig = clientConfig ?? getPgClientConfig();
  const client = new Client(clientConfig);
  try {
    await client.connect();
    const runnerOpts: RunnerOption = {
      dbClient: client,
      ignorePattern: '.*map',
      dir: MIGRATIONS_DIR,
      direction: direction,
      migrationsTable: MIGRATIONS_TABLE,
      count: Infinity,
      logger: {
        info: msg => {},
        warn: msg => logger.warn(msg),
        error: msg => logger.error(msg),
      },
    };
    if (clientConfig.schema) {
      runnerOpts.schema = clientConfig.schema;
    }
    await PgMigrate(runnerOpts);
  } catch (error) {
    logError(`Error running pg-migrate`, error);
    throw error;
  } finally {
    await client.end();
  }
}

export async function cycleMigrations(opts?: {
  // Bypass the NODE_ENV check when performing a "down" migration which irreversibly drops data.
  dangerousAllowDataLoss?: boolean;
}): Promise<void> {
  const clientConfig = getPgClientConfig();

  await runMigrations(clientConfig, 'down', opts);
  await runMigrations(clientConfig, 'up', opts);
}

export async function dangerousDropAllTables(opts?: {
  acknowledgePotentialCatastrophicConsequences?: 'yes';
}) {
  if (opts?.acknowledgePotentialCatastrophicConsequences !== 'yes') {
    throw new Error('Dangerous usage error.');
  }
  const clientConfig = getPgClientConfig();
  const client = new Client(clientConfig);
  try {
    await client.connect();
    await client.query('BEGIN');
    const getTablesQuery = await client.query<{ table_name: string }>(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      AND table_catalog = $2
      AND table_type = 'BASE TABLE'
      `,
      [clientConfig.schema, clientConfig.database]
    );
    const tables = getTablesQuery.rows.map(r => r.table_name);
    for (const table of tables) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * @deprecated use `txColumns()` instead.
 */
const TX_COLUMNS = `
  -- required columns
  tx_id, raw_tx, tx_index, index_block_hash, parent_index_block_hash, block_hash, parent_block_hash, block_height, burn_block_time, parent_burn_block_time,
  type_id, anchor_mode, status, canonical, post_conditions, nonce, fee_rate, sponsored, sponsor_address, sender_address, origin_hash_mode,
  microblock_canonical, microblock_sequence, microblock_hash,

  -- token-transfer tx columns
  token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

  -- smart-contract tx columns
  smart_contract_contract_id, smart_contract_source_code,

  -- contract-call tx columns
  contract_call_contract_id, contract_call_function_name, contract_call_function_args,

  -- poison-microblock tx columns
  poison_microblock_header_1, poison_microblock_header_2,

  -- coinbase tx columns
  coinbase_payload,

  -- tx result
  raw_result,

  -- event count
  event_count,

  -- execution cost
  execution_cost_read_count, execution_cost_read_length, execution_cost_runtime, execution_cost_write_count, execution_cost_write_length
`;

const MEMPOOL_TX_COLUMNS = `
  -- required columns
  pruned, tx_id, raw_tx, type_id, anchor_mode, status, receipt_time,
  post_conditions, nonce, fee_rate, sponsored, sponsor_address, sender_address, origin_hash_mode,

  -- token-transfer tx columns
  token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

  -- smart-contract tx columns
  smart_contract_contract_id, smart_contract_source_code,

  -- contract-call tx columns
  contract_call_contract_id, contract_call_function_name, contract_call_function_args,

  -- poison-microblock tx columns
  poison_microblock_header_1, poison_microblock_header_2,

  -- coinbase tx columns
  coinbase_payload
`;

const BLOCK_COLUMNS = `
  block_hash, index_block_hash,
  parent_index_block_hash, parent_block_hash, parent_microblock_hash, parent_microblock_sequence,
  block_height, burn_block_time, burn_block_hash, burn_block_height, miner_txid, canonical,
  execution_cost_read_count, execution_cost_read_length, execution_cost_runtime,
  execution_cost_write_count, execution_cost_write_length
`;

const MICROBLOCK_COLUMNS = `
  canonical, microblock_canonical, microblock_hash, microblock_sequence, microblock_parent_hash,
  parent_index_block_hash, block_height, parent_block_height, parent_block_hash,
  parent_burn_block_height, parent_burn_block_time, parent_burn_block_hash,
  index_block_hash, block_hash
`;

const COUNT_COLUMN = `(COUNT(*) OVER())::integer AS count`;

/**
 * Shorthand function to generate a list of common columns to query from the `txs` table. A parameter
 * is specified in case the table is aliased into something else and a prefix is required.
 * @param tableName - Name of the table to query against. Defaults to `txs`.
 * @returns `string` - Column list to insert in SELECT statement.
 */
function txColumns(tableName: string = 'txs'): string {
  const columns: string[] = [
    // required columns
    'tx_id',
    'raw_tx',
    'tx_index',
    'index_block_hash',
    'parent_index_block_hash',
    'block_hash',
    'parent_block_hash',
    'block_height',
    'burn_block_time',
    'parent_burn_block_time',
    'type_id',
    'anchor_mode',
    'status',
    'canonical',
    'post_conditions',
    'nonce',
    'fee_rate',
    'sponsored',
    'sponsor_address',
    'sender_address',
    'origin_hash_mode',
    'microblock_canonical',
    'microblock_sequence',
    'microblock_hash',
    // token-transfer tx columns
    'token_transfer_recipient_address',
    'token_transfer_amount',
    'token_transfer_memo',
    // smart-contract tx columns
    'smart_contract_contract_id',
    'smart_contract_source_code',
    // contract-call tx columns
    'contract_call_contract_id',
    'contract_call_function_name',
    'contract_call_function_args',
    // poison-microblock tx columns
    'poison_microblock_header_1',
    'poison_microblock_header_2',
    // coinbase tx columns
    'coinbase_payload',
    // tx result
    'raw_result',
    // event count
    'event_count',
    // execution cost
    'execution_cost_read_count',
    'execution_cost_read_length',
    'execution_cost_runtime',
    'execution_cost_write_count',
    'execution_cost_write_length',
  ];
  return columns.map(c => `${tableName}.${c}`).join(',');
}

/**
 * Shorthand function that returns a column query to retrieve the smart contract abi when querying transactions
 * that may be of type `contract_call`. Usually used alongside `txColumns()`, `TX_COLUMNS` or `MEMPOOL_TX_COLUMNS`.
 * @param tableName - Name of the table that will determine the transaction type. Defaults to `txs`.
 * @returns `string` - abi column select statement portion
 */
function abiColumn(tableName: string = 'txs'): string {
  return `
    CASE WHEN ${tableName}.type_id = ${DbTxTypeId.ContractCall} THEN (
      SELECT abi
      FROM smart_contracts
      WHERE smart_contracts.contract_id = ${tableName}.contract_call_contract_id
      ORDER BY abi != 'null' DESC, canonical DESC, microblock_canonical DESC, block_height DESC
      LIMIT 1
    ) END as abi
    `;
}

interface BlockQueryResult {
  block_hash: Buffer;
  index_block_hash: Buffer;
  parent_index_block_hash: Buffer;
  parent_block_hash: Buffer;
  parent_microblock_hash: Buffer;
  parent_microblock_sequence: number;
  block_height: number;
  burn_block_time: number;
  burn_block_hash: Buffer;
  burn_block_height: number;
  miner_txid: Buffer;
  canonical: boolean;
  execution_cost_read_count: string;
  execution_cost_read_length: string;
  execution_cost_runtime: string;
  execution_cost_write_count: string;
  execution_cost_write_length: string;
}

interface MicroblockQueryResult {
  canonical: boolean;
  microblock_canonical: boolean;
  microblock_hash: Buffer;
  microblock_sequence: number;
  microblock_parent_hash: Buffer;
  parent_index_block_hash: Buffer;
  block_height: number;
  parent_block_height: number;
  parent_block_hash: Buffer;
  index_block_hash: Buffer;
  block_hash: Buffer;
  parent_burn_block_height: number;
  parent_burn_block_hash: Buffer;
  parent_burn_block_time: number;
}

interface MempoolTxQueryResult {
  pruned: boolean;
  tx_id: Buffer;

  nonce: number;
  type_id: number;
  anchor_mode: number;
  status: number;
  receipt_time: number;

  canonical: boolean;
  post_conditions: Buffer;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;
  raw_tx: Buffer;

  // `token_transfer` tx types
  token_transfer_recipient_address?: string;
  token_transfer_amount?: string;
  token_transfer_memo?: Buffer;

  // `smart_contract` tx types
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  // `contract_call` tx types
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  contract_call_function_args?: Buffer;

  // `poison_microblock` tx types
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  // `coinbase` tx types
  coinbase_payload?: Buffer;

  // sending abi in case tx is contract call
  abi?: string;
}

interface TxQueryResult {
  tx_id: Buffer;
  tx_index: number;
  index_block_hash: Buffer;
  parent_index_block_hash: Buffer;
  block_hash: Buffer;
  parent_block_hash: Buffer;
  block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;
  nonce: number;
  type_id: number;
  anchor_mode: number;
  status: number;
  raw_result: Buffer;
  canonical: boolean;

  microblock_canonical: boolean;
  microblock_sequence: number;
  microblock_hash: Buffer;

  post_conditions: Buffer;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;
  raw_tx: Buffer;

  // `token_transfer` tx types
  token_transfer_recipient_address?: string;
  token_transfer_amount?: string;
  token_transfer_memo?: Buffer;

  // `smart_contract` tx types
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  // `contract_call` tx types
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  contract_call_function_args?: Buffer;

  // `poison_microblock` tx types
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  // `coinbase` tx types
  coinbase_payload?: Buffer;

  // events count
  event_count: number;

  execution_cost_read_count: string;
  execution_cost_read_length: string;
  execution_cost_runtime: string;
  execution_cost_write_count: string;
  execution_cost_write_length: string;
}

interface ContractTxQueryResult extends TxQueryResult {
  abi?: string;
}

interface MempoolTxIdQueryResult {
  tx_id: Buffer;
}
interface FaucetRequestQueryResult {
  currency: string;
  ip: string;
  address: string;
  occurred_at: string;
}

interface UpdatedEntities {
  markedCanonical: {
    blocks: number;
    microblocks: number;
    minerRewards: number;
    txs: number;
    stxLockEvents: number;
    stxEvents: number;
    ftEvents: number;
    nftEvents: number;
    contractLogs: number;
    smartContracts: number;
    names: number;
    namespaces: number;
    subdomains: number;
  };
  markedNonCanonical: {
    blocks: number;
    microblocks: number;
    minerRewards: number;
    txs: number;
    stxLockEvents: number;
    stxEvents: number;
    ftEvents: number;
    nftEvents: number;
    contractLogs: number;
    smartContracts: number;
    names: number;
    namespaces: number;
    subdomains: number;
  };
}

interface TransferQueryResult {
  sender: string;
  memo: Buffer;
  block_height: number;
  tx_index: number;
  tx_id: Buffer;
  transfer_type: string;
  amount: string;
}

interface NonFungibleTokenMetadataQueryResult {
  token_uri: string;
  name: string;
  description: string;
  image_uri: string;
  image_canonical_uri: string;
  contract_id: string;
  tx_id: Buffer;
  sender_address: string;
}

interface FungibleTokenMetadataQueryResult {
  token_uri: string;
  name: string;
  description: string;
  image_uri: string;
  image_canonical_uri: string;
  contract_id: string;
  symbol: string;
  decimals: number;
  tx_id: Buffer;
  sender_address: string;
}

interface DbTokenMetadataQueueEntryQuery {
  queue_id: number;
  tx_id: Buffer;
  contract_id: string;
  contract_abi: string;
  block_height: number;
  processed: boolean;
}

export interface RawTxQueryResult {
  raw_tx: Buffer;
}

class MicroblockGapError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = this.constructor.name;
  }
}

// Enable this when debugging potential sql leaks.
const SQL_QUERY_LEAK_DETECTION = false;

// Tables containing tx metadata, like events (stx, ft, nft transfers), contract logs, bns data, etc.
const TX_METADATA_TABLES = [
  'stx_events',
  'ft_events',
  'nft_events',
  'contract_logs',
  'stx_lock_events',
  'smart_contracts',
  'names',
  'namespaces',
  'subdomains',
] as const;

function getSqlQueryString(query: QueryConfig | string): string {
  if (typeof query === 'string') {
    return query;
  } else {
    return query.text;
  }
}

export class PgDataStore
  extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  readonly pool: Pool;
  readonly notifier?: PgNotifier;
  readonly eventReplay: boolean;
  private constructor(
    pool: Pool,
    notifier: PgNotifier | undefined = undefined,
    eventReplay: boolean = false
  ) {
    // eslint-disable-next-line constructor-super
    super();
    this.pool = pool;
    this.notifier = notifier;
    this.eventReplay = eventReplay;
  }

  /**
   * Connects to the `PgNotifier`. Its messages will be forwarded to the rest of the API components
   * though the EventEmitter.
   */
  async connectPgNotifier() {
    await this.notifier?.connect(notification => {
      switch (notification.type) {
        case 'blockUpdate':
          const block = notification.payload as PgBlockNotificationPayload;
          this.emit('blockUpdate', block.blockHash);
          break;
        case 'microblockUpdate':
          const microblock = notification.payload as PgMicroblockNotificationPayload;
          this.emit('microblockUpdate', microblock.microblockHash);
          break;
        case 'txUpdate':
          const tx = notification.payload as PgTxNotificationPayload;
          this.emit('txUpdate', tx.txId);
          break;
        case 'addressUpdate':
          const address = notification.payload as PgAddressNotificationPayload;
          this.emit('addressUpdate', address.address, address.blockHeight);
          break;
        case 'tokensUpdate':
          const tokens = notification.payload as PgTokensNotificationPayload;
          this.emit('tokensUpdate', tokens.contractID);
          break;
        case 'nameUpdate':
          const name = notification.payload as PgNameNotificationPayload;
          this.emit('nameUpdate', name.nameInfo);
          break;
        case 'tokenMetadataUpdateQueued':
          const metadata = notification.payload as PgTokenMetadataNotificationPayload;
          this.emit('tokenMetadataUpdateQueued', metadata.entry);
          break;
      }
    });
  }

  /**
   * Creates a postgres pool client connection. If the connection fails due to a transient error, it is retried until successful.
   * You'd expect that the pg lib to handle this, but it doesn't, see https://github.com/brianc/node-postgres/issues/1789
   */
  async connectWithRetry(): Promise<PoolClient> {
    for (let retryAttempts = 1; ; retryAttempts++) {
      try {
        const client = await this.pool.connect();
        return client;
      } catch (error: any) {
        // Check for transient errors, and retry after 1 second
        if (error.code === 'ECONNREFUSED') {
          logger.warn(`Postgres connection ECONNREFUSED, will retry, attempt #${retryAttempts}`);
          await timeout(1000);
        } else if (error.code === 'ETIMEDOUT') {
          logger.warn(`Postgres connection ETIMEDOUT, will retry, attempt #${retryAttempts}`);
          await timeout(1000);
        } else if (error.message === 'the database system is starting up') {
          logger.warn(
            `Postgres connection failed while database system is restarting, will retry, attempt #${retryAttempts}`
          );
          await timeout(1000);
        } else if (error.message === 'Connection terminated unexpectedly') {
          logger.warn(
            `Postgres connection terminated unexpectedly, will retry, attempt #${retryAttempts}`
          );
          await timeout(1000);
        } else {
          throw error;
        }
      }
    }
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

  async storeRawEventRequest(eventPath: string, payload: string): Promise<void> {
    await this.query(async client => {
      const insertResult = await client.query<{ id: string }>(
        `
        INSERT INTO event_observer_requests(
          event_path, payload
        ) values($1, $2)
        RETURNING id
        `,
        [eventPath, payload]
      );
      if (insertResult.rowCount !== 1) {
        throw new Error(
          `Unexpected row count ${insertResult.rowCount} when storing event_observer_requests entry`
        );
      }
      const exportEventsFile = process.env['STACKS_EXPORT_EVENTS_FILE'];
      if (exportEventsFile) {
        const writeStream = fs.createWriteStream(exportEventsFile, {
          flags: 'a', // append or create if not exists
        });
        try {
          const queryStream = client.query(
            pgCopyStreams.to(
              `COPY (SELECT * FROM event_observer_requests WHERE id = ${insertResult.rows[0].id}) TO STDOUT ENCODING 'UTF8'`
            )
          );
          await pipelineAsync(queryStream, writeStream);
        } finally {
          writeStream.close();
        }
      }
    });
  }

  static async exportRawEventRequests(targetStream: Writable): Promise<void> {
    const pg = await this.connect(true);
    try {
      await pg.query(async client => {
        const copyQuery = pgCopyStreams.to(
          `
          COPY (SELECT id, receive_timestamp, event_path, payload FROM event_observer_requests ORDER BY id ASC)
          TO STDOUT ENCODING 'UTF8'
          `
        );
        const queryStream = client.query(copyQuery);
        await pipelineAsync(queryStream, targetStream);
      });
    } finally {
      await pg.close();
    }
  }

  static async *getRawEventRequests(
    readStream: Readable,
    onStatusUpdate?: (msg: string) => void
  ): AsyncGenerator<DbRawEventRequest[], void, unknown> {
    // 1. Pipe input stream into a temp table
    // 2. Use `pg-cursor` to async read rows from temp table (order by `id` ASC)
    // 3. Drop temp table
    // 4. Close db connection
    const pg = await this.connect(true);
    try {
      const client = await pg.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `
          CREATE TEMPORARY TABLE temp_event_observer_requests(
            id bigint PRIMARY KEY,
            receive_timestamp timestamptz NOT NULL,
            event_path text NOT NULL,
            payload jsonb NOT NULL
          ) ON COMMIT DROP
          `
        );
        onStatusUpdate?.('Importing raw event requests into temporary table...');
        const importStream = client.query(
          pgCopyStreams.from(`COPY temp_event_observer_requests FROM STDIN`)
        );
        await pipelineAsync(readStream, importStream);
        const totalRowCountQuery = await client.query<{ count: string }>(
          `SELECT COUNT(id) count FROM temp_event_observer_requests`
        );
        const totalRowCount = parseInt(totalRowCountQuery.rows[0].count);
        let lastStatusUpdatePercent = 0;
        onStatusUpdate?.('Streaming raw event requests from temporary table...');
        const cursor = new PgCursor<{ id: string; event_path: string; payload: string }>(
          `
          SELECT id, event_path, payload::text
          FROM temp_event_observer_requests
          ORDER BY id ASC
          `
        );
        const cursorQuery = client.query(cursor);
        const rowBatchSize = 100;
        let rowsReadCount = 0;
        let rows: DbRawEventRequest[] = [];
        do {
          rows = await new Promise<DbRawEventRequest[]>((resolve, reject) => {
            cursorQuery.read(rowBatchSize, (error, rows) => {
              if (error) {
                reject(error);
              } else {
                rowsReadCount += rows.length;
                if ((rowsReadCount / totalRowCount) * 100 > lastStatusUpdatePercent + 1) {
                  lastStatusUpdatePercent = Math.floor((rowsReadCount / totalRowCount) * 100);
                  onStatusUpdate?.(
                    `Raw event requests processed: ${lastStatusUpdatePercent}% (${rowsReadCount} / ${totalRowCount})`
                  );
                }
                resolve(rows);
              }
            });
          });
          if (rows.length > 0) {
            yield rows;
          }
        } while (rows.length > 0);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await pg.close();
    }
  }

  static async containsAnyRawEventRequests(): Promise<boolean> {
    const pg = await this.connect(true);
    try {
      return await pg.query(async client => {
        try {
          const result = await client.query('SELECT id from event_observer_requests LIMIT 1');
          return result.rowCount > 0;
        } catch (error: any) {
          if (error.message?.includes('does not exist')) {
            return false;
          }
          throw error;
        }
      });
    } finally {
      await pg.close();
    }
  }

  async getChainTip(
    client: ClientBase,
    checkMissingChainTip?: boolean
  ): Promise<{ blockHeight: number; blockHash: string; indexBlockHash: string }> {
    const currentTipBlock = await client.query<{
      block_height: number;
      block_hash: Buffer;
      index_block_hash: Buffer;
    }>(
      `
      SELECT block_height, block_hash, index_block_hash
      FROM blocks
      WHERE canonical = true AND block_height = (SELECT MAX(block_height) FROM blocks)
      `
    );
    if (checkMissingChainTip && currentTipBlock.rowCount === 0) {
      throw new Error(`No canonical block exists. The node is likely still syncing.`);
    }
    const height = currentTipBlock.rows[0]?.block_height ?? 0;
    return {
      blockHeight: height,
      blockHash: bufferToHexPrefixString(currentTipBlock.rows[0]?.block_hash ?? Buffer.from([])),
      indexBlockHash: bufferToHexPrefixString(
        currentTipBlock.rows[0]?.index_block_hash ?? Buffer.from([])
      ),
    };
  }

  async updateMicroblocks(data: DataStoreMicroblockUpdateData): Promise<void> {
    try {
      await this.updateMicroblocksInternal(data);
    } catch (error) {
      if (error instanceof MicroblockGapError) {
        // Log and ignore this error for now, see https://github.com/blockstack/stacks-blockchain/issues/2850
        // for more details.
        // In theory it would be possible for the API to cache out-of-order microblock data and use it to
        // restore data in this condition, but it would require several changes to sensitive re-org code,
        // as well as introduce a new kind of statefulness and responsibility to the API.
        logger.warn(error.message);
      } else {
        throw error;
      }
    }
  }

  async updateMicroblocksInternal(data: DataStoreMicroblockUpdateData): Promise<void> {
    await this.queryTx(async client => {
      // Sanity check: ensure incoming microblocks have a `parent_index_block_hash` that matches the API's
      // current known canonical chain tip. We assume this holds true so incoming microblock data is always
      // treated as being built off the current canonical anchor block.
      const chainTip = await this.getChainTip(client);
      const nonCanonicalMicroblock = data.microblocks.find(
        mb => mb.parent_index_block_hash !== chainTip.indexBlockHash
      );
      // Note: the stacks-node event emitter can send old microblocks that have already been processed by a previous anchor block.
      // Log warning and return, nothing to do.
      if (nonCanonicalMicroblock) {
        logger.info(
          `Failure in microblock ingestion, microblock ${nonCanonicalMicroblock.microblock_hash} ` +
            `points to parent index block hash ${nonCanonicalMicroblock.parent_index_block_hash} rather ` +
            `than the current canonical tip's index block hash ${chainTip.indexBlockHash}.`
        );
        return;
      }

      // The block height is just one after the current chain tip height
      const blockHeight = chainTip.blockHeight + 1;
      const dbMicroblocks = data.microblocks.map(mb => {
        const dbMicroBlock: DbMicroblock = {
          canonical: true,
          microblock_canonical: true,
          microblock_hash: mb.microblock_hash,
          microblock_sequence: mb.microblock_sequence,
          microblock_parent_hash: mb.microblock_parent_hash,
          parent_index_block_hash: mb.parent_index_block_hash,
          parent_burn_block_height: mb.parent_burn_block_height,
          parent_burn_block_hash: mb.parent_burn_block_hash,
          parent_burn_block_time: mb.parent_burn_block_time,
          block_height: blockHeight,
          parent_block_height: chainTip.blockHeight,
          parent_block_hash: chainTip.blockHash,
          index_block_hash: '', // Empty until microblock is confirmed in an anchor block
          block_hash: '', // Empty until microblock is confirmed in an anchor block
        };
        return dbMicroBlock;
      });

      const txs: DataStoreTxEventData[] = [];

      for (const entry of data.txs) {
        // Note: the properties block_hash and burn_block_time are empty here because the anchor block with that data doesn't yet exist.
        const dbTx: DbTx = {
          ...entry.tx,
          parent_block_hash: chainTip.blockHash,
          block_height: blockHeight,
        };

        // Set all the `block_height` properties for the related tx objects, since it wasn't known
        // when creating the objects using only the stacks-node message payload.
        txs.push({
          tx: dbTx,
          stxEvents: entry.stxEvents.map(e => ({ ...e, block_height: blockHeight })),
          contractLogEvents: entry.contractLogEvents.map(e => ({
            ...e,
            block_height: blockHeight,
          })),
          stxLockEvents: entry.stxLockEvents.map(e => ({ ...e, block_height: blockHeight })),
          ftEvents: entry.ftEvents.map(e => ({ ...e, block_height: blockHeight })),
          nftEvents: entry.nftEvents.map(e => ({ ...e, block_height: blockHeight })),
          smartContracts: entry.smartContracts.map(e => ({ ...e, block_height: blockHeight })),
          names: entry.names.map(e => ({ ...e, registered_at: blockHeight })),
          namespaces: entry.namespaces.map(e => ({ ...e, ready_block: blockHeight })),
        });
      }

      await this.insertMicroblockData(client, dbMicroblocks, txs);

      // Find any microblocks that have been orphaned by this latest microblock chain tip.
      // This function also checks that each microblock parent hash points to an existing microblock in the db.
      const currentMicroblockTip = dbMicroblocks[dbMicroblocks.length - 1];
      const unanchoredMicroblocksAtTip = await this.findUnanchoredMicroblocksAtChainTip(
        client,
        currentMicroblockTip.parent_index_block_hash,
        blockHeight,
        currentMicroblockTip
      );
      if ('microblockGap' in unanchoredMicroblocksAtTip) {
        // Throw in order to trigger a SQL tx rollback to undo and db writes so far, but catch, log, and ignore this specific error.
        throw new MicroblockGapError(
          `Gap in parent microblock stream for ${currentMicroblockTip.microblock_hash}, missing microblock ${unanchoredMicroblocksAtTip.missingMicroblockHash}, the oldest microblock ${unanchoredMicroblocksAtTip.oldestParentMicroblockHash} found in the chain has sequence ${unanchoredMicroblocksAtTip.oldestParentMicroblockSequence} rather than 0`
        );
      }
      const { orphanedMicroblocks } = unanchoredMicroblocksAtTip;
      if (orphanedMicroblocks.length > 0) {
        // Handle microblocks reorgs here, these _should_ only be micro-forks off the same same
        // unanchored chain tip, e.g. a leader orphaning it's own unconfirmed microblocks
        const microOrphanResult = await this.handleMicroReorg(client, {
          isCanonical: true,
          isMicroCanonical: false,
          indexBlockHash: '',
          blockHash: '',
          burnBlockTime: -1,
          microblocks: orphanedMicroblocks,
        });
        const microOrphanedTxs = microOrphanResult.updatedTxs;
        // Restore any micro-orphaned txs into the mempool
        const restoredMempoolTxs = await this.restoreMempoolTxs(
          client,
          microOrphanedTxs.map(tx => tx.tx_id)
        );
        restoredMempoolTxs.restoredTxs.forEach(txId => {
          logger.info(`Restored micro-orphaned tx to mempool ${txId}`);
        });
      }

      const candidateTxIds = data.txs.map(d => d.tx.tx_id);
      const removedTxsResult = await this.pruneMempoolTxs(client, candidateTxIds);
      if (removedTxsResult.removedTxs.length > 0) {
        logger.verbose(
          `Removed ${removedTxsResult.removedTxs.length} microblock-txs from mempool table during microblock ingestion`
        );
      }

      await this.refreshNftCustody(client, txs, true);

      if (this.notifier) {
        dbMicroblocks.forEach(async microblock => {
          await this.notifier?.sendMicroblock({ microblockHash: microblock.microblock_hash });
        });
        txs.forEach(async txData => {
          await this.notifier?.sendTx({ txId: txData.tx.tx_id });
        });
        this.emitAddressTxUpdates(data.txs);
      }
    });
  }

  async update(data: DataStoreBlockUpdateData): Promise<void> {
    const tokenMetadataQueueEntries: DbTokenMetadataQueueEntry[] = [];
    await this.queryTx(async client => {
      const chainTip = await this.getChainTip(client);
      await this.handleReorg(client, data.block, chainTip.blockHeight);
      // If the incoming block is not of greater height than current chain tip, then store data as non-canonical.
      const isCanonical = data.block.block_height > chainTip.blockHeight;
      if (!isCanonical) {
        data.block = { ...data.block, canonical: false };
        data.microblocks = data.microblocks.map(mb => ({ ...mb, canonical: false }));
        data.txs = data.txs.map(tx => ({
          tx: { ...tx.tx, canonical: false },
          stxLockEvents: tx.stxLockEvents.map(e => ({ ...e, canonical: false })),
          stxEvents: tx.stxEvents.map(e => ({ ...e, canonical: false })),
          ftEvents: tx.ftEvents.map(e => ({ ...e, canonical: false })),
          nftEvents: tx.nftEvents.map(e => ({ ...e, canonical: false })),
          contractLogEvents: tx.contractLogEvents.map(e => ({ ...e, canonical: false })),
          smartContracts: tx.smartContracts.map(e => ({ ...e, canonical: false })),
          names: tx.names.map(e => ({ ...e, canonical: false })),
          namespaces: tx.namespaces.map(e => ({ ...e, canonical: false })),
        }));
        data.minerRewards = data.minerRewards.map(mr => ({ ...mr, canonical: false }));
      } else {
        // When storing newly mined canonical txs, remove them from the mempool table.
        const candidateTxIds = data.txs.map(d => d.tx.tx_id);
        const removedTxsResult = await this.pruneMempoolTxs(client, candidateTxIds);
        if (removedTxsResult.removedTxs.length > 0) {
          logger.verbose(
            `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during new block ingestion`
          );
        }
      }

      //calculate total execution cost of the block
      const totalCost = data.txs.reduce(
        (previousValue, currentValue) => {
          const {
            execution_cost_read_count,
            execution_cost_read_length,
            execution_cost_runtime,
            execution_cost_write_count,
            execution_cost_write_length,
          } = previousValue;

          return {
            execution_cost_read_count:
              execution_cost_read_count + currentValue.tx.execution_cost_read_count,
            execution_cost_read_length:
              execution_cost_read_length + currentValue.tx.execution_cost_read_length,
            execution_cost_runtime: execution_cost_runtime + currentValue.tx.execution_cost_runtime,
            execution_cost_write_count:
              execution_cost_write_count + currentValue.tx.execution_cost_write_count,
            execution_cost_write_length:
              execution_cost_write_length + currentValue.tx.execution_cost_write_length,
          };
        },
        {
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        }
      );

      data.block.execution_cost_read_count = totalCost.execution_cost_read_count;
      data.block.execution_cost_read_length = totalCost.execution_cost_read_length;
      data.block.execution_cost_runtime = totalCost.execution_cost_runtime;
      data.block.execution_cost_write_count = totalCost.execution_cost_write_count;
      data.block.execution_cost_write_length = totalCost.execution_cost_write_length;

      let batchedTxData: DataStoreTxEventData[] = data.txs;

      // Find microblocks that weren't already inserted via the unconfirmed microblock event.
      // This happens when a stacks-node is syncing and receives confirmed microblocks with their anchor block at the same time.
      if (data.microblocks.length > 0) {
        const existingMicroblocksQuery = await client.query<{ microblock_hash: Buffer }>(
          `
          SELECT microblock_hash
          FROM microblocks
          WHERE parent_index_block_hash = $1 AND microblock_hash = ANY($2)
          `,
          [
            hexToBuffer(data.block.parent_index_block_hash),
            data.microblocks.map(mb => hexToBuffer(mb.microblock_hash)),
          ]
        );
        const existingMicroblockHashes = new Set(
          existingMicroblocksQuery.rows.map(r => bufferToHexPrefixString(r.microblock_hash))
        );

        const missingMicroblocks = data.microblocks.filter(
          mb => !existingMicroblockHashes.has(mb.microblock_hash)
        );
        if (missingMicroblocks.length > 0) {
          const missingMicroblockHashes = new Set(missingMicroblocks.map(mb => mb.microblock_hash));
          const missingTxs = data.txs.filter(entry =>
            missingMicroblockHashes.has(entry.tx.microblock_hash)
          );
          await this.insertMicroblockData(client, missingMicroblocks, missingTxs);

          // Clear already inserted microblock txs from the anchor-block update data to avoid duplicate inserts.
          batchedTxData = batchedTxData.filter(entry => {
            return !missingMicroblockHashes.has(entry.tx.microblock_hash);
          });
        }
      }

      // When processing an immediately-non-canonical block, do not orphan and possible existing microblocks
      // which may be still considered canonical by the canonical block at this height.
      if (isCanonical) {
        const { acceptedMicroblockTxs, orphanedMicroblockTxs } = await this.updateMicroCanonical(
          client,
          {
            isCanonical: isCanonical,
            blockHeight: data.block.block_height,
            blockHash: data.block.block_hash,
            indexBlockHash: data.block.index_block_hash,
            parentIndexBlockHash: data.block.parent_index_block_hash,
            parentMicroblockHash: data.block.parent_microblock_hash,
            parentMicroblockSequence: data.block.parent_microblock_sequence,
            burnBlockTime: data.block.burn_block_time,
          }
        );

        // Identify any micro-orphaned txs that also didn't make it into this anchor block, and restore them into the mempool
        const orphanedAndMissingTxs = orphanedMicroblockTxs.filter(
          tx => !data.txs.find(r => tx.tx_id === r.tx.tx_id)
        );
        const restoredMempoolTxs = await this.restoreMempoolTxs(
          client,
          orphanedAndMissingTxs.map(tx => tx.tx_id)
        );
        restoredMempoolTxs.restoredTxs.forEach(txId => {
          logger.info(`Restored micro-orphaned tx to mempool ${txId}`);
        });

        // Clear accepted microblock txs from the anchor-block update data to avoid duplicate inserts.
        batchedTxData = batchedTxData.filter(entry => {
          const matchingTx = acceptedMicroblockTxs.find(tx => tx.tx_id === entry.tx.tx_id);
          return !matchingTx;
        });
      }

      // TODO(mb): sanity tests on tx_index on batchedTxData, re-normalize if necessary

      // TODO(mb): copy the batchedTxData to outside the sql transaction fn so they can be emitted in txUpdate event below

      const blocksUpdated = await this.updateBlock(client, data.block);
      if (blocksUpdated !== 0) {
        for (const minerRewards of data.minerRewards) {
          await this.updateMinerReward(client, minerRewards);
        }
        for (const entry of batchedTxData) {
          await this.updateTx(client, entry.tx);
          await this.updateBatchStxEvents(client, entry.tx, entry.stxEvents);
          await this.updatePrincipalStxTxs(client, entry.tx, entry.stxEvents);
          await this.updateBatchSmartContractEvent(client, entry.tx, entry.contractLogEvents);
          for (const stxLockEvent of entry.stxLockEvents) {
            await this.updateStxLockEvent(client, entry.tx, stxLockEvent);
          }
          for (const ftEvent of entry.ftEvents) {
            await this.updateFtEvent(client, entry.tx, ftEvent);
          }
          for (const nftEvent of entry.nftEvents) {
            await this.updateNftEvent(client, entry.tx, nftEvent);
          }
          for (const smartContract of entry.smartContracts) {
            await this.updateSmartContract(client, entry.tx, smartContract);
          }
          for (const bnsName of entry.names) {
            await this.updateNames(client, entry.tx, bnsName);
          }
          for (const namespace of entry.namespaces) {
            await this.updateNamespaces(client, entry.tx, namespace);
          }
        }
        await this.refreshNftCustody(client, batchedTxData);

        const tokenContractDeployments = data.txs
          .filter(entry => entry.tx.type_id === DbTxTypeId.SmartContract)
          .filter(entry => entry.tx.status === DbTxStatus.Success)
          .map(entry => {
            const smartContract = entry.smartContracts[0];
            const contractAbi: ClarityAbi = JSON.parse(smartContract.abi);
            const queueEntry: DbTokenMetadataQueueEntry = {
              queueId: -1,
              txId: entry.tx.tx_id,
              contractId: smartContract.contract_id,
              contractAbi: contractAbi,
              blockHeight: entry.tx.block_height,
              processed: false,
            };
            return queueEntry;
          })
          .filter(entry => isProcessableTokenMetadata(entry.contractAbi));
        for (const pendingQueueEntry of tokenContractDeployments) {
          const queueEntry = await this.updateTokenMetadataQueue(client, pendingQueueEntry);
          tokenMetadataQueueEntries.push(queueEntry);
        }
      }
    });

    // Skip sending `PgNotifier` updates altogether if we're in the genesis block since this block is the
    // event replay of the v1 blockchain.
    if ((data.block.block_height > 1 || !isProdEnv) && this.notifier) {
      await this.notifier?.sendBlock({ blockHash: data.block.block_hash });
      data.txs.forEach(async entry => {
        await this.notifier?.sendTx({ txId: entry.tx.tx_id });
      });
      this.emitAddressTxUpdates(data.txs);
      for (const tokenMetadataQueueEntry of tokenMetadataQueueEntries) {
        await this.notifier?.sendTokenMetadata({ entry: tokenMetadataQueueEntry });
      }
    }
  }

  async updateMicroCanonical(
    client: ClientBase,
    blockData: {
      isCanonical: boolean;
      blockHeight: number;
      blockHash: string;
      indexBlockHash: string;
      parentIndexBlockHash: string;
      parentMicroblockHash: string;
      parentMicroblockSequence: number;
      burnBlockTime: number;
    }
  ): Promise<{
    acceptedMicroblockTxs: DbTx[];
    orphanedMicroblockTxs: DbTx[];
    acceptedMicroblocks: string[];
    orphanedMicroblocks: string[];
  }> {
    // Find the parent microblock if this anchor block points to one. If not, perform a sanity check for expected block headers in this case:
    // > Anchored blocks that do not have parent microblock streams will have their parent microblock header hashes set to all 0's, and the parent microblock sequence number set to 0.
    let acceptedMicroblockTip: DbMicroblock | undefined;
    if (BigInt(blockData.parentMicroblockHash) === 0n) {
      if (blockData.parentMicroblockSequence !== 0) {
        throw new Error(
          `Anchor block has a parent microblock sequence of ${blockData.parentMicroblockSequence} but the microblock parent of ${blockData.parentMicroblockHash}.`
        );
      }
      acceptedMicroblockTip = undefined;
    } else {
      const microblockTipQuery = await client.query<MicroblockQueryResult>(
        `
        SELECT ${MICROBLOCK_COLUMNS} FROM microblocks
        WHERE parent_index_block_hash = $1 AND microblock_hash = $2
        `,
        [hexToBuffer(blockData.parentIndexBlockHash), hexToBuffer(blockData.parentMicroblockHash)]
      );
      if (microblockTipQuery.rowCount === 0) {
        throw new Error(
          `Could not find microblock ${blockData.parentMicroblockHash} while processing anchor block chain tip`
        );
      }
      acceptedMicroblockTip = this.parseMicroblockQueryResult(microblockTipQuery.rows[0]);
    }

    // Identify microblocks that were either accepted or orphaned by this anchor block.
    const unanchoredMicroblocksAtTip = await this.findUnanchoredMicroblocksAtChainTip(
      client,
      blockData.parentIndexBlockHash,
      blockData.blockHeight,
      acceptedMicroblockTip
    );
    if ('microblockGap' in unanchoredMicroblocksAtTip) {
      throw new Error(
        `Gap in parent microblock stream for block ${blockData.blockHash}, missing microblock ${unanchoredMicroblocksAtTip.missingMicroblockHash}, the oldest microblock ${unanchoredMicroblocksAtTip.oldestParentMicroblockHash} found in the chain has sequence ${unanchoredMicroblocksAtTip.oldestParentMicroblockSequence} rather than 0`
      );
    }

    const { acceptedMicroblocks, orphanedMicroblocks } = unanchoredMicroblocksAtTip;

    let orphanedMicroblockTxs: DbTx[] = [];
    if (orphanedMicroblocks.length > 0) {
      const microOrphanResult = await this.handleMicroReorg(client, {
        isCanonical: blockData.isCanonical,
        isMicroCanonical: false,
        indexBlockHash: blockData.indexBlockHash,
        blockHash: blockData.blockHash,
        burnBlockTime: blockData.burnBlockTime,
        microblocks: orphanedMicroblocks,
      });
      orphanedMicroblockTxs = microOrphanResult.updatedTxs;
    }
    let acceptedMicroblockTxs: DbTx[] = [];
    if (acceptedMicroblocks.length > 0) {
      const microAcceptResult = await this.handleMicroReorg(client, {
        isCanonical: blockData.isCanonical,
        isMicroCanonical: true,
        indexBlockHash: blockData.indexBlockHash,
        blockHash: blockData.blockHash,
        burnBlockTime: blockData.burnBlockTime,
        microblocks: acceptedMicroblocks,
      });
      acceptedMicroblockTxs = microAcceptResult.updatedTxs;
    }

    return {
      acceptedMicroblockTxs,
      orphanedMicroblockTxs,
      acceptedMicroblocks,
      orphanedMicroblocks,
    };
  }

  async insertMicroblockData(
    client: ClientBase,
    microblocks: DbMicroblock[],
    txs: DataStoreTxEventData[]
  ): Promise<void> {
    for (const mb of microblocks) {
      await client.query(
        `
        INSERT INTO microblocks(
          canonical, microblock_canonical, microblock_hash, microblock_sequence, microblock_parent_hash,
          parent_index_block_hash, block_height, parent_block_height, parent_block_hash, index_block_hash, block_hash,
          parent_burn_block_height, parent_burn_block_hash, parent_burn_block_time
        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          mb.canonical,
          mb.microblock_canonical,
          hexToBuffer(mb.microblock_hash),
          mb.microblock_sequence,
          hexToBuffer(mb.microblock_parent_hash),
          hexToBuffer(mb.parent_index_block_hash),
          mb.block_height,
          mb.parent_block_height,
          hexToBuffer(mb.parent_block_hash),
          hexToBuffer(mb.index_block_hash),
          hexToBuffer(mb.block_hash),
          mb.parent_burn_block_height,
          hexToBuffer(mb.parent_burn_block_hash),
          mb.parent_burn_block_time,
        ]
      );
    }

    for (const entry of txs) {
      const rowsUpdated = await this.updateTx(client, entry.tx);
      if (rowsUpdated !== 1) {
        throw new Error(
          `Unexpected amount of rows updated for microblock tx insert: ${rowsUpdated}`
        );
      }

      await this.updateBatchStxEvents(client, entry.tx, entry.stxEvents);
      await this.updatePrincipalStxTxs(client, entry.tx, entry.stxEvents);
      await this.updateBatchSmartContractEvent(client, entry.tx, entry.contractLogEvents);
      for (const stxLockEvent of entry.stxLockEvents) {
        await this.updateStxLockEvent(client, entry.tx, stxLockEvent);
      }
      for (const ftEvent of entry.ftEvents) {
        await this.updateFtEvent(client, entry.tx, ftEvent);
      }
      for (const nftEvent of entry.nftEvents) {
        await this.updateNftEvent(client, entry.tx, nftEvent);
      }
      for (const smartContract of entry.smartContracts) {
        await this.updateSmartContract(client, entry.tx, smartContract);
      }
      for (const bnsName of entry.names) {
        await this.updateNames(client, entry.tx, bnsName);
      }
      for (const namespace of entry.namespaces) {
        await this.updateNamespaces(client, entry.tx, namespace);
      }
    }
  }

  async handleMicroReorg(
    client: ClientBase,
    args: {
      isCanonical: boolean;
      isMicroCanonical: boolean;
      indexBlockHash: string;
      blockHash: string;
      burnBlockTime: number;
      microblocks: string[];
    }
  ): Promise<{ updatedTxs: DbTx[] }> {
    // Flag orphaned microblock rows as `microblock_canonical=false`
    const updatedMicroblocksQuery = await client.query(
      `
      UPDATE microblocks
      SET microblock_canonical = $1, canonical = $2, index_block_hash = $3, block_hash = $4
      WHERE microblock_hash = ANY($5)
      `,
      [
        args.isMicroCanonical,
        args.isCanonical,
        hexToBuffer(args.indexBlockHash),
        hexToBuffer(args.blockHash),
        args.microblocks.map(mb => hexToBuffer(mb)),
      ]
    );
    if (updatedMicroblocksQuery.rowCount !== args.microblocks.length) {
      throw new Error(`Unexpected number of rows updated when setting microblock_canonical`);
    }

    // Identify microblock transactions that were orphaned or accepted by this anchor block,
    // and update `microblock_canonical`, `canonical`, as well as anchor block data that may be missing
    // for unanchored entires.
    const updatedMbTxsQuery = await client.query<TxQueryResult>(
      `
      UPDATE txs
      SET microblock_canonical = $1, canonical = $2, index_block_hash = $3, block_hash = $4, burn_block_time = $5
      WHERE microblock_hash = ANY($6)
      AND (index_block_hash = $3 OR index_block_hash = '\\x'::bytea)
      RETURNING ${TX_COLUMNS}
      `,
      [
        args.isMicroCanonical,
        args.isCanonical,
        hexToBuffer(args.indexBlockHash),
        hexToBuffer(args.blockHash),
        args.burnBlockTime,
        args.microblocks.map(mb => hexToBuffer(mb)),
      ]
    );
    // Any txs restored need to be pruned from the mempool
    const updatedMbTxs = updatedMbTxsQuery.rows.map(r => this.parseTxQueryResult(r));
    const txsToPrune = updatedMbTxs
      .filter(tx => tx.canonical && tx.microblock_canonical)
      .map(tx => tx.tx_id);
    const removedTxsResult = await this.pruneMempoolTxs(client, txsToPrune);
    if (removedTxsResult.removedTxs.length > 0) {
      logger.verbose(
        `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during micro-reorg handling`
      );
    }

    // Update the `index_block_hash` and `microblock_canonical` properties on all the tables containing other
    // microblock-tx metadata that have been accepted or orphaned in this anchor block.
    const updatedAssociatedTableParams = [
      args.isMicroCanonical,
      args.isCanonical,
      hexToBuffer(args.indexBlockHash),
      args.microblocks.map(mb => hexToBuffer(mb)),
      updatedMbTxs.map(tx => hexToBuffer(tx.tx_id)),
    ];
    for (const associatedTableName of TX_METADATA_TABLES) {
      await client.query(
        `
        UPDATE ${associatedTableName}
        SET microblock_canonical = $1, canonical = $2, index_block_hash = $3
        WHERE microblock_hash = ANY($4)
        AND (index_block_hash = $3 OR index_block_hash = '\\x'::bytea)
        AND tx_id = ANY($5)
        `,
        updatedAssociatedTableParams
      );
    }

    return { updatedTxs: updatedMbTxs };
  }

  /**
   * Fetches from the `microblocks` table with a given `parent_index_block_hash` and a known
   * latest unanchored microblock tip. Microblocks that are chained to the given tip are
   * returned as accepted, and all others are returned as orphaned/rejected. This function
   * only performs the lookup, it does not perform any updates to the db.
   * If a gap in the microblock stream is detected, that error information is returned instead.
   * @param microblockChainTip - undefined if processing an anchor block that doesn't point to a parent microblock.
   */
  async findUnanchoredMicroblocksAtChainTip(
    client: ClientBase,
    parentIndexBlockHash: string,
    blockHeight: number,
    microblockChainTip: DbMicroblock | undefined
  ): Promise<
    | { acceptedMicroblocks: string[]; orphanedMicroblocks: string[] }
    | {
        microblockGap: true;
        missingMicroblockHash: string;
        oldestParentMicroblockHash: string;
        oldestParentMicroblockSequence: number;
      }
  > {
    // Get any microblocks that this anchor block is responsible for accepting or rejecting.
    // Note: we don't filter on `microblock_canonical=true` here because that could have been flipped in a previous anchor block
    // which could now be in the process of being re-org'd.
    const mbQuery = await client.query<MicroblockQueryResult>(
      `
      SELECT ${MICROBLOCK_COLUMNS}
      FROM microblocks
      WHERE (parent_index_block_hash = $1 OR block_height = $2)
      `,
      [hexToBuffer(parentIndexBlockHash), blockHeight]
    );
    const candidateMicroblocks = mbQuery.rows.map(row => this.parseMicroblockQueryResult(row));

    // Accepted/orphaned status needs to be determined by walking through the microblock hash chain rather than a simple sequence number comparison,
    // because we can't depend on a `microblock_canonical=true` filter in the above query, so there could be microblocks with the same sequence number
    // if a leader has self-orphaned its own microblocks.
    let prevMicroblock: DbMicroblock | undefined = microblockChainTip;
    const acceptedMicroblocks = new Set<string>();
    const orphanedMicroblocks = new Set<string>();
    while (prevMicroblock) {
      acceptedMicroblocks.add(prevMicroblock.microblock_hash);
      const foundMb = candidateMicroblocks.find(
        mb => mb.microblock_hash === prevMicroblock?.microblock_parent_hash
      );
      // Sanity check that the first microblock in the chain is sequence 0
      if (!foundMb && prevMicroblock.microblock_sequence !== 0) {
        return {
          microblockGap: true,
          missingMicroblockHash: prevMicroblock?.microblock_parent_hash,
          oldestParentMicroblockHash: prevMicroblock.microblock_hash,
          oldestParentMicroblockSequence: prevMicroblock.microblock_sequence,
        };
      }
      prevMicroblock = foundMb;
    }
    candidateMicroblocks.forEach(mb => {
      if (!acceptedMicroblocks.has(mb.microblock_hash)) {
        orphanedMicroblocks.add(mb.microblock_hash);
      }
    });
    return {
      acceptedMicroblocks: [...acceptedMicroblocks],
      orphanedMicroblocks: [...orphanedMicroblocks],
    };
  }

  async getMicroblock(args: {
    microblockHash: string;
  }): Promise<FoundOrNot<{ microblock: DbMicroblock; txs: string[] }>> {
    return await this.queryTx(async client => {
      const result = await client.query<MicroblockQueryResult>(
        `
        SELECT ${MICROBLOCK_COLUMNS}
        FROM microblocks
        WHERE microblock_hash = $1
        ORDER BY canonical DESC, microblock_canonical DESC
        LIMIT 1
        `,
        [hexToBuffer(args.microblockHash)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const txQuery = await client.query<{ tx_id: Buffer }>(
        `
        SELECT tx_id
        FROM txs
        WHERE microblock_hash = $1
        ORDER BY tx_index DESC
        `,
        [hexToBuffer(args.microblockHash)]
      );
      const microblock = this.parseMicroblockQueryResult(result.rows[0]);
      const txs = txQuery.rows.map(row => bufferToHexPrefixString(row.tx_id));
      return { found: true, result: { microblock, txs } };
    });
  }

  async getMicroblocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ result: { microblock: DbMicroblock; txs: string[] }[]; total: number }> {
    const result = await this.queryTx(async client => {
      const countQuery = await client.query<{ total: number }>(
        `
        SELECT COUNT(*)::integer total
        FROM microblocks
        WHERE canonical = true AND microblock_canonical = true
        `
      );
      const microblockQuery = await client.query<
        MicroblockQueryResult & { tx_id?: Buffer | null; tx_index?: number | null }
      >(
        `
        SELECT microblocks.*, tx_id FROM (
          SELECT ${MICROBLOCK_COLUMNS}
          FROM microblocks
          WHERE canonical = true AND microblock_canonical = true
          ORDER BY block_height DESC, microblock_sequence DESC
          LIMIT $1
          OFFSET $2
        ) microblocks
        LEFT JOIN (
          SELECT tx_id, tx_index, microblock_hash
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
          ORDER BY tx_index DESC
        ) txs
        ON microblocks.microblock_hash = txs.microblock_hash
        ORDER BY microblocks.block_height DESC, microblocks.microblock_sequence DESC, txs.tx_index DESC
        `,
        [args.limit, args.offset]
      );

      const microblocks: { microblock: DbMicroblock; txs: string[] }[] = [];
      microblockQuery.rows.forEach(row => {
        const mb = this.parseMicroblockQueryResult(row);
        let existing = microblocks.find(
          item => item.microblock.microblock_hash === mb.microblock_hash
        );
        if (!existing) {
          existing = { microblock: mb, txs: [] };
          microblocks.push(existing);
        }
        if (row.tx_id) {
          const txId = bufferToHexPrefixString(row.tx_id);
          existing.txs.push(txId);
        }
      });
      return {
        result: microblocks,
        total: countQuery.rows[0].total,
      };
    });
    return result;
  }

  async getUnanchoredTxsInternal(client: ClientBase): Promise<{ txs: DbTx[] }> {
    // Get transactions that have been streamed in microblocks but not yet accepted or rejected in an anchor block.
    const { blockHeight } = await this.getChainTip(client);
    const unanchoredBlockHeight = blockHeight + 1;
    const query = await client.query<ContractTxQueryResult>(
      `
      SELECT ${TX_COLUMNS}, ${abiColumn()}
      FROM txs
      WHERE canonical = true AND microblock_canonical = true AND block_height = $1
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
      `,
      [unanchoredBlockHeight]
    );
    const txs = query.rows.map(row => this.parseTxQueryResult(row));
    return { txs: txs };
  }

  async getUnanchoredTxs(): Promise<{ txs: DbTx[] }> {
    return await this.queryTx(client => {
      return this.getUnanchoredTxsInternal(client);
    });
  }

  async getAddressNonces(args: {
    stxAddress: string;
  }): Promise<{
    lastExecutedTxNonce: number | null;
    lastMempoolTxNonce: number | null;
    possibleNextNonce: number;
    detectedMissingNonces: number[];
  }> {
    return await this.queryTx(async client => {
      const executedTxNonce = await client.query<{ nonce: number | null }>(
        `
        SELECT MAX(nonce) nonce
        FROM txs
        WHERE ((sender_address = $1 AND sponsored = false) OR (sponsor_address = $1 AND sponsored= true))
        AND canonical = true AND microblock_canonical = true
        `,
        [args.stxAddress]
      );
      const mempoolTxNonce = await client.query<{ nonce: number | null }>(
        `
        SELECT MAX(nonce) nonce
        FROM mempool_txs
        WHERE ((sender_address = $1 AND sponsored = false) OR (sponsor_address = $1 AND sponsored= true))
        AND pruned = false
        `,
        [args.stxAddress]
      );
      const lastExecutedTxNonce = executedTxNonce.rows[0]?.nonce ?? null;
      const lastMempoolTxNonce = mempoolTxNonce.rows[0]?.nonce ?? null;
      let possibleNextNonce = 0;
      if (lastExecutedTxNonce !== null || lastMempoolTxNonce !== null) {
        possibleNextNonce = Math.max(lastExecutedTxNonce ?? 0, lastMempoolTxNonce ?? 0) + 1;
      }
      const detectedMissingNonces: number[] = [];
      if (lastExecutedTxNonce !== null && lastMempoolTxNonce !== null) {
        // There's a greater than one difference in the last mempool tx nonce and last executed tx nonce.
        // Check if there are any expected intermediate nonces missing from from the mempool.
        if (lastMempoolTxNonce - lastExecutedTxNonce > 1) {
          const expectedNonces: number[] = [];
          for (let i = lastMempoolTxNonce - 1; i > lastExecutedTxNonce; i--) {
            expectedNonces.push(i);
          }
          const mempoolNonces = await client.query<{ nonce: number }>(
            `
            SELECT nonce
            FROM mempool_txs
            WHERE ((sender_address = $1 AND sponsored = false) OR (sponsor_address = $1 AND sponsored= true)) AND nonce = ANY($2)
            AND pruned = false
            `,
            [args.stxAddress, expectedNonces]
          );
          const mempoolNonceArr = mempoolNonces.rows.map(r => r.nonce);
          expectedNonces.forEach(nonce => {
            if (!mempoolNonceArr.includes(nonce)) {
              detectedMissingNonces.push(nonce);
            }
          });
        }
      }
      return {
        lastExecutedTxNonce: lastExecutedTxNonce,
        lastMempoolTxNonce: lastMempoolTxNonce,
        possibleNextNonce: possibleNextNonce,
        detectedMissingNonces: detectedMissingNonces,
      };
    });
  }

  getNameCanonical(txId: string, indexBlockHash: string): Promise<FoundOrNot<boolean>> {
    return this.query(async client => {
      const queryResult = await client.query(
        `
        SELECT canonical FROM names
        WHERE tx_id = $1
        AND index_block_hash = $2
        `,
        [hexToBuffer(txId), hexToBuffer(indexBlockHash)]
      );
      if (queryResult.rowCount > 0) {
        return {
          found: true,
          result: queryResult.rows[0],
        };
      }
      return { found: false } as const;
    });
  }

  async updateZoneContent(zonefile: string, zonefile_hash: string, tx_id: string): Promise<void> {
    await this.queryTx(async client => {
      // inserting zonefile into zonefiles table
      const validZonefileHash = this.validateZonefileHash(zonefile_hash);
      await client.query(
        `
        UPDATE zonefiles
        SET zonefile = $1
        WHERE zonefile_hash = $2
        `,
        [zonefile, validZonefileHash]
      );
    });
    await this.notifier?.sendName({ nameInfo: tx_id });
  }

  private validateZonefileHash(zonefileHash: string) {
    // this function removes the `0x` from the incoming zonefile hash, either for insertion or search.
    const index = zonefileHash.indexOf('0x');
    if (index === 0) {
      return zonefileHash.slice(2);
    }
    return zonefileHash;
  }

  async resolveBnsSubdomains(
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    data: DbBnsSubdomain[]
  ): Promise<void> {
    if (data.length == 0) return;
    await this.queryTx(async client => {
      await this.updateBatchSubdomains(client, blockData, data);
    });
  }

  emitAddressTxUpdates(txs: DataStoreTxEventData[]) {
    // Record all addresses that had an associated tx.
    const addressTxUpdates = new Map<string, number>();
    txs.forEach(entry => {
      const tx = entry.tx;
      const addAddressTx = (addr: string | undefined) => {
        if (addr) {
          getOrAdd(addressTxUpdates, addr, () => tx.block_height);
        }
      };
      addAddressTx(tx.sender_address);
      entry.stxLockEvents.forEach(event => {
        addAddressTx(event.locked_address);
      });
      entry.stxEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.ftEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.nftEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.smartContracts.forEach(event => {
        addAddressTx(event.contract_id);
      });
      switch (tx.type_id) {
        case DbTxTypeId.ContractCall:
          addAddressTx(tx.contract_call_contract_id);
          break;
        case DbTxTypeId.SmartContract:
          addAddressTx(tx.smart_contract_contract_id);
          break;
        case DbTxTypeId.TokenTransfer:
          addAddressTx(tx.token_transfer_recipient_address);
          break;
      }
    });
    addressTxUpdates.forEach(async (blockHeight, address) => {
      await this.notifier?.sendAddress({
        address: address,
        blockHeight: blockHeight,
      });
    });
  }

  /**
   * Restore transactions in the mempool table. This should be called when mined transactions are
   * marked from canonical to non-canonical.
   * @param txIds - List of transactions to update in the mempool
   */
  async restoreMempoolTxs(client: ClientBase, txIds: string[]): Promise<{ restoredTxs: string[] }> {
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { restoredTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Restoring mempool tx: ${txId}`);
    }
    const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
    const updateResults = await client.query<{ tx_id: Buffer }>(
      `
      UPDATE mempool_txs
      SET pruned = false
      WHERE tx_id = ANY($1)
      RETURNING tx_id
      `,
      [txIdBuffers]
    );
    const restoredTxs = updateResults.rows.map(r => bufferToHexPrefixString(r.tx_id));
    return { restoredTxs: restoredTxs };
  }

  /**
   * Remove transactions in the mempool table. This should be called when transactions are
   * mined into a block.
   * @param txIds - List of transactions to update in the mempool
   */
  async pruneMempoolTxs(client: ClientBase, txIds: string[]): Promise<{ removedTxs: string[] }> {
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { removedTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Pruning mempool tx: ${txId}`);
    }
    const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
    const updateResults = await client.query<{ tx_id: Buffer }>(
      `
      UPDATE mempool_txs
      SET pruned = true
      WHERE tx_id = ANY($1)
      RETURNING tx_id
      `,
      [txIdBuffers]
    );
    const removedTxs = updateResults.rows.map(r => bufferToHexPrefixString(r.tx_id));
    return { removedTxs: removedTxs };
  }

  async markEntitiesCanonical(
    client: ClientBase,
    indexBlockHash: Buffer,
    canonical: boolean,
    updatedEntities: UpdatedEntities
  ): Promise<{ txsMarkedCanonical: string[]; txsMarkedNonCanonical: string[] }> {
    const txResult = await client.query<TxQueryResult>(
      `
      UPDATE txs
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      RETURNING ${TX_COLUMNS}
      `,
      [indexBlockHash, canonical]
    );
    const txIds = txResult.rows.map(row => this.parseTxQueryResult(row));
    if (canonical) {
      updatedEntities.markedCanonical.txs += txResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.txs += txResult.rowCount;
    }
    for (const txId of txIds) {
      logger.verbose(`Marked tx as ${canonical ? 'canonical' : 'non-canonical'}: ${txId.tx_id}`);
    }

    const minerRewardResults = await client.query(
      `
      UPDATE miner_rewards
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.minerRewards += minerRewardResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.minerRewards += minerRewardResults.rowCount;
    }

    const stxLockResults = await client.query(
      `
      UPDATE stx_lock_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.stxLockEvents += stxLockResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.stxLockEvents += stxLockResults.rowCount;
    }

    const stxResults = await client.query(
      `
      UPDATE stx_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.stxEvents += stxResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.stxEvents += stxResults.rowCount;
    }

    const ftResult = await client.query(
      `
      UPDATE ft_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.ftEvents += ftResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.ftEvents += ftResult.rowCount;
    }

    const nftResult = await client.query(
      `
      UPDATE nft_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.nftEvents += nftResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.nftEvents += nftResult.rowCount;
    }

    const contractLogResult = await client.query(
      `
      UPDATE contract_logs
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.contractLogs += contractLogResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.contractLogs += contractLogResult.rowCount;
    }

    const smartContractResult = await client.query(
      `
      UPDATE smart_contracts
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.smartContracts += smartContractResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.smartContracts += smartContractResult.rowCount;
    }

    const nameResult = await client.query(
      `
      UPDATE names
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.names += nameResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.names += nameResult.rowCount;
    }

    const namespaceResult = await client.query(
      `
      UPDATE namespaces
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.namespaces += namespaceResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.namespaces += namespaceResult.rowCount;
    }

    const subdomainResult = await client.query(
      `
      UPDATE subdomains
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.subdomains += subdomainResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.subdomains += subdomainResult.rowCount;
    }

    return {
      txsMarkedCanonical: canonical ? txIds.map(t => t.tx_id) : [],
      txsMarkedNonCanonical: canonical ? [] : txIds.map(t => t.tx_id),
    };
  }

  async restoreOrphanedChain(
    client: ClientBase,
    indexBlockHash: Buffer,
    updatedEntities: UpdatedEntities
  ): Promise<UpdatedEntities> {
    const restoredBlockResult = await client.query<BlockQueryResult>(
      `
      -- restore the previously orphaned block to canonical
      UPDATE blocks
      SET canonical = true
      WHERE index_block_hash = $1 AND canonical = false
      RETURNING ${BLOCK_COLUMNS}
      `,
      [indexBlockHash]
    );

    if (restoredBlockResult.rowCount === 0) {
      throw new Error(
        `Could not find orphaned block by index_hash ${indexBlockHash.toString('hex')}`
      );
    }
    if (restoredBlockResult.rowCount > 1) {
      throw new Error(
        `Found multiple non-canonical parents for index_hash ${indexBlockHash.toString('hex')}`
      );
    }
    updatedEntities.markedCanonical.blocks++;

    const orphanedBlockResult = await client.query<BlockQueryResult>(
      `
      -- orphan the now conflicting block at the same height
      UPDATE blocks
      SET canonical = false
      WHERE block_height = $1 AND index_block_hash != $2 AND canonical = true
      RETURNING ${BLOCK_COLUMNS}
      `,
      [restoredBlockResult.rows[0].block_height, indexBlockHash]
    );

    const microblocksOrphaned = new Set<string>();
    const microblocksAccepted = new Set<string>();

    if (orphanedBlockResult.rowCount > 0) {
      const orphanedBlocks = orphanedBlockResult.rows.map(b => this.parseBlockQueryResult(b));
      for (const orphanedBlock of orphanedBlocks) {
        const microCanonicalUpdateResult = await this.updateMicroCanonical(client, {
          isCanonical: false,
          blockHeight: orphanedBlock.block_height,
          blockHash: orphanedBlock.block_hash,
          indexBlockHash: orphanedBlock.index_block_hash,
          parentIndexBlockHash: orphanedBlock.parent_index_block_hash,
          parentMicroblockHash: orphanedBlock.parent_microblock_hash,
          parentMicroblockSequence: orphanedBlock.parent_microblock_sequence,
          burnBlockTime: orphanedBlock.burn_block_time,
        });
        microCanonicalUpdateResult.orphanedMicroblocks.forEach(mb => {
          microblocksOrphaned.add(mb);
          microblocksAccepted.delete(mb);
        });
        microCanonicalUpdateResult.acceptedMicroblocks.forEach(mb => {
          microblocksOrphaned.delete(mb);
          microblocksAccepted.add(mb);
        });
      }

      updatedEntities.markedNonCanonical.blocks++;
      const markNonCanonicalResult = await this.markEntitiesCanonical(
        client,
        orphanedBlockResult.rows[0].index_block_hash,
        false,
        updatedEntities
      );
      await this.restoreMempoolTxs(client, markNonCanonicalResult.txsMarkedNonCanonical);
    }

    // The canonical microblock tables _must_ be restored _after_ orphaning all other blocks at a given height,
    // because there is only 1 row per microblock hash, and both the orphaned blocks at this height and the
    // canonical block can be pointed to the same microblocks.
    const restoredBlock = this.parseBlockQueryResult(restoredBlockResult.rows[0]);
    const microCanonicalUpdateResult = await this.updateMicroCanonical(client, {
      isCanonical: true,
      blockHeight: restoredBlock.block_height,
      blockHash: restoredBlock.block_hash,
      indexBlockHash: restoredBlock.index_block_hash,
      parentIndexBlockHash: restoredBlock.parent_index_block_hash,
      parentMicroblockHash: restoredBlock.parent_microblock_hash,
      parentMicroblockSequence: restoredBlock.parent_microblock_sequence,
      burnBlockTime: restoredBlock.burn_block_time,
    });
    microCanonicalUpdateResult.orphanedMicroblocks.forEach(mb => {
      microblocksOrphaned.add(mb);
      microblocksAccepted.delete(mb);
    });
    microCanonicalUpdateResult.acceptedMicroblocks.forEach(mb => {
      microblocksOrphaned.delete(mb);
      microblocksAccepted.add(mb);
    });
    updatedEntities.markedCanonical.microblocks += microblocksAccepted.size;
    updatedEntities.markedNonCanonical.microblocks += microblocksOrphaned.size;

    microblocksOrphaned.forEach(mb => logger.verbose(`Marked microblock as non-canonical: ${mb}`));
    microblocksAccepted.forEach(mb => logger.verbose(`Marked microblock as canonical: ${mb}`));

    const markCanonicalResult = await this.markEntitiesCanonical(
      client,
      indexBlockHash,
      true,
      updatedEntities
    );
    const removedTxsResult = await this.pruneMempoolTxs(
      client,
      markCanonicalResult.txsMarkedCanonical
    );
    if (removedTxsResult.removedTxs.length > 0) {
      logger.verbose(
        `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during reorg handling`
      );
    }
    const parentResult = await client.query<{ index_block_hash: Buffer }>(
      `
      -- check if the parent block is also orphaned
      SELECT index_block_hash
      FROM blocks
      WHERE
        block_height = $1 AND
        index_block_hash = $2 AND
        canonical = false
      `,
      [
        restoredBlockResult.rows[0].block_height - 1,
        restoredBlockResult.rows[0].parent_index_block_hash,
      ]
    );
    if (parentResult.rowCount > 1) {
      throw new Error('Found more than one non-canonical parent to restore during reorg');
    }
    if (parentResult.rowCount > 0) {
      await this.restoreOrphanedChain(
        client,
        parentResult.rows[0].index_block_hash,
        updatedEntities
      );
    }
    return updatedEntities;
  }

  async handleReorg(
    client: ClientBase,
    block: DbBlock,
    chainTipHeight: number
  ): Promise<UpdatedEntities> {
    const updatedEntities: UpdatedEntities = {
      markedCanonical: {
        blocks: 0,
        microblocks: 0,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
        names: 0,
        namespaces: 0,
        subdomains: 0,
      },
      markedNonCanonical: {
        blocks: 0,
        microblocks: 0,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
        names: 0,
        namespaces: 0,
        subdomains: 0,
      },
    };

    // Check if incoming block's parent is canonical
    if (block.block_height > 1) {
      const parentResult = await client.query<{
        canonical: boolean;
        index_block_hash: Buffer;
        parent_index_block_hash: Buffer;
      }>(
        `
        SELECT canonical, index_block_hash, parent_index_block_hash
        FROM blocks
        WHERE block_height = $1 AND index_block_hash = $2
        `,
        [block.block_height - 1, hexToBuffer(block.parent_index_block_hash)]
      );

      if (parentResult.rowCount > 1) {
        throw new Error(
          `DB contains multiple blocks at height ${block.block_height - 1} and index_hash ${
            block.parent_index_block_hash
          }`
        );
      }
      if (parentResult.rowCount === 0) {
        throw new Error(
          `DB does not contain a parent block at height ${block.block_height - 1} with index_hash ${
            block.parent_index_block_hash
          }`
        );
      }

      // This blocks builds off a previously orphaned chain. Restore canonical status for this chain.
      if (!parentResult.rows[0].canonical && block.block_height > chainTipHeight) {
        await this.restoreOrphanedChain(
          client,
          parentResult.rows[0].index_block_hash,
          updatedEntities
        );
        this.logReorgResultInfo(updatedEntities);
      }
    }
    return updatedEntities;
  }

  logReorgResultInfo(updatedEntities: UpdatedEntities) {
    const updates = [
      ['blocks', updatedEntities.markedCanonical.blocks, updatedEntities.markedNonCanonical.blocks],
      [
        'microblocks',
        updatedEntities.markedCanonical.microblocks,
        updatedEntities.markedNonCanonical.microblocks,
      ],
      ['txs', updatedEntities.markedCanonical.txs, updatedEntities.markedNonCanonical.txs],
      [
        'miner-rewards',
        updatedEntities.markedCanonical.minerRewards,
        updatedEntities.markedNonCanonical.minerRewards,
      ],
      [
        'stx-lock events',
        updatedEntities.markedCanonical.stxLockEvents,
        updatedEntities.markedNonCanonical.stxLockEvents,
      ],
      [
        'stx-token events',
        updatedEntities.markedCanonical.stxEvents,
        updatedEntities.markedNonCanonical.stxEvents,
      ],
      [
        'non-fungible-token events',
        updatedEntities.markedCanonical.nftEvents,
        updatedEntities.markedNonCanonical.nftEvents,
      ],
      [
        'fungible-token events',
        updatedEntities.markedCanonical.ftEvents,
        updatedEntities.markedNonCanonical.ftEvents,
      ],
      [
        'contract logs',
        updatedEntities.markedCanonical.contractLogs,
        updatedEntities.markedNonCanonical.contractLogs,
      ],
      [
        'smart contracts',
        updatedEntities.markedCanonical.smartContracts,
        updatedEntities.markedNonCanonical.smartContracts,
      ],
      ['names', updatedEntities.markedCanonical.names, updatedEntities.markedNonCanonical.names],
      [
        'namespaces',
        updatedEntities.markedCanonical.namespaces,
        updatedEntities.markedNonCanonical.namespaces,
      ],
      [
        'subdomains',
        updatedEntities.markedCanonical.subdomains,
        updatedEntities.markedNonCanonical.subdomains,
      ],
    ];
    const markedCanonical = updates.map(e => `${e[1]} ${e[0]}`).join(', ');
    logger.verbose(`Entities marked as canonical: ${markedCanonical}`);
    const markedNonCanonical = updates.map(e => `${e[2]} ${e[0]}`).join(', ');
    logger.verbose(`Entities marked as non-canonical: ${markedNonCanonical}`);
  }

  static async connect(
    skipMigrations = false,
    withNotifier = true,
    eventReplay = false
  ): Promise<PgDataStore> {
    const clientConfig = getPgClientConfig();

    const initTimer = stopwatch();
    let connectionError: Error | undefined;
    let connectionOkay = false;
    let lastElapsedLog = 0;
    do {
      const client = new Client(clientConfig);
      try {
        await client.connect();
        connectionOkay = true;
        break;
      } catch (error: any) {
        if (
          error.code !== 'ECONNREFUSED' &&
          error.message !== 'Connection terminated unexpectedly' &&
          !error.message?.includes('database system is starting')
        ) {
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
      await runMigrations(clientConfig);
    }
    const poolConfig: PoolConfig = {
      ...clientConfig,
    };
    const pgConnectionPoolMaxEnv = process.env['PG_CONNECTION_POOL_MAX'];
    if (pgConnectionPoolMaxEnv) {
      poolConfig.max = Number.parseInt(pgConnectionPoolMaxEnv);
    }
    const pool = new Pool(poolConfig);
    pool.on('error', error => {
      logger.error(`Postgres connection pool error: ${error.message}`, error);
    });
    let poolClient: PoolClient | undefined;
    try {
      poolClient = await pool.connect();
      if (!withNotifier) {
        return new PgDataStore(pool, undefined, eventReplay);
      }
      const notifier = new PgNotifier(clientConfig);
      const store = new PgDataStore(pool, notifier, eventReplay);
      await store.connectPgNotifier();
      return store;
    } catch (error) {
      logError(
        `Error connecting to Postgres using ${JSON.stringify(clientConfig)}: ${error}`,
        error
      );
      throw error;
    } finally {
      poolClient?.release();
    }
  }

  async updateMinerReward(client: ClientBase, minerReward: DbMinerReward): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO miner_rewards(
        block_hash, index_block_hash, from_index_block_hash, mature_block_height, canonical, recipient, coinbase_amount, tx_fees_anchored, tx_fees_streamed_confirmed, tx_fees_streamed_produced
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        hexToBuffer(minerReward.block_hash),
        hexToBuffer(minerReward.index_block_hash),
        hexToBuffer(minerReward.from_index_block_hash),
        minerReward.mature_block_height,
        minerReward.canonical,
        minerReward.recipient,
        minerReward.coinbase_amount,
        minerReward.tx_fees_anchored,
        minerReward.tx_fees_streamed_confirmed,
        minerReward.tx_fees_streamed_produced,
      ]
    );
    return result.rowCount;
  }

  async updateBlock(client: ClientBase, block: DbBlock): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO blocks(
        block_hash, index_block_hash,
        parent_index_block_hash, parent_block_hash, parent_microblock_hash, parent_microblock_sequence,
        block_height, burn_block_time, burn_block_hash, burn_block_height, miner_txid, canonical,
        execution_cost_read_count, execution_cost_read_length, execution_cost_runtime,
        execution_cost_write_count, execution_cost_write_length
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (index_block_hash)
      DO NOTHING
      `,
      [
        hexToBuffer(block.block_hash),
        hexToBuffer(block.index_block_hash),
        hexToBuffer(block.parent_index_block_hash),
        hexToBuffer(block.parent_block_hash),
        hexToBuffer(block.parent_microblock_hash),
        block.parent_microblock_sequence,
        block.block_height,
        block.burn_block_time,
        hexToBuffer(block.burn_block_hash),
        block.burn_block_height,
        hexToBuffer(block.miner_txid),
        block.canonical,
        block.execution_cost_read_count,
        block.execution_cost_read_length,
        block.execution_cost_runtime,
        block.execution_cost_write_count,
        block.execution_cost_write_length,
      ]
    );
    return result.rowCount;
  }

  parseBlockQueryResult(row: BlockQueryResult): DbBlock {
    // TODO(mb): is the tx_index preserved between microblocks and committed anchor blocks?
    const block: DbBlock = {
      block_hash: bufferToHexPrefixString(row.block_hash),
      index_block_hash: bufferToHexPrefixString(row.index_block_hash),
      parent_index_block_hash: bufferToHexPrefixString(row.parent_index_block_hash),
      parent_block_hash: bufferToHexPrefixString(row.parent_block_hash),
      parent_microblock_hash: bufferToHexPrefixString(row.parent_microblock_hash),
      parent_microblock_sequence: row.parent_microblock_sequence,
      block_height: row.block_height,
      burn_block_time: row.burn_block_time,
      burn_block_hash: bufferToHexPrefixString(row.burn_block_hash),
      burn_block_height: row.burn_block_height,
      miner_txid: bufferToHexPrefixString(row.miner_txid),
      canonical: row.canonical,
      execution_cost_read_count: Number.parseInt(row.execution_cost_read_count),
      execution_cost_read_length: Number.parseInt(row.execution_cost_read_length),
      execution_cost_runtime: Number.parseInt(row.execution_cost_runtime),
      execution_cost_write_count: Number.parseInt(row.execution_cost_write_count),
      execution_cost_write_length: Number.parseInt(row.execution_cost_write_length),
    };
    return block;
  }

  async getBlockWithMetadata<TWithTxs extends boolean, TWithMicroblocks extends boolean>(
    blockIdentifer: BlockIdentifier,
    metadata?: DbGetBlockWithMetadataOpts<TWithTxs, TWithMicroblocks>
  ): Promise<FoundOrNot<DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>>> {
    return await this.queryTx(async client => {
      const block = await this.getBlockInternal(client, blockIdentifer);
      if (!block.found) {
        return { found: false };
      }
      let txs: DbTx[] | null = null;
      let microblocksAccepted: DbMicroblock[] | null = null;
      let microblocksStreamed: DbMicroblock[] | null = null;
      if (metadata?.txs) {
        const txQuery = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE index_block_hash = $1 AND canonical = true AND microblock_canonical = true
          ORDER BY microblock_sequence DESC, tx_index DESC
          `,
          [hexToBuffer(block.result.index_block_hash)]
        );
        txs = txQuery.rows.map(r => this.parseTxQueryResult(r));
      }
      if (metadata?.microblocks) {
        const microblocksQuery = await client.query<MicroblockQueryResult>(
          `
          SELECT ${MICROBLOCK_COLUMNS}
          FROM microblocks
          WHERE parent_index_block_hash IN ($1, $2)
          AND microblock_canonical = true
          ORDER BY microblock_sequence DESC
          `,
          [
            hexToBuffer(block.result.index_block_hash),
            hexToBuffer(block.result.parent_index_block_hash),
          ]
        );
        const parsedMicroblocks = microblocksQuery.rows.map(r =>
          this.parseMicroblockQueryResult(r)
        );
        microblocksAccepted = parsedMicroblocks.filter(
          mb => mb.parent_index_block_hash === block.result.parent_index_block_hash
        );
        microblocksStreamed = parsedMicroblocks.filter(
          mb => mb.parent_index_block_hash === block.result.index_block_hash
        );
      }
      type ResultType = DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>;
      const result: ResultType = {
        block: block.result,
        txs: txs as ResultType['txs'],
        microblocks: {
          accepted: microblocksAccepted,
          streamed: microblocksStreamed,
        } as ResultType['microblocks'],
      };
      return {
        found: true,
        result: result,
      };
    });
  }

  async getUnanchoredChainTip(): Promise<FoundOrNot<DbChainTip>> {
    return await this.queryTx(async client => {
      const result = await client.query<{
        block_height: number;
        index_block_hash: Buffer;
        block_hash: Buffer;
        microblock_hash: Buffer | null;
        microblock_sequence: number | null;
      }>(
        `
        WITH anchor_block AS (
          SELECT block_height, block_hash, index_block_hash
          FROM blocks
          WHERE canonical = true
          AND block_height = (SELECT MAX(block_height) FROM blocks)
        ), microblock AS (
          SELECT microblock_hash, microblock_sequence
          FROM microblocks, anchor_block
          WHERE microblocks.parent_index_block_hash = anchor_block.index_block_hash
          AND microblock_canonical = true AND canonical = true
          ORDER BY microblock_sequence DESC
          LIMIT 1
        )
        SELECT block_height, index_block_hash, block_hash, microblock_hash, microblock_sequence
        FROM anchor_block LEFT JOIN microblock ON true
        `
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      const chainTipResult: DbChainTip = {
        blockHeight: row.block_height,
        indexBlockHash: bufferToHexPrefixString(row.index_block_hash),
        blockHash: bufferToHexPrefixString(row.block_hash),
        microblockHash:
          row.microblock_hash === null ? undefined : bufferToHexPrefixString(row.microblock_hash),
        microblockSequence: row.microblock_sequence === null ? undefined : row.microblock_sequence,
      };
      return { found: true, result: chainTipResult };
    });
  }

  getBlock(blockIdentifer: BlockIdentifier): Promise<FoundOrNot<DbBlock>> {
    return this.query(client => this.getBlockInternal(client, blockIdentifer));
  }

  async getBlockInternal(
    client: ClientBase,
    blockIdentifer: BlockIdentifier
  ): Promise<FoundOrNot<DbBlock>> {
    let result: QueryResult<BlockQueryResult>;
    if ('hash' in blockIdentifer) {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE block_hash = $1
        ORDER BY canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(blockIdentifer.hash)]
      );
    } else if ('height' in blockIdentifer) {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE block_height = $1
        ORDER BY canonical DESC
        LIMIT 1
        `,
        [blockIdentifer.height]
      );
    } else if ('burnBlockHash' in blockIdentifer) {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE burn_block_hash = $1
        ORDER BY canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(blockIdentifer.burnBlockHash)]
      );
    } else {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE burn_block_height = $1
        ORDER BY canonical DESC, block_height DESC
        LIMIT 1
        `,
        [blockIdentifer.burnBlockHeight]
      );
    }

    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = this.parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getBlockByHeightInternal(client: ClientBase, blockHeight: number) {
    const result = await client.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE block_height = $1 AND canonical = true
      `,
      [blockHeight]
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = this.parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getCurrentBlock() {
    return this.query(async client => {
      return this.getCurrentBlockInternal(client);
    });
  }

  async getCurrentBlockHeight(): Promise<FoundOrNot<number>> {
    return this.query(async client => {
      const result = await client.query<{ block_height: number }>(
        `
        SELECT block_height
        FROM blocks
        WHERE canonical = true
        ORDER BY block_height DESC
        LIMIT 1
        `
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      return { found: true, result: row.block_height } as const;
    });
  }

  async getCurrentBlockInternal(client: ClientBase) {
    const result = await client.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE canonical = true
      ORDER BY block_height DESC
      LIMIT 1
      `
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = this.parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getBlocks({ limit, offset }: { limit: number; offset: number }) {
    return this.queryTx(async client => {
      const total = await client.query<{ count: number }>(`
        SELECT COUNT(*)::integer
        FROM blocks
        WHERE canonical = true
      `);
      const results = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE canonical = true
        ORDER BY block_height DESC
        LIMIT $1
        OFFSET $2
        `,
        [limit, offset]
      );
      const parsed = results.rows.map(r => this.parseBlockQueryResult(r));
      return { results: parsed, total: total.rows[0].count } as const;
    });
  }

  async getBlockTxs(indexBlockHash: string) {
    return this.query(async client => {
      const result = await client.query<{ tx_id: Buffer; tx_index: number }>(
        `
        SELECT tx_id, tx_index
        FROM txs
        WHERE index_block_hash = $1 AND canonical = true AND microblock_canonical = true
        `,
        [hexToBuffer(indexBlockHash)]
      );
      const txIds = result.rows
        .sort(tx => tx.tx_index)
        .map(tx => bufferToHexPrefixString(tx.tx_id));
      return { results: txIds };
    });
  }

  async getBlockTxsRows(blockHash: string) {
    return this.queryTx(async client => {
      const blockQuery = await this.getBlockInternal(client, { hash: blockHash });
      if (!blockQuery.found) {
        throw new Error(`Could not find block by hash ${blockHash}`);
      }
      const result = await client.query<ContractTxQueryResult>(
        `
        -- getBlockTxsRows
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE index_block_hash = $1 AND canonical = true AND microblock_canonical = true
        ORDER BY microblock_sequence ASC, tx_index ASC
        `,
        [hexToBuffer(blockQuery.result.index_block_hash)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const parsed = result.rows.map(r => this.parseTxQueryResult(r));
      return { found: true, result: parsed };
    });
  }

  async updateBurnchainRewardSlotHolders({
    burnchainBlockHash,
    burnchainBlockHeight,
    slotHolders,
  }: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    slotHolders: DbRewardSlotHolder[];
  }): Promise<void> {
    await this.queryTx(async client => {
      const existingSlotHolders = await client.query<{
        address: string;
      }>(
        `
        UPDATE reward_slot_holders
        SET canonical = false
        WHERE canonical = true AND (burn_block_hash = $1 OR burn_block_height >= $2)
        RETURNING address
        `,
        [hexToBuffer(burnchainBlockHash), burnchainBlockHeight]
      );
      if (existingSlotHolders.rowCount > 0) {
        logger.warn(
          `Invalidated ${existingSlotHolders.rowCount} burnchain reward slot holders after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }
      if (slotHolders.length === 0) {
        return;
      }
      const insertParams = this.generateParameterizedInsertString({
        rowCount: slotHolders.length,
        columnCount: 5,
      });
      const values: any[] = [];
      slotHolders.forEach(val => {
        values.push(
          val.canonical,
          hexToBuffer(val.burn_block_hash),
          val.burn_block_height,
          val.address,
          val.slot_index
        );
      });
      const result = await client.query(
        `
        INSERT INTO reward_slot_holders(
          canonical, burn_block_hash, burn_block_height, address, slot_index
        ) VALUES ${insertParams}
        `,
        values
      );
      if (result.rowCount !== slotHolders.length) {
        throw new Error(
          `Unexpected row count after inserting reward slot holders: ${result.rowCount} vs ${slotHolders.length}`
        );
      }
    });
  }

  async getBurnchainRewardSlotHolders({
    burnchainAddress,
    limit,
    offset,
  }: {
    burnchainAddress?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; slotHolders: DbRewardSlotHolder[] }> {
    return await this.query(async client => {
      const queryResults = await client.query<{
        burn_block_hash: Buffer;
        burn_block_height: number;
        address: string;
        slot_index: number;
        count: number;
      }>(
        `
        SELECT
          burn_block_hash, burn_block_height, address, slot_index,
          (COUNT(*) OVER())::integer AS count
        FROM reward_slot_holders
        WHERE canonical = true ${burnchainAddress ? 'AND address = $3' : ''}
        ORDER BY burn_block_height DESC, slot_index DESC
        LIMIT $1
        OFFSET $2
        `,
        burnchainAddress ? [limit, offset, burnchainAddress] : [limit, offset]
      );
      const count = queryResults.rows[0]?.count ?? 0;
      const slotHolders = queryResults.rows.map(r => {
        const parsed: DbRewardSlotHolder = {
          canonical: true,
          burn_block_hash: bufferToHexPrefixString(r.burn_block_hash),
          burn_block_height: r.burn_block_height,
          address: r.address,
          slot_index: r.slot_index,
        };
        return parsed;
      });
      return {
        total: count,
        slotHolders,
      };
    });
  }

  async getTxsFromBlock(
    blockIdentifer: BlockIdentifier,
    limit: number,
    offset: number
  ): Promise<FoundOrNot<{ results: DbTx[]; total: number }>> {
    return this.queryTx(async client => {
      const blockQuery = await this.getBlockInternal(client, blockIdentifer);
      if (!blockQuery.found) {
        return { found: false };
      }
      const totalQuery = await client.query<{ count: number }>(
        `
        SELECT COUNT(*)::integer
        FROM txs
        WHERE canonical = true AND microblock_canonical = true AND index_block_hash = $1
        `,
        [hexToBuffer(blockQuery.result.index_block_hash)]
      );
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE canonical = true AND microblock_canonical = true AND index_block_hash = $1
        ORDER BY microblock_sequence DESC, tx_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [hexToBuffer(blockQuery.result.index_block_hash), limit, offset]
      );
      const total = totalQuery.rowCount > 0 ? totalQuery.rows[0].count : 0;
      const parsed = result.rows.map(r => this.parseTxQueryResult(r));
      return { found: true, result: { results: parsed, total } };
    });
  }

  async updateBurnchainRewards({
    burnchainBlockHash,
    burnchainBlockHeight,
    rewards,
  }: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void> {
    return this.queryTx(async client => {
      const existingRewards = await client.query<{
        reward_recipient: string;
        reward_amount: string;
      }>(
        `
        UPDATE burnchain_rewards
        SET canonical = false
        WHERE canonical = true AND (burn_block_hash = $1 OR burn_block_height >= $2)
        RETURNING reward_recipient, reward_amount
        `,
        [hexToBuffer(burnchainBlockHash), burnchainBlockHeight]
      );
      if (existingRewards.rowCount > 0) {
        logger.warn(
          `Invalidated ${existingRewards.rowCount} burnchain rewards after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }

      for (const reward of rewards) {
        const rewardInsertResult = await client.query(
          `
          INSERT into burnchain_rewards(
            canonical, burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index
          ) values($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            true,
            hexToBuffer(reward.burn_block_hash),
            reward.burn_block_height,
            reward.burn_amount,
            reward.reward_recipient,
            reward.reward_amount,
            reward.reward_index,
          ]
        );
        if (rewardInsertResult.rowCount !== 1) {
          throw new Error(`Failed to insert burnchain reward at block ${reward.burn_block_hash}`);
        }
      }
    });
  }

  async getBurnchainRewards({
    burnchainRecipient,
    limit,
    offset,
  }: {
    burnchainRecipient?: string;
    limit: number;
    offset: number;
  }): Promise<DbBurnchainReward[]> {
    return this.query(async client => {
      const queryResults = await client.query<{
        burn_block_hash: Buffer;
        burn_block_height: number;
        burn_amount: string;
        reward_recipient: string;
        reward_amount: string;
        reward_index: number;
      }>(
        `
        SELECT burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index
        FROM burnchain_rewards
        WHERE canonical = true ${burnchainRecipient ? 'AND reward_recipient = $3' : ''}
        ORDER BY burn_block_height DESC, reward_index DESC
        LIMIT $1
        OFFSET $2
        `,
        burnchainRecipient ? [limit, offset, burnchainRecipient] : [limit, offset]
      );
      return queryResults.rows.map(r => {
        const parsed: DbBurnchainReward = {
          canonical: true,
          burn_block_hash: bufferToHexPrefixString(r.burn_block_hash),
          burn_block_height: r.burn_block_height,
          burn_amount: BigInt(r.burn_amount),
          reward_recipient: r.reward_recipient,
          reward_amount: BigInt(r.reward_amount),
          reward_index: r.reward_index,
        };
        return parsed;
      });
    });
  }
  async getMinersRewardsAtHeight({
    blockHeight,
  }: {
    blockHeight: number;
  }): Promise<DbMinerReward[]> {
    return this.query(async client => {
      const queryResults = await client.query<{
        block_hash: Buffer;
        from_index_block_hash: Buffer;
        index_block_hash: Buffer;
        mature_block_height: number;
        recipient: string;
        coinbase_amount: number;
        tx_fees_anchored: number;
        tx_fees_streamed_confirmed: number;
        tx_fees_streamed_produced: number;
      }>(
        `
        SELECT id, mature_block_height, recipient, block_hash, index_block_hash, from_index_block_hash, canonical, coinbase_amount, tx_fees_anchored, tx_fees_streamed_confirmed, tx_fees_streamed_produced
        FROM miner_rewards
        WHERE canonical = true AND mature_block_height = $1
        ORDER BY id DESC
        `,
        [blockHeight]
      );
      return queryResults.rows.map(r => {
        const parsed: DbMinerReward = {
          block_hash: bufferToHexPrefixString(r.block_hash),
          from_index_block_hash: bufferToHexPrefixString(r.from_index_block_hash),
          index_block_hash: bufferToHexPrefixString(r.index_block_hash),
          canonical: true,
          mature_block_height: r.mature_block_height,
          recipient: r.recipient,
          coinbase_amount: BigInt(r.coinbase_amount),
          tx_fees_anchored: BigInt(r.tx_fees_anchored),
          tx_fees_streamed_confirmed: BigInt(r.tx_fees_streamed_confirmed),
          tx_fees_streamed_produced: BigInt(r.tx_fees_streamed_produced),
        };
        return parsed;
      });
    });
  }

  async getBurnchainRewardsTotal(
    burnchainRecipient: string
  ): Promise<{ reward_recipient: string; reward_amount: bigint }> {
    return this.query(async client => {
      const queryResults = await client.query<{
        amount: string;
      }>(
        `
        SELECT sum(reward_amount) amount
        FROM burnchain_rewards
        WHERE canonical = true AND reward_recipient = $1
        `,
        [burnchainRecipient]
      );
      const resultAmount = BigInt(queryResults.rows[0]?.amount ?? 0);
      return { reward_recipient: burnchainRecipient, reward_amount: resultAmount };
    });
  }

  async updateTx(client: ClientBase, tx: DbTx): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO txs(
        ${TX_COLUMNS}
      ) values(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37,
        $38, $39, $40, $41, $42
      )
      -- ON CONFLICT ON CONSTRAINT unique_tx_id_index_block_hash
      -- DO NOTHING
      `,
      [
        hexToBuffer(tx.tx_id),
        tx.raw_tx,
        tx.tx_index,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.block_hash),
        hexToBuffer(tx.parent_block_hash),
        tx.block_height,
        tx.burn_block_time,
        tx.parent_burn_block_time,
        tx.type_id,
        tx.anchor_mode,
        tx.status,
        tx.canonical,
        tx.post_conditions,
        tx.nonce,
        tx.fee_rate,
        tx.sponsored,
        tx.sponsor_address,
        tx.sender_address,
        tx.origin_hash_mode,
        tx.microblock_canonical,
        tx.microblock_sequence,
        hexToBuffer(tx.microblock_hash),
        tx.token_transfer_recipient_address,
        tx.token_transfer_amount,
        tx.token_transfer_memo,
        tx.smart_contract_contract_id,
        tx.smart_contract_source_code,
        tx.contract_call_contract_id,
        tx.contract_call_function_name,
        tx.contract_call_function_args,
        tx.poison_microblock_header_1,
        tx.poison_microblock_header_2,
        tx.coinbase_payload,
        hexToBuffer(tx.raw_result),
        tx.event_count,
        tx.execution_cost_read_count,
        tx.execution_cost_read_length,
        tx.execution_cost_runtime,
        tx.execution_cost_write_count,
        tx.execution_cost_write_length,
      ]
    );
    return result.rowCount;
  }

  async updateMempoolTxs({ mempoolTxs: txs }: { mempoolTxs: DbMempoolTx[] }): Promise<void> {
    const updatedTxs: DbMempoolTx[] = [];
    await this.queryTx(async client => {
      for (const tx of txs) {
        const result = await client.query(
          `
          INSERT INTO mempool_txs(
            ${MEMPOOL_TX_COLUMNS}
          ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
          ON CONFLICT ON CONSTRAINT unique_tx_id
          DO NOTHING
          `,
          [
            tx.pruned,
            hexToBuffer(tx.tx_id),
            tx.raw_tx,
            tx.type_id,
            tx.anchor_mode,
            tx.status,
            tx.receipt_time,
            tx.post_conditions,
            tx.nonce,
            tx.fee_rate,
            tx.sponsored,
            tx.sponsor_address,
            tx.sender_address,
            tx.origin_hash_mode,
            tx.token_transfer_recipient_address,
            tx.token_transfer_amount,
            tx.token_transfer_memo,
            tx.smart_contract_contract_id,
            tx.smart_contract_source_code,
            tx.contract_call_contract_id,
            tx.contract_call_function_name,
            tx.contract_call_function_args,
            tx.poison_microblock_header_1,
            tx.poison_microblock_header_2,
            tx.coinbase_payload,
          ]
        );
        if (result.rowCount !== 1) {
          const errMsg = `A duplicate transaction was attempted to be inserted into the mempool_txs table: ${tx.tx_id}`;
          logger.warn(errMsg);
        } else {
          updatedTxs.push(tx);
        }
      }
    });
    for (const tx of updatedTxs) {
      await this.notifier?.sendTx({ txId: tx.tx_id });
    }
  }

  async dropMempoolTxs({ status, txIds }: { status: DbTxStatus; txIds: string[] }): Promise<void> {
    let updatedTxs: DbMempoolTx[] = [];
    await this.queryTx(async client => {
      const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
      const updateResults = await client.query<MempoolTxQueryResult>(
        `
        UPDATE mempool_txs
        SET pruned = true, status = $2
        WHERE tx_id = ANY($1)
        RETURNING ${MEMPOOL_TX_COLUMNS}
        `,
        [txIdBuffers, status]
      );
      updatedTxs = updateResults.rows.map(r => this.parseMempoolTxQueryResult(r));
    });
    for (const tx of updatedTxs) {
      await this.notifier?.sendTx({ txId: tx.tx_id });
    }
  }

  parseMempoolTxQueryResult(result: MempoolTxQueryResult): DbMempoolTx {
    const tx: DbMempoolTx = {
      pruned: result.pruned,
      tx_id: bufferToHexPrefixString(result.tx_id),
      nonce: result.nonce,
      raw_tx: result.raw_tx,
      type_id: result.type_id as DbTxTypeId,
      anchor_mode: result.anchor_mode as DbTxAnchorMode,
      status: result.status,
      receipt_time: result.receipt_time,
      post_conditions: result.post_conditions,
      fee_rate: BigInt(result.fee_rate),
      sponsored: result.sponsored,
      sponsor_address: result.sponsor_address ?? undefined,
      sender_address: result.sender_address,
      origin_hash_mode: result.origin_hash_mode,
      abi: result.abi,
    };
    this.parseTxTypeSpecificQueryResult(result, tx);
    return tx;
  }

  parseTxQueryResult(result: ContractTxQueryResult): DbTx {
    const tx: DbTx = {
      tx_id: bufferToHexPrefixString(result.tx_id),
      tx_index: result.tx_index,
      nonce: result.nonce,
      raw_tx: result.raw_tx,
      index_block_hash: bufferToHexPrefixString(result.index_block_hash),
      parent_index_block_hash: bufferToHexPrefixString(result.parent_index_block_hash),
      block_hash: bufferToHexPrefixString(result.block_hash),
      parent_block_hash: bufferToHexPrefixString(result.parent_block_hash),
      block_height: result.block_height,
      burn_block_time: result.burn_block_time,
      parent_burn_block_time: result.parent_burn_block_time,
      type_id: result.type_id as DbTxTypeId,
      anchor_mode: result.anchor_mode as DbTxAnchorMode,
      status: result.status,
      raw_result: bufferToHexPrefixString(result.raw_result),
      canonical: result.canonical,
      microblock_canonical: result.microblock_canonical,
      microblock_sequence: result.microblock_sequence,
      microblock_hash: bufferToHexPrefixString(result.microblock_hash),
      post_conditions: result.post_conditions,
      fee_rate: BigInt(result.fee_rate),
      sponsored: result.sponsored,
      sponsor_address: result.sponsor_address ?? undefined,
      sender_address: result.sender_address,
      origin_hash_mode: result.origin_hash_mode,
      event_count: result.event_count,
      execution_cost_read_count: Number.parseInt(result.execution_cost_read_count),
      execution_cost_read_length: Number.parseInt(result.execution_cost_read_length),
      execution_cost_runtime: Number.parseInt(result.execution_cost_runtime),
      execution_cost_write_count: Number.parseInt(result.execution_cost_write_count),
      execution_cost_write_length: Number.parseInt(result.execution_cost_write_length),
      abi: result.abi,
    };
    this.parseTxTypeSpecificQueryResult(result, tx);
    return tx;
  }

  parseTxTypeSpecificQueryResult(
    result: MempoolTxQueryResult | TxQueryResult,
    target: DbTx | DbMempoolTx
  ) {
    if (target.type_id === DbTxTypeId.TokenTransfer) {
      target.token_transfer_recipient_address = result.token_transfer_recipient_address;
      target.token_transfer_amount = BigInt(result.token_transfer_amount ?? 0);
      target.token_transfer_memo = result.token_transfer_memo;
    } else if (target.type_id === DbTxTypeId.SmartContract) {
      target.smart_contract_contract_id = result.smart_contract_contract_id;
      target.smart_contract_source_code = result.smart_contract_source_code;
    } else if (target.type_id === DbTxTypeId.ContractCall) {
      target.contract_call_contract_id = result.contract_call_contract_id;
      target.contract_call_function_name = result.contract_call_function_name;
      target.contract_call_function_args = result.contract_call_function_args;
    } else if (target.type_id === DbTxTypeId.PoisonMicroblock) {
      target.poison_microblock_header_1 = result.poison_microblock_header_1;
      target.poison_microblock_header_2 = result.poison_microblock_header_2;
    } else if (target.type_id === DbTxTypeId.Coinbase) {
      target.coinbase_payload = result.coinbase_payload;
    } else {
      throw new Error(`Received unexpected tx type_id from db query: ${target.type_id}`);
    }
  }

  parseMicroblockQueryResult(result: MicroblockQueryResult): DbMicroblock {
    const microblock: DbMicroblock = {
      canonical: result.canonical,
      microblock_canonical: result.microblock_canonical,
      microblock_hash: bufferToHexPrefixString(result.microblock_hash),
      microblock_sequence: result.microblock_sequence,
      microblock_parent_hash: bufferToHexPrefixString(result.microblock_parent_hash),
      parent_index_block_hash: bufferToHexPrefixString(result.parent_index_block_hash),
      block_height: result.block_height,
      parent_block_height: result.parent_block_height,
      parent_block_hash: bufferToHexPrefixString(result.parent_block_hash),
      index_block_hash: bufferToHexPrefixString(result.index_block_hash),
      block_hash: bufferToHexPrefixString(result.block_hash),
      parent_burn_block_height: result.parent_burn_block_height,
      parent_burn_block_hash: bufferToHexPrefixString(result.parent_burn_block_hash),
      parent_burn_block_time: result.parent_burn_block_time,
    };
    return microblock;
  }

  parseFaucetRequestQueryResult(result: FaucetRequestQueryResult): DbFaucetRequest {
    const tx: DbFaucetRequest = {
      currency: result.currency as DbFaucetRequestCurrency,
      address: result.address,
      ip: result.ip,
      occurred_at: parseInt(result.occurred_at),
    };
    return tx;
  }

  private async parseMempoolTransactions(
    result: QueryResult<MempoolTxQueryResult>,
    client: ClientBase,
    includeUnanchored: boolean
  ) {
    if (result.rowCount === 0) {
      return [];
    }
    const pruned = result.rows.filter(memTx => memTx.pruned && !includeUnanchored);
    if (pruned.length !== 0) {
      const unanchoredBlockHeight = await this.getMaxBlockHeight(client, {
        includeUnanchored: true,
      });
      const notPrunedBufferTxIds = pruned.map(tx => tx.tx_id);
      const query = await client.query<{ tx_id: Buffer }>(
        `
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true 
          AND tx_id = ANY($1)
          AND block_height = $2
          `,
        [notPrunedBufferTxIds, unanchoredBlockHeight]
      );
      // The tx is marked as pruned because it's in an unanchored microblock
      query.rows.forEach(tran => {
        const transaction = result.rows.find(
          tx => bufferToHexPrefixString(tx.tx_id) === bufferToHexPrefixString(tran.tx_id)
        );
        if (transaction) {
          transaction.pruned = false;
          transaction.status = DbTxStatus.Pending;
        }
      });
    }
    return result.rows.map(transaction => this.parseMempoolTxQueryResult(transaction));
  }

  async getMempoolTxs(args: {
    txIds: string[];
    includeUnanchored: boolean;
    includePruned?: boolean;
  }): Promise<DbMempoolTx[]> {
    return this.queryTx(async client => {
      const hexTxIds = args.txIds.map(txId => hexToBuffer(txId));
      const result = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs
        WHERE tx_id = ANY($1)
        `,
        [hexTxIds]
      );
      return await this.parseMempoolTransactions(result, client, args.includeUnanchored);
    });
  }

  async getMempoolTx({
    txId,
    includePruned,
    includeUnanchored,
  }: {
    txId: string;
    includeUnanchored: boolean;
    includePruned?: boolean;
  }) {
    return this.queryTx(async client => {
      const result = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs
        WHERE tx_id = $1
        `,
        [hexToBuffer(txId)]
      );
      // Treat the tx as "not pruned" if it's in an unconfirmed microblock and the caller is has not opted-in to unanchored data.
      if (result.rows[0]?.pruned && !includeUnanchored) {
        const unanchoredBlockHeight = await this.getMaxBlockHeight(client, {
          includeUnanchored: true,
        });
        const query = await client.query<{ tx_id: Buffer }>(
          `
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
          AND block_height = $1
          AND tx_id = $2
          LIMIT 1
          `,
          [unanchoredBlockHeight, hexToBuffer(txId)]
        );
        // The tx is marked as pruned because it's in an unanchored microblock
        if (query.rowCount > 0) {
          result.rows[0].pruned = false;
          result.rows[0].status = DbTxStatus.Pending;
        }
      }
      if (result.rowCount === 0 || (!includePruned && result.rows[0].pruned)) {
        return { found: false } as const;
      }
      if (result.rowCount > 1) {
        throw new Error(`Multiple transactions found in mempool table for txid: ${txId}`);
      }
      const rows = await this.parseMempoolTransactions(result, client, includeUnanchored);
      const tx = rows[0];
      return { found: true, result: tx };
    });
  }

  async getDroppedTxs({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    return await this.queryTx(async client => {
      const droppedStatuses = [
        DbTxStatus.DroppedReplaceByFee,
        DbTxStatus.DroppedReplaceAcrossFork,
        DbTxStatus.DroppedTooExpensive,
        DbTxStatus.DroppedStaleGarbageCollect,
      ];
      const selectCols = MEMPOOL_TX_COLUMNS.replace('tx_id', 'mempool.tx_id');
      const resultQuery = await client.query<MempoolTxQueryResult & { count: string }>(
        `
        SELECT ${selectCols}, ${abiColumn('mempool')}, COUNT(*) OVER() AS count
        FROM (
          SELECT *
          FROM mempool_txs
          WHERE pruned = true AND status = ANY($1)
        ) mempool
        LEFT JOIN (
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
        ) mined
        ON mempool.tx_id = mined.tx_id
        WHERE mined.tx_id IS NULL
        ORDER BY receipt_time DESC
        LIMIT $2
        OFFSET $3
        `,
        [droppedStatuses, limit, offset]
      );
      const count = resultQuery.rows.length > 0 ? parseInt(resultQuery.rows[0].count) : 0;
      const mempoolTxs = resultQuery.rows.map(r => this.parseMempoolTxQueryResult(r));
      return { results: mempoolTxs, total: count };
    });
  }

  async getMempoolTxList({
    limit,
    offset,
    includeUnanchored,
    senderAddress,
    recipientAddress,
    address,
  }: {
    limit: number;
    offset: number;
    includeUnanchored: boolean;
    senderAddress?: string;
    recipientAddress?: string;
    address?: string;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    const whereConditions: string[] = [];
    const queryValues: any[] = [];

    if (address) {
      whereConditions.push(
        `(sender_address = $$
          OR token_transfer_recipient_address = $$
          OR smart_contract_contract_id = $$
          OR contract_call_contract_id = $$)`
      );
      queryValues.push(address, address, address, address);
    } else if (senderAddress && recipientAddress) {
      whereConditions.push('(sender_address = $$ AND token_transfer_recipient_address = $$)');
      queryValues.push(senderAddress, recipientAddress);
    } else if (senderAddress) {
      whereConditions.push('sender_address = $$');
      queryValues.push(senderAddress);
    } else if (recipientAddress) {
      whereConditions.push('token_transfer_recipient_address = $$');
      queryValues.push(recipientAddress);
    }

    const queryResult = await this.queryTx(async client => {
      // If caller did not opt-in to unanchored tx data, then treat unanchored txs as pending mempool txs.
      if (!includeUnanchored) {
        const unanchoredTxs = (await this.getUnanchoredTxsInternal(client)).txs.map(tx =>
          hexToBuffer(tx.tx_id)
        );
        whereConditions.push('(pruned = false OR tx_id = ANY($$))');
        queryValues.push(unanchoredTxs);
      } else {
        whereConditions.push('pruned = false');
      }
      let paramNum = 1;
      const whereCondition = whereConditions.join(' AND ').replace(/\$\$/g, () => `$${paramNum++}`);
      const totalQuery = await client.query<{ count: number }>(
        `
        SELECT COUNT(*)::integer
        FROM mempool_txs
        WHERE ${whereCondition}
        `,
        [...queryValues]
      );
      const resultQuery = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs
        WHERE ${whereCondition}
        ORDER BY receipt_time DESC
        LIMIT $${queryValues.length + 1}
        OFFSET $${queryValues.length + 2}
        `,
        [...queryValues, limit, offset]
      );
      return { total: totalQuery.rows[0].count, rows: resultQuery.rows };
    });

    const parsed = queryResult.rows.map(r => {
      // Ensure pruned and status are reset since the result can contain txs that were pruned from unanchored microblocks
      r.pruned = false;
      r.status = DbTxStatus.Pending;
      return this.parseMempoolTxQueryResult(r);
    });
    return { results: parsed, total: queryResult.total };
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
      const tx = this.parseTxQueryResult(row);
      return { found: true, result: tx };
    });
  }

  async getTx({ txId, includeUnanchored }: { txId: string; includeUnanchored: boolean }) {
    return this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE tx_id = $1 AND block_height <= $2
        ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(txId), maxBlockHeight]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      const tx = this.parseTxQueryResult(row);
      return { found: true, result: tx };
    });
  }

  async getMaxBlockHeight(
    client: ClientBase,
    { includeUnanchored }: { includeUnanchored: boolean }
  ): Promise<number> {
    const chainTip = await this.getChainTip(client);
    if (includeUnanchored) {
      return chainTip.blockHeight + 1;
    } else {
      return chainTip.blockHeight;
    }
  }

  async getTxList({
    limit,
    offset,
    txTypeFilter,
    includeUnanchored,
  }: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
    includeUnanchored: boolean;
  }) {
    let totalQuery: QueryResult<{ count: number }>;
    let resultQuery: QueryResult<ContractTxQueryResult>;
    return this.queryTx(async client => {
      const maxHeight = await this.getMaxBlockHeight(client, { includeUnanchored });

      if (txTypeFilter.length === 0) {
        totalQuery = await client.query<{ count: number }>(
          `
          SELECT COUNT(*)::integer
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND block_height <= $1
          `,
          [maxHeight]
        );
        resultQuery = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND block_height <= $3
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT $1
          OFFSET $2
          `,
          [limit, offset, maxHeight]
        );
      } else {
        const txTypeIds = txTypeFilter.map<number>(t => getTxTypeId(t));
        totalQuery = await client.query<{ count: number }>(
          `
          SELECT COUNT(*)::integer
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND type_id = ANY($1) AND block_height <= $2
          `,
          [txTypeIds, maxHeight]
        );
        resultQuery = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND type_id = ANY($1) AND block_height <= $4
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT $2
          OFFSET $3
          `,
          [txTypeIds, limit, offset, maxHeight]
        );
      }
      const parsed = resultQuery.rows.map(r => this.parseTxQueryResult(r));
      return { results: parsed, total: totalQuery.rows[0].count };
    });
  }

  getTxListEvents(args: {
    txs: {
      txId: string;
      indexBlockHash: string;
    }[];
    limit: number;
    offset: number;
  }) {
    return this.queryTx(async client => {
      // preparing condition to query from
      // condition = (tx_id=$1 AND index_block_hash=$2) OR (tx_id=$3 AND index_block_hash=$4)
      // let condition = this.generateParameterizedWhereAndOrClause(args.txs);
      if (args.txs.length === 0) return { results: [] };
      let condition = '(tx_id, index_block_hash) = ANY(VALUES ';
      let counter = 1;
      const transactionValues = args.txs
        .map(_ => {
          const singleCondition = '($' + counter + '::bytea, $' + (counter + 1) + '::bytea)';
          counter += 2;
          return singleCondition;
        })
        .join(', ');
      condition += transactionValues + ')';
      // preparing values for condition
      // conditionParams = [tx_id1, index_block_hash1, tx_id2, index_block_hash2]
      const conditionParams: Buffer[] = [];
      args.txs.forEach(transaction =>
        conditionParams.push(hexToBuffer(transaction.txId), hexToBuffer(transaction.indexBlockHash))
      );
      const eventIndexStart = args.offset;
      const eventIndexEnd = args.offset + args.limit - 1;
      // preparing complete where clause condition
      const paramEventIndexStart = args.txs.length * 2 + 1;
      const paramEventIndexEnd = paramEventIndexStart + 1;
      condition =
        condition +
        ' AND microblock_canonical = true AND event_index BETWEEN $' +
        paramEventIndexStart +
        ' AND $' +
        paramEventIndexEnd;
      const stxLockResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        locked_amount: string;
        unlock_height: string;
        locked_address: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address
        FROM stx_lock_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const stxResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount
        FROM stx_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const ftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
        FROM ft_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const nftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
        FROM nft_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, contract_identifier, topic, value
        FROM contract_logs
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      return {
        results: this.parseDbEvents(stxLockResults, stxResults, ftResults, nftResults, logResults),
      };
    });
  }

  async getTxEvents(args: { txId: string; indexBlockHash: string; limit: number; offset: number }) {
    // Note: when this is used to fetch events for an unanchored microblock tx, the `indexBlockHash` is empty
    // which will cause the sql queries to also match micro-orphaned tx data (resulting in duplicate event results).
    // To prevent that, all micro-orphaned events are excluded using `microblock_orphaned=false`.
    // That means, unlike regular orphaned txs, if a micro-orphaned tx is never re-mined, the micro-orphaned event data
    // will never be returned.
    return this.queryTx(async client => {
      const eventIndexStart = args.offset;
      const eventIndexEnd = args.offset + args.limit - 1;
      const txIdBuffer = hexToBuffer(args.txId);
      const blockHashBuffer = hexToBuffer(args.indexBlockHash);
      const stxLockResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        locked_amount: string;
        unlock_height: string;
        locked_address: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address
        FROM stx_lock_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const stxResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount
        FROM stx_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const ftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
        FROM ft_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const nftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
        FROM nft_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, contract_identifier, topic, value
        FROM contract_logs
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      return {
        results: this.parseDbEvents(stxLockResults, stxResults, ftResults, nftResults, logResults),
      };
    });
  }

  parseDbEvents(
    stxLockResults: QueryResult<{
      event_index: number;
      tx_id: Buffer;
      tx_index: number;
      block_height: number;
      canonical: boolean;
      locked_amount: string;
      unlock_height: string;
      locked_address: string;
    }>,
    stxResults: QueryResult<{
      event_index: number;
      tx_id: Buffer;
      tx_index: number;
      block_height: number;
      canonical: boolean;
      asset_event_type_id: number;
      sender?: string | undefined;
      recipient?: string | undefined;
      amount: string;
    }>,
    ftResults: QueryResult<{
      event_index: number;
      tx_id: Buffer;
      tx_index: number;
      block_height: number;
      canonical: boolean;
      asset_event_type_id: number;
      sender?: string | undefined;
      recipient?: string | undefined;
      asset_identifier: string;
      amount: string;
    }>,
    nftResults: QueryResult<{
      event_index: number;
      tx_id: Buffer;
      tx_index: number;
      block_height: number;
      canonical: boolean;
      asset_event_type_id: number;
      sender?: string | undefined;
      recipient?: string | undefined;
      asset_identifier: string;
      value: Buffer;
    }>,
    logResults: QueryResult<{
      event_index: number;
      tx_id: Buffer;
      tx_index: number;
      block_height: number;
      canonical: boolean;
      contract_identifier: string;
      topic: string;
      value: Buffer;
    }>
  ) {
    const events = new Array<DbEvent>(
      stxResults.rowCount +
        nftResults.rowCount +
        ftResults.rowCount +
        logResults.rowCount +
        stxLockResults.rowCount
    );
    let rowIndex = 0;
    for (const result of stxLockResults.rows) {
      const event: DbStxLockEvent = {
        event_type: DbEventTypeId.StxLock,
        event_index: result.event_index,
        tx_id: bufferToHexPrefixString(result.tx_id),
        tx_index: result.tx_index,
        block_height: result.block_height,
        canonical: result.canonical,
        locked_amount: BigInt(result.locked_amount),
        unlock_height: Number(result.unlock_height),
        locked_address: result.locked_address,
      };
      events[rowIndex++] = event;
    }
    for (const result of stxResults.rows) {
      const event: DbStxEvent = {
        event_index: result.event_index,
        tx_id: bufferToHexPrefixString(result.tx_id),
        tx_index: result.tx_index,
        block_height: result.block_height,
        canonical: result.canonical,
        asset_event_type_id: result.asset_event_type_id,
        sender: result.sender,
        recipient: result.recipient,
        event_type: DbEventTypeId.StxAsset,
        amount: BigInt(result.amount),
      };
      events[rowIndex++] = event;
    }
    for (const result of ftResults.rows) {
      const event: DbFtEvent = {
        event_index: result.event_index,
        tx_id: bufferToHexPrefixString(result.tx_id),
        tx_index: result.tx_index,
        block_height: result.block_height,
        canonical: result.canonical,
        asset_event_type_id: result.asset_event_type_id,
        sender: result.sender,
        recipient: result.recipient,
        asset_identifier: result.asset_identifier,
        event_type: DbEventTypeId.FungibleTokenAsset,
        amount: BigInt(result.amount),
      };
      events[rowIndex++] = event;
    }
    for (const result of nftResults.rows) {
      const event: DbNftEvent = {
        event_index: result.event_index,
        tx_id: bufferToHexPrefixString(result.tx_id),
        tx_index: result.tx_index,
        block_height: result.block_height,
        canonical: result.canonical,
        asset_event_type_id: result.asset_event_type_id,
        sender: result.sender,
        recipient: result.recipient,
        asset_identifier: result.asset_identifier,
        event_type: DbEventTypeId.NonFungibleTokenAsset,
        value: result.value,
      };
      events[rowIndex++] = event;
    }
    for (const result of logResults.rows) {
      const event: DbSmartContractEvent = {
        event_index: result.event_index,
        tx_id: bufferToHexPrefixString(result.tx_id),
        tx_index: result.tx_index,
        block_height: result.block_height,
        canonical: result.canonical,
        event_type: DbEventTypeId.SmartContractLog,
        contract_identifier: result.contract_identifier,
        topic: result.topic,
        value: result.value,
      };
      events[rowIndex++] = event;
    }
    events.sort((a, b) => a.event_index - b.event_index);
    return events;
  }

  async updateStxLockEvent(client: ClientBase, tx: DbTx, event: DbStxLockEvent) {
    await client.query(
      `
      INSERT INTO stx_lock_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, locked_amount, unlock_height, locked_address
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.locked_amount,
        event.unlock_height,
        event.locked_address,
      ]
    );
  }

  async updateBatchStxEvents(client: ClientBase, tx: DbTx, events: DbStxEvent[]) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
      const columnCount = 14;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: eventBatch.length,
        columnCount,
      });
      const values: any[] = [];
      for (const event of eventBatch) {
        values.push(
          event.event_index,
          hexToBuffer(event.tx_id),
          event.tx_index,
          event.block_height,
          hexToBuffer(tx.index_block_hash),
          hexToBuffer(tx.parent_index_block_hash),
          hexToBuffer(tx.microblock_hash),
          tx.microblock_sequence,
          tx.microblock_canonical,
          event.canonical,
          event.asset_event_type_id,
          event.sender,
          event.recipient,
          event.amount
        );
      }
      const insertQuery = `INSERT INTO stx_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, asset_event_type_id, sender, recipient, amount
      ) VALUES ${insertParams}`;
      const insertQueryName = `insert-batch-stx-events_${columnCount}x${eventBatch.length}`;
      const insertStxEventQuery: QueryConfig = {
        name: insertQueryName,
        text: insertQuery,
        values,
      };
      const res = await client.query(insertStxEventQuery);
      if (res.rowCount !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.rowCount}`);
      }
    }
  }

  /**
   * Update the `principal_stx_tx` table with the latest `tx_id`s that resulted in a STX
   * transfer relevant to a principal (stx address or contract id).
   * Only canonical transactions will be kept.
   * @param client - DB client
   * @param tx - Transaction
   * @param events - Transaction STX events
   */
  async updatePrincipalStxTxs(client: ClientBase, tx: DbTx, events: DbStxEvent[]) {
    if (!tx.canonical || !tx.microblock_canonical) {
      return;
    }
    const insertPrincipalStxTxs = async (principals: string[]) => {
      principals = [...new Set(principals)]; // Remove duplicates
      const columnCount = 3;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: principals.length,
        columnCount,
      });
      const values: any[] = [];
      for (const principal of principals) {
        values.push(principal, hexToBuffer(tx.tx_id), tx.block_height);
      }
      // If there was already an existing (`tx_id`, `principal`) pair in the table, we will update
      // the entry's `block_height` to reflect the newer block.
      const insertQuery = `
        INSERT INTO principal_stx_txs (principal, tx_id, block_height)
        VALUES ${insertParams}
        ON CONFLICT
          ON CONSTRAINT unique_principal_tx_id
          DO UPDATE
            SET block_height = EXCLUDED.block_height
            WHERE EXCLUDED.block_height > principal_stx_txs.block_height
        `;
      const insertQueryName = `insert-batch-principal_stx_txs_${columnCount}x${principals.length}`;
      const insertQueryConfig: QueryConfig = {
        name: insertQueryName,
        text: insertQuery,
        values,
      };
      await client.query(insertQueryConfig);
    };
    // Insert tx data
    await insertPrincipalStxTxs(
      [
        tx.sender_address,
        tx.token_transfer_recipient_address,
        tx.contract_call_contract_id,
        tx.smart_contract_contract_id,
      ].filter((p): p is string => !!p) // Remove undefined
    );
    // Insert stx_event data
    const batchSize = 500;
    for (const eventBatch of batchIterate(events, batchSize)) {
      const principals: string[] = [];
      for (const event of eventBatch) {
        if (!event.canonical) {
          continue;
        }
        if (event.sender) principals.push(event.sender);
        if (event.recipient) principals.push(event.recipient);
      }
      await insertPrincipalStxTxs(principals);
    }
  }

  async updateBatchSubdomains(
    client: ClientBase,
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    subdomains: DbBnsSubdomain[]
  ) {
    // bns insertion variables
    const columnCount = 18;
    const insertParams = this.generateParameterizedInsertString({
      rowCount: subdomains.length,
      columnCount,
    });
    const values: any[] = [];
    // zonefile insertion variables
    const zonefilesColumnCount = 2;
    const zonefileInsertParams = this.generateParameterizedInsertString({
      rowCount: subdomains.length,
      columnCount: zonefilesColumnCount,
    });
    const zonefileValues: string[] = [];
    for (const subdomain of subdomains) {
      let txIndex = subdomain.tx_index;
      if (txIndex === -1) {
        const txQuery = await client.query<{ tx_index: number }>(
          `
          SELECT tx_index from txs
          WHERE tx_id = $1 AND index_block_hash = $2 AND block_height = $3
          LIMIT 1
          `,
          [
            hexToBuffer(subdomain.tx_id),
            hexToBuffer(blockData.index_block_hash),
            subdomain.block_height,
          ]
        );
        if (txQuery.rowCount === 0) {
          logger.warn(`Could not find tx index for subdomain entry: ${JSON.stringify(subdomain)}`);
          txIndex = 0;
        } else {
          txIndex = txQuery.rows[0].tx_index;
        }
      }
      // preparing bns values for insertion
      values.push(
        subdomain.name,
        subdomain.namespace_id,
        subdomain.fully_qualified_subdomain,
        subdomain.owner,
        this.validateZonefileHash(subdomain.zonefile_hash),
        subdomain.parent_zonefile_hash,
        subdomain.parent_zonefile_index,
        subdomain.block_height,
        txIndex,
        subdomain.zonefile_offset,
        subdomain.resolver,
        subdomain.canonical,
        hexToBuffer(subdomain.tx_id),
        hexToBuffer(blockData.index_block_hash),
        hexToBuffer(blockData.parent_index_block_hash),
        hexToBuffer(blockData.microblock_hash),
        blockData.microblock_sequence,
        blockData.microblock_canonical
      );
      // preparing zonefile values for insertion
      zonefileValues.push(subdomain.zonefile, this.validateZonefileHash(subdomain.zonefile_hash));
    }
    // bns insertion query
    const insertQuery = `INSERT INTO subdomains (
        name, namespace_id, fully_qualified_subdomain, owner,
        zonefile_hash, parent_zonefile_hash, parent_zonefile_index, block_height, tx_index,
        zonefile_offset, resolver, canonical, tx_id,
        index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
      ) VALUES ${insertParams}`;
    const insertQueryName = `insert-batch-subdomains_${columnCount}x${subdomains.length}`;
    const insertBnsSubdomainsEventQuery: QueryConfig = {
      name: insertQueryName,
      text: insertQuery,
      values,
    };
    // zonefile insertion query
    const zonefileInsertQuery = `INSERT INTO zonefiles (zonefile, zonefile_hash) VALUES ${zonefileInsertParams}`;
    const insertZonefileQueryName = `insert-batch-zonefiles_${columnCount}x${subdomains.length}`;
    const insertZonefilesEventQuery: QueryConfig = {
      name: insertZonefileQueryName,
      text: zonefileInsertQuery,
      values: zonefileValues,
    };
    try {
      // checking for bns insertion errors
      const bnsRes = await client.query(insertBnsSubdomainsEventQuery);
      if (bnsRes.rowCount !== subdomains.length) {
        throw new Error(`Expected ${subdomains.length} inserts, got ${bnsRes.rowCount} for BNS`);
      }
      // checking for zonefile insertion errors
      const zonefilesRes = await client.query(insertZonefilesEventQuery);
      if (zonefilesRes.rowCount !== subdomains.length) {
        throw new Error(
          `Expected ${subdomains.length} inserts, got ${zonefilesRes.rowCount} for zonefiles`
        );
      }
    } catch (e: any) {
      logError(`subdomain errors ${e.message}`, e);
      throw e;
    }
  }

  cachedParameterizedInsertStrings = new Map<string, string>();

  generateParameterizedInsertString({
    columnCount,
    rowCount,
  }: {
    columnCount: number;
    rowCount: number;
  }): string {
    const cacheKey = `${columnCount}x${rowCount}`;
    const existing = this.cachedParameterizedInsertStrings.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }
    const params: string[][] = [];
    let i = 1;
    for (let r = 0; r < rowCount; r++) {
      params[r] = Array<string>(columnCount);
      for (let c = 0; c < columnCount; c++) {
        params[r][c] = `\$${i++}`;
      }
    }
    const stringRes = params.map(r => `(${r.join(',')})`).join(',');
    this.cachedParameterizedInsertStrings.set(cacheKey, stringRes);
    return stringRes;
  }

  async updateStxEvent(client: ClientBase, tx: DbTx, event: DbStxEvent) {
    const insertStxEventQuery: QueryConfig = {
      name: 'insert-stx-event',
      text: `
        INSERT INTO stx_events(
          event_index, tx_id, tx_index, block_height, index_block_hash,
          parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
          canonical, asset_event_type_id, sender, recipient, amount
        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      values: [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.amount,
      ],
    };
    await client.query(insertStxEventQuery);
  }

  async updateFtEvent(client: ClientBase, tx: DbTx, event: DbFtEvent) {
    await client.query(
      `
      INSERT INTO ft_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.amount,
      ]
    );
  }

  async updateNftEvent(client: ClientBase, tx: DbTx, event: DbNftEvent) {
    await client.query(
      `
      INSERT INTO nft_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, asset_event_type_id, sender, recipient, asset_identifier, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.value,
      ]
    );
  }

  async updateBatchSmartContractEvent(
    client: ClientBase,
    tx: DbTx,
    events: DbSmartContractEvent[]
  ) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
      const columnCount = 13;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: eventBatch.length,
        columnCount,
      });
      const values: any[] = [];
      for (const event of eventBatch) {
        values.push(
          event.event_index,
          hexToBuffer(event.tx_id),
          event.tx_index,
          event.block_height,
          hexToBuffer(tx.index_block_hash),
          hexToBuffer(tx.parent_index_block_hash),
          hexToBuffer(tx.microblock_hash),
          tx.microblock_sequence,
          tx.microblock_canonical,
          event.canonical,
          event.contract_identifier,
          event.topic,
          event.value
        );
      }
      const insertQueryText = `INSERT INTO contract_logs(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, contract_identifier, topic, value
      ) VALUES ${insertParams}`;
      const insertQueryName = `insert-batch-smart-contract-events_${columnCount}x${eventBatch.length}`;
      const insertQuery: QueryConfig = {
        name: insertQueryName,
        text: insertQueryText,
        values,
      };
      const res = await client.query(insertQuery);
      if (res.rowCount !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.rowCount}`);
      }
    }
  }

  async updateSmartContractEvent(client: ClientBase, tx: DbTx, event: DbSmartContractEvent) {
    await client.query(
      `
      INSERT INTO contract_logs(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, contract_identifier, topic, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.contract_identifier,
        event.topic,
        event.value,
      ]
    );
  }

  async getTokenMetadataQueue(
    limit: number,
    excludingEntries: number[]
  ): Promise<DbTokenMetadataQueueEntry[]> {
    const result = await this.queryTx(async client => {
      const queryResult = await client.query<DbTokenMetadataQueueEntryQuery>(
        `
        SELECT *
        FROM token_metadata_queue
        WHERE NOT (queue_id = ANY($1))
        AND processed = false
        ORDER BY block_height ASC, queue_id ASC
        LIMIT $2
        `,
        [excludingEntries, limit]
      );
      return queryResult;
    });
    const entries = result.rows.map(row => {
      const entry: DbTokenMetadataQueueEntry = {
        queueId: row.queue_id,
        txId: bufferToHexPrefixString(row.tx_id),
        contractId: row.contract_id,
        contractAbi: JSON.parse(row.contract_abi),
        blockHeight: row.block_height,
        processed: row.processed,
      };
      return entry;
    });
    return entries;
  }

  async updateTokenMetadataQueue(
    client: ClientBase,
    entry: DbTokenMetadataQueueEntry
  ): Promise<DbTokenMetadataQueueEntry> {
    const queryResult = await client.query<{ queue_id: number }>(
      `
      INSERT INTO token_metadata_queue(
        tx_id, contract_id, contract_abi, block_height, processed
      ) values($1, $2, $3, $4, $5)
      RETURNING queue_id
      `,
      [
        hexToBuffer(entry.txId),
        entry.contractId,
        JSON.stringify(entry.contractAbi),
        entry.blockHeight,
        false,
      ]
    );
    const result: DbTokenMetadataQueueEntry = {
      ...entry,
      queueId: queryResult.rows[0].queue_id,
    };
    return result;
  }

  async updateSmartContract(client: ClientBase, tx: DbTx, smartContract: DbSmartContract) {
    await client.query(
      `
      INSERT INTO smart_contracts(
        tx_id, canonical, contract_id, block_height, index_block_hash, source_code, abi,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        hexToBuffer(smartContract.tx_id),
        smartContract.canonical,
        smartContract.contract_id,
        smartContract.block_height,
        hexToBuffer(tx.index_block_hash),
        smartContract.source_code,
        smartContract.abi,
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
      ]
    );
  }

  async getSmartContractList(contractIds: string[]) {
    return this.query(async client => {
      const result = await client.query<{
        contract_id: string;
        canonical: boolean;
        tx_id: Buffer;
        block_height: number;
        source_code: string;
        abi: string;
      }>(
        `
        SELECT DISTINCT ON (contract_id) contract_id, canonical, tx_id, block_height, source_code, abi
        FROM smart_contracts
        WHERE contract_id = ANY($1)
        ORDER BY contract_id DESC, abi != 'null' DESC, canonical DESC, microblock_canonical DESC, block_height DESC
      `,
        [contractIds]
      );
      if (result.rowCount === 0) {
        [];
      }
      return result.rows.map(r => this.parseQueryResultToSmartContract(r)).map(res => res.result);
    });
  }

  async getSmartContract(contractId: string) {
    return this.query(async client => {
      const result = await client.query<{
        tx_id: Buffer;
        canonical: boolean;
        contract_id: string;
        block_height: number;
        source_code: string;
        abi: string;
      }>(
        `
        SELECT tx_id, canonical, contract_id, block_height, source_code, abi
        FROM smart_contracts
        WHERE contract_id = $1
        ORDER BY abi != 'null' DESC, canonical DESC, microblock_canonical DESC, block_height DESC
        LIMIT 1
        `,
        [contractId]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      return this.parseQueryResultToSmartContract(row);
    });
  }

  parseQueryResultToSmartContract(row: {
    tx_id: Buffer;
    canonical: boolean;
    contract_id: string;
    block_height: number;
    source_code: string;
    abi: string;
  }) {
    const smartContract: DbSmartContract = {
      tx_id: bufferToHexPrefixString(row.tx_id),
      canonical: row.canonical,
      contract_id: row.contract_id,
      block_height: row.block_height,
      source_code: row.source_code,
      abi: row.abi,
    };
    return { found: true, result: smartContract };
  }

  async getSmartContractEvents({
    contractId,
    limit,
    offset,
  }: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>> {
    return this.query(async client => {
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, contract_identifier, topic, value
        FROM contract_logs
        WHERE canonical = true AND microblock_canonical = true AND contract_identifier = $1
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [contractId, limit, offset]
      );
      const result = logResults.rows.map(result => {
        const event: DbSmartContractEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          tx_index: result.tx_index,
          block_height: result.block_height,
          canonical: true,
          event_type: DbEventTypeId.SmartContractLog,
          contract_identifier: result.contract_identifier,
          topic: result.topic,
          value: result.value,
        };
        return event;
      });
      return { found: true, result };
    });
  }

  /**
   * Refreshes the `nft_custody` and `nft_custody_unanchored` materialized views if necessary.
   * @param client - DB client
   * @param txs - Transaction event data
   * @param unanchored - If this refresh is requested from a block or microblock
   */
  async refreshNftCustody(
    client: ClientBase,
    txs: DataStoreTxEventData[],
    unanchored: boolean = false
  ) {
    const newNftEventCount = txs
      .map(tx => tx.nftEvents.length)
      .reduce((prev, cur) => prev + cur, 0);
    if (newNftEventCount > 0) {
      // Always refresh unanchored view since even if we're in a new anchored block we should update the
      // unanchored state to the current one.
      await this.refreshMaterializedView(client, 'nft_custody_unanchored');
      if (!unanchored) {
        await this.refreshMaterializedView(client, 'nft_custody');
      }
    } else if (!unanchored) {
      // Even if we didn't receive new NFT events in a new anchor block, we should check if we need to
      // update the anchored view to reflect any changes made by previous microblocks.
      const result = await client.query<{ outdated: boolean }>(
        `
        WITH anchored_height AS (SELECT MAX(block_height) AS anchored FROM nft_custody),
          unanchored_height AS (SELECT MAX(block_height) AS unanchored FROM nft_custody_unanchored)
        SELECT unanchored > anchored AS outdated
        FROM anchored_height CROSS JOIN unanchored_height
        `
      );
      if (result.rows.length > 0 && result.rows[0].outdated) {
        await this.refreshMaterializedView(client, 'nft_custody');
      }
    }
  }

  /**
   * Refreshes a Postgres materialized view.
   * @param client - Pg Client
   * @param viewName - Materialized view name
   * @param skipDuringEventReplay - If we should skip refreshing during event replay
   */
  async refreshMaterializedView(
    client: ClientBase,
    viewName: string,
    skipDuringEventReplay = true
  ) {
    if (this.eventReplay && skipDuringEventReplay) {
      return;
    }
    await client.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
  }
  async getSmartContractByTrait(args: {
    trait: ClarityAbi;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContract[]>> {
    const traitFunctionList = args.trait.functions.map(traitFunction => {
      return {
        name: traitFunction.name,
        access: traitFunction.access,
        args: traitFunction.args.map(arg => {
          return {
            type: arg.type,
          };
        }),
        outputs: traitFunction.outputs,
      };
    });

    return this.query(async client => {
      const result = await client.query<{
        tx_id: Buffer;
        canonical: boolean;
        contract_id: string;
        block_height: number;
        source_code: string;
        abi: string;
      }>(
        `
        SELECT tx_id, canonical, contract_id, block_height, source_code, abi
        FROM smart_contracts
        WHERE abi->'functions' @> $1::jsonb AND canonical = true AND microblock_canonical = true
        ORDER BY block_height DESC
        LIMIT $2 OFFSET $3
        `,
        [JSON.stringify(traitFunctionList), args.limit, args.offset]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const smartContracts = result.rows.map(row => {
        const smartContract: DbSmartContract = {
          tx_id: bufferToHexPrefixString(row.tx_id),
          canonical: row.canonical,
          contract_id: row.contract_id,
          block_height: row.block_height,
          source_code: row.source_code,
          abi: row.abi,
        };
        return smartContract;
      });
      return { found: true, result: smartContracts };
    });
  }

  async getStxBalance({
    stxAddress,
    includeUnanchored,
  }: {
    stxAddress: string;
    includeUnanchored: boolean;
  }): Promise<DbStxBalance> {
    return this.queryTx(async client => {
      const blockQuery = await this.getCurrentBlockInternal(client);
      if (!blockQuery.found) {
        throw new Error(`Could not find current block`);
      }
      let blockHeight = blockQuery.result.block_height;
      if (includeUnanchored) {
        blockHeight++;
      }
      const result = await this.internalGetStxBalanceAtBlock(
        client,
        stxAddress,
        blockHeight,
        blockQuery.result.burn_block_height
      );
      return result;
    });
  }

  async getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance> {
    return this.queryTx(async client => {
      const chainTip = await this.getChainTip(client);
      const blockHeightToQuery =
        blockHeight > chainTip.blockHeight ? chainTip.blockHeight : blockHeight;
      const blockQuery = await this.getBlockByHeightInternal(client, blockHeightToQuery);
      if (!blockQuery.found) {
        throw new Error(`Could not find block at height: ${blockHeight}`);
      }
      const result = await this.internalGetStxBalanceAtBlock(
        client,
        stxAddress,
        blockHeight,
        blockQuery.result.burn_block_height
      );
      return result;
    });
  }

  async internalGetStxBalanceAtBlock(
    client: ClientBase,
    stxAddress: string,
    blockHeight: number,
    burnBlockHeight: number
  ): Promise<DbStxBalance> {
    const result = await client.query<{
      credit_total: string | null;
      debit_total: string | null;
    }>(
      `
      WITH credit AS (
        SELECT sum(amount) as credit_total
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND recipient = $1 AND block_height <= $2
      ),
      debit AS (
        SELECT sum(amount) as debit_total
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND sender = $1 AND block_height <= $2
      )
      SELECT credit_total, debit_total
      FROM credit CROSS JOIN debit
      `,
      [stxAddress, blockHeight]
    );
    const feeQuery = await client.query<{ fee_sum: string }>(
      `
      SELECT sum(fee_rate) as fee_sum
      FROM txs
      WHERE canonical = true AND microblock_canonical = true AND ((sender_address = $1 AND sponsored = false) OR (sponsor_address = $1 AND sponsored= true)) AND block_height <= $2
      `,
      [stxAddress, blockHeight]
    );
    const lockQuery = await client.query<{
      locked_amount: string;
      unlock_height: string;
      block_height: string;
      tx_id: Buffer;
    }>(
      `
      SELECT locked_amount, unlock_height, block_height, tx_id
      FROM stx_lock_events
      WHERE canonical = true AND microblock_canonical = true AND locked_address = $1
      AND block_height <= $2 AND unlock_height > $3
      `,
      [stxAddress, blockHeight, burnBlockHeight]
    );
    let lockTxId: string = '';
    let locked: bigint = 0n;
    let lockHeight = 0;
    let burnchainLockHeight = 0;
    let burnchainUnlockHeight = 0;
    if (lockQuery.rowCount > 1) {
      throw new Error(
        `stx_lock_events event query for ${stxAddress} should return zero or one rows but returned ${lockQuery.rowCount}`
      );
    } else if (lockQuery.rowCount === 1) {
      lockTxId = bufferToHexPrefixString(lockQuery.rows[0].tx_id);
      locked = BigInt(lockQuery.rows[0].locked_amount);
      burnchainUnlockHeight = parseInt(lockQuery.rows[0].unlock_height);
      lockHeight = parseInt(lockQuery.rows[0].block_height);
      const blockQuery = await this.getBlockByHeightInternal(client, lockHeight);
      burnchainLockHeight = blockQuery.found ? blockQuery.result.burn_block_height : 0;
    }
    const minerRewardQuery = await client.query<{ amount: string }>(
      `
      SELECT sum(
        coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced
      ) amount
      FROM miner_rewards
      WHERE canonical = true AND recipient = $1 AND mature_block_height <= $2
      `,
      [stxAddress, blockHeight]
    );
    const totalRewards = BigInt(minerRewardQuery.rows[0]?.amount ?? 0);
    const totalFees = BigInt(feeQuery.rows[0]?.fee_sum ?? 0);
    const totalSent = BigInt(result.rows[0]?.debit_total ?? 0);
    const totalReceived = BigInt(result.rows[0]?.credit_total ?? 0);
    const balance = totalReceived - totalSent - totalFees + totalRewards;
    return {
      balance,
      totalSent,
      totalReceived,
      totalFeesSent: totalFees,
      totalMinerRewardsReceived: totalRewards,
      lockTxId: lockTxId,
      locked,
      lockHeight,
      burnchainLockHeight,
      burnchainUnlockHeight,
    };
  }

  async getUnlockedStxSupply(
    args:
      | {
          blockHeight: number;
        }
      | { includeUnanchored: boolean }
  ) {
    return this.queryTx(async client => {
      let atBlockHeight: number;
      let atMatureBlockHeight: number;
      if ('blockHeight' in args) {
        atBlockHeight = args.blockHeight;
        atMatureBlockHeight = args.blockHeight;
      } else {
        atBlockHeight = await this.getMaxBlockHeight(client, {
          includeUnanchored: args.includeUnanchored,
        });
        atMatureBlockHeight = args.includeUnanchored ? atBlockHeight - 1 : atBlockHeight;
      }
      const result = await client.query<{ amount: string }>(
        `
        SELECT SUM(amount) amount FROM (
            SELECT SUM(amount) amount
            FROM stx_events
            WHERE canonical = true AND microblock_canonical = true
            AND asset_event_type_id = 2 -- mint events
            AND block_height <= $1
          UNION ALL
            SELECT (SUM(amount) * -1) amount
            FROM stx_events
            WHERE canonical = true AND microblock_canonical = true
            AND asset_event_type_id = 3 -- burn events
            AND block_height <= $1
          UNION ALL
            SELECT SUM(coinbase_amount) amount
            FROM miner_rewards
            WHERE canonical = true
            AND mature_block_height <= $2
        ) totals
        `,
        [atBlockHeight, atMatureBlockHeight]
      );
      if (result.rows.length < 1) {
        throw new Error(`No rows returned from total supply query`);
      }
      return { stx: BigInt(result.rows[0].amount), blockHeight: atBlockHeight };
    });
  }

  async getAddressAssetEvents({
    stxAddress,
    limit,
    offset,
    blockHeight,
  }: {
    stxAddress: string;
    limit: number;
    offset: number;
    blockHeight: number;
  }): Promise<{ results: DbEvent[]; total: number }> {
    return this.queryTx(async client => {
      const results = await client.query<
        {
          asset_type: 'stx_lock' | 'stx' | 'ft' | 'nft';
          event_index: number;
          tx_id: Buffer;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          asset_identifier: string;
          amount?: string;
          unlock_height?: string;
          value?: Buffer;
        } & { count: number }
      >(
        `
        SELECT *,
        (
          COUNT(*) OVER()
        )::INTEGER AS COUNT  FROM(
          SELECT
            'stx_lock' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, 0 as asset_event_type_id,
            locked_address as sender, '' as recipient, '<stx>' as asset_identifier, locked_amount as amount, unlock_height, null::bytea as value
          FROM stx_lock_events
          WHERE canonical = true AND microblock_canonical = true AND locked_address = $1 AND block_height <= $4
          UNION ALL
          SELECT
            'stx' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
            sender, recipient, '<stx>' as asset_identifier, amount::numeric, null::numeric as unlock_height, null::bytea as value
          FROM stx_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1) AND block_height <= $4
          UNION ALL
          SELECT
            'ft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
            sender, recipient, asset_identifier, amount, null::numeric as unlock_height, null::bytea as value
          FROM ft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1) AND block_height <= $4
          UNION ALL
          SELECT
            'nft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
            sender, recipient, asset_identifier, null::numeric as amount, null::numeric as unlock_height, value
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1) AND block_height <= $4
        ) asset_events
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [stxAddress, limit, offset, blockHeight]
      );

      const events: DbEvent[] = results.rows.map(row => {
        if (row.asset_type === 'stx_lock') {
          const event: DbStxLockEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            locked_address: unwrapOptional(row.sender),
            locked_amount: BigInt(assertNotNullish(row.amount)),
            unlock_height: Number(assertNotNullish(row.unlock_height)),
            event_type: DbEventTypeId.StxLock,
          };
          return event;
        } else if (row.asset_type === 'stx') {
          const event: DbStxEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            event_type: DbEventTypeId.StxAsset,
            amount: BigInt(row.amount ?? 0),
          };
          return event;
        } else if (row.asset_type === 'ft') {
          const event: DbFtEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            asset_identifier: row.asset_identifier,
            event_type: DbEventTypeId.FungibleTokenAsset,
            amount: BigInt(row.amount ?? 0),
          };
          return event;
        } else if (row.asset_type === 'nft') {
          const event: DbNftEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            asset_identifier: row.asset_identifier,
            event_type: DbEventTypeId.NonFungibleTokenAsset,
            value: row.value as Buffer,
          };
          return event;
        } else {
          throw new Error(`Unexpected asset_type "${row.asset_type}"`);
        }
      });
      const count = results.rowCount > 0 ? results.rows[0].count : 0;
      return {
        results: events,
        total: count,
      };
    });
  }

  async getFungibleTokenBalances(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, DbFtBalance>> {
    return this.queryTx(async client => {
      const result = await client.query<{
        asset_identifier: string;
        credit_total: string | null;
        debit_total: string | null;
      }>(
        `
        WITH transfers AS (
          SELECT amount, sender, recipient, asset_identifier
          FROM ft_events
          WHERE canonical = true AND microblock_canonical = true
          AND (sender = $1 OR recipient = $1)
          AND block_height <= $2
        ), credit AS (
          SELECT asset_identifier, sum(amount) as credit_total
          FROM transfers
          WHERE recipient = $1
          GROUP BY asset_identifier
        ), debit AS (
          SELECT asset_identifier, sum(amount) as debit_total
          FROM transfers
          WHERE sender = $1
          GROUP BY asset_identifier
        )
        SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, credit_total, debit_total
        FROM credit FULL JOIN debit USING (asset_identifier)
        `,
        [args.stxAddress, args.untilBlock]
      );
      // sort by asset name (case-insensitive)
      const rows = result.rows.sort((r1, r2) =>
        r1.asset_identifier.localeCompare(r2.asset_identifier)
      );
      const assetBalances = new Map<string, DbFtBalance>(
        rows.map(r => {
          const totalSent = BigInt(r.debit_total ?? 0);
          const totalReceived = BigInt(r.credit_total ?? 0);
          const balance = totalReceived - totalSent;
          return [r.asset_identifier, { balance, totalSent, totalReceived }];
        })
      );
      return assetBalances;
    });
  }

  async getNonFungibleTokenCounts(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>> {
    return this.queryTx(async client => {
      const result = await client.query<{
        asset_identifier: string;
        received_total: string | null;
        sent_total: string | null;
      }>(
        `
        WITH transfers AS (
          SELECT sender, recipient, asset_identifier
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true
          AND (sender = $1 OR recipient = $1)
          AND block_height <= $2
        ), credit AS (
          SELECT asset_identifier, COUNT(*) as received_total
          FROM transfers
          WHERE recipient = $1
          GROUP BY asset_identifier
        ), debit AS (
          SELECT asset_identifier, COUNT(*) as sent_total
          FROM transfers
          WHERE sender = $1
          GROUP BY asset_identifier
        )
        SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, received_total, sent_total
        FROM credit FULL JOIN debit USING (asset_identifier)
        `,
        [args.stxAddress, args.untilBlock]
      );
      // sort by asset name (case-insensitive)
      const rows = result.rows.sort((r1, r2) =>
        r1.asset_identifier.localeCompare(r2.asset_identifier)
      );
      const assetBalances = new Map(
        rows.map(r => {
          const totalSent = BigInt(r.sent_total ?? 0);
          const totalReceived = BigInt(r.received_total ?? 0);
          const count = totalReceived - totalSent;
          return [r.asset_identifier, { count, totalSent, totalReceived }];
        })
      );
      return assetBalances;
    });
  }

  async getAddressTxs(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
  }): Promise<{ results: DbTx[]; total: number }> {
    return this.queryTx(async client => {
      const principal = isValidPrincipal(args.stxAddress);
      if (!principal) {
        return { results: [], total: 0 };
      }
      const blockCond = args.atSingleBlock ? 'block_height = $4' : 'block_height <= $4';
      const resultQuery = await client.query<ContractTxQueryResult & { count: number }>(
        // Query the `principal_stx_txs` table first to get the results page we want and then
        // join against `txs` to get the full transaction objects only for that page.
        `
        WITH
        -- getAddressTxs
        stx_txs AS (
          SELECT tx_id, ${COUNT_COLUMN}
          FROM principal_stx_txs AS s
          WHERE principal = $1 AND ${blockCond}
          ORDER BY block_height DESC
          LIMIT $2
          OFFSET $3
        )
        SELECT ${TX_COLUMNS}, ${abiColumn()}, count
        FROM stx_txs
        INNER JOIN txs USING (tx_id)
        WHERE canonical = TRUE AND microblock_canonical = TRUE
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        `,
        [args.stxAddress, args.limit, args.offset, args.blockHeight]
      );
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      const parsed = resultQuery.rows.map(r => this.parseTxQueryResult(r));
      return { results: parsed, total: count };
    });
  }

  async getInformationTxsWithStxTransfers({
    stxAddress,
    tx_id,
  }: {
    stxAddress: string;
    tx_id: string;
  }): Promise<DbTxWithAssetTransfers> {
    return this.query(async client => {
      const queryParams: (string | Buffer)[] = [stxAddress, hexToBuffer(tx_id)];
      const resultQuery = await client.query<
        ContractTxQueryResult & {
          count: number;
          event_index?: number;
          event_type?: number;
          event_amount?: string;
          event_sender?: string;
          event_recipient?: string;
        }
      >(
        `
      WITH transactions AS (
        WITH principal_txs AS (
          WITH event_txs AS (
            SELECT tx_id FROM stx_events WHERE stx_events.sender = $1 OR stx_events.recipient = $1
          )
          SELECT *
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND txs.tx_id = $2 AND (
            sender_address = $1 OR
            token_transfer_recipient_address = $1 OR
            contract_call_contract_id = $1 OR
            smart_contract_contract_id = $1
          )
          UNION
          SELECT txs.* FROM txs
          INNER JOIN event_txs ON txs.tx_id = event_txs.tx_id
          WHERE txs.canonical = true AND txs.microblock_canonical = true AND txs.tx_id = $2
        )
        SELECT ${TX_COLUMNS}, (COUNT(*) OVER())::integer as count
        FROM principal_txs
        ORDER BY block_height DESC, tx_index DESC
      ), events AS (
        SELECT *, ${DbEventTypeId.StxAsset} as event_type_id
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
      )
      SELECT
        transactions.*,
        events.event_index as event_index,
        events.event_type_id as event_type,
        events.amount as event_amount,
        events.sender as event_sender,
        events.recipient as event_recipient,
        ${abiColumn('transactions')}
      FROM transactions
      LEFT JOIN events ON transactions.tx_id = events.tx_id AND transactions.tx_id = $2
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `,
        queryParams
      );

      const txs = this.parseTxsWithAssetTransfers(resultQuery, stxAddress);
      const txTransfers = [...txs.values()];
      return txTransfers[0];
    });
  }

  async getAddressTxsWithAssetTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ results: DbTxWithAssetTransfers[]; total: number }> {
    return this.queryTx(async client => {
      const queryParams: (string | number)[] = [args.stxAddress];

      if (args.atSingleBlock) {
        queryParams.push(args.blockHeight);
      } else {
        queryParams.push(args.limit ?? 20);
        queryParams.push(args.offset ?? 0);
        queryParams.push(args.blockHeight);
      }
      // Use a JOIN to include stx_events associated with the address's txs
      const resultQuery = await client.query<
        ContractTxQueryResult & {
          count: number;
          event_index?: number;
          event_type?: number;
          event_amount?: string;
          event_sender?: string;
          event_recipient?: string;
          event_asset_identifier?: string;
          event_value?: Buffer;
        }
      >(
        `
        WITH transactions AS (
          WITH principal_txs AS (
            WITH event_txs AS (
              SELECT tx_id FROM stx_events WHERE stx_events.sender = $1 OR stx_events.recipient = $1
              UNION
              SELECT tx_id FROM ft_events WHERE ft_events.sender = $1 OR ft_events.recipient = $1
              UNION
              SELECT tx_id FROM nft_events WHERE nft_events.sender = $1 OR nft_events.recipient = $1
            )
            SELECT * FROM txs
            WHERE canonical = true AND microblock_canonical = true AND (
              sender_address = $1 OR
              token_transfer_recipient_address = $1 OR
              contract_call_contract_id = $1 OR
              smart_contract_contract_id = $1
            )
            UNION
            SELECT txs.* FROM txs
            INNER JOIN event_txs ON txs.tx_id = event_txs.tx_id
            WHERE canonical = true AND microblock_canonical = true
          )
          SELECT ${TX_COLUMNS}, (COUNT(*) OVER())::integer as count
          FROM principal_txs
          ${args.atSingleBlock ? 'WHERE block_height = $2' : 'WHERE block_height <= $4'}
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          ${!args.atSingleBlock ? 'LIMIT $2 OFFSET $3' : ''}
        ), events AS (
          SELECT
            tx_id, sender, recipient, event_index, amount,
            ${DbEventTypeId.StxAsset} as event_type_id,
            NULL as asset_identifier, '0'::bytea as value
          FROM stx_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
          UNION
          SELECT
            tx_id, sender, recipient, event_index, amount,
            ${DbEventTypeId.FungibleTokenAsset} as event_type_id,
            asset_identifier, '0'::bytea as value
          FROM ft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
          UNION
          SELECT
            tx_id, sender, recipient, event_index, 0 as amount,
            ${DbEventTypeId.NonFungibleTokenAsset} as event_type_id,
            asset_identifier, value
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
        )
        SELECT
          transactions.*,
          ${abiColumn('transactions')},
          events.event_index as event_index,
          events.event_type_id as event_type,
          events.amount as event_amount,
          events.sender as event_sender,
          events.recipient as event_recipient,
          events.asset_identifier as event_asset_identifier,
          events.value as event_value
        FROM transactions
        LEFT JOIN events ON transactions.tx_id = events.tx_id
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        `,
        queryParams
      );

      // TODO: should mining rewards be added?

      const txs = this.parseTxsWithAssetTransfers(resultQuery, args.stxAddress);
      const txTransfers = [...txs.values()];
      txTransfers.sort((a, b) => {
        return b.tx.block_height - a.tx.block_height || b.tx.tx_index - a.tx.tx_index;
      });
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      return { results: txTransfers, total: count };
    });
  }

  parseTxsWithAssetTransfers(
    resultQuery: QueryResult<
      TxQueryResult & {
        count: number;
        event_index?: number | undefined;
        event_type?: number | undefined;
        event_amount?: string | undefined;
        event_sender?: string | undefined;
        event_recipient?: string | undefined;
        event_asset_identifier?: string | undefined;
        event_value?: Buffer | undefined;
      }
    >,
    stxAddress: string
  ) {
    const txs = new Map<
      string,
      {
        tx: DbTx;
        stx_sent: bigint;
        stx_received: bigint;
        stx_transfers: {
          amount: bigint;
          sender?: string;
          recipient?: string;
        }[];
        ft_transfers: {
          asset_identifier: string;
          amount: bigint;
          sender?: string;
          recipient?: string;
        }[];
        nft_transfers: {
          asset_identifier: string;
          value: Buffer;
          sender?: string;
          recipient?: string;
        }[];
      }
    >();
    for (const r of resultQuery.rows) {
      const txId = bufferToHexPrefixString(r.tx_id);
      let txResult = txs.get(txId);
      if (!txResult) {
        txResult = {
          tx: this.parseTxQueryResult(r),
          stx_sent: 0n,
          stx_received: 0n,
          stx_transfers: [],
          ft_transfers: [],
          nft_transfers: [],
        };
        if (txResult.tx.sender_address === stxAddress) {
          txResult.stx_sent += txResult.tx.fee_rate;
        }
        txs.set(txId, txResult);
      }
      if (r.event_index !== undefined && r.event_index !== null) {
        const eventAmount = BigInt(r.event_amount as string);
        switch (r.event_type) {
          case DbEventTypeId.StxAsset:
            txResult.stx_transfers.push({
              amount: eventAmount,
              sender: r.event_sender,
              recipient: r.event_recipient,
            });
            if (r.event_sender === stxAddress) {
              txResult.stx_sent += eventAmount;
            }
            if (r.event_recipient === stxAddress) {
              txResult.stx_received += eventAmount;
            }
            break;

          case DbEventTypeId.FungibleTokenAsset:
            txResult.ft_transfers.push({
              asset_identifier: r.event_asset_identifier as string,
              amount: eventAmount,
              sender: r.event_sender,
              recipient: r.event_recipient,
            });
            break;

          case DbEventTypeId.NonFungibleTokenAsset:
            txResult.nft_transfers.push({
              asset_identifier: r.event_asset_identifier as string,
              value: r.event_value as Buffer,
              sender: r.event_sender,
              recipient: r.event_recipient,
            });
            break;
        }
      }
    }
    return txs;
  }

  async getInboundTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
    sendManyContractId: string;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }> {
    return this.queryTx(async client => {
      let whereClause: string;
      if (args.atSingleBlock) {
        whereClause = 'WHERE block_height = $5';
      } else {
        whereClause = 'WHERE block_height <= $5';
      }
      const resultQuery = await client.query<TransferQueryResult & { count: number }>(
        `
        SELECT
            *,
          (
            COUNT(*) OVER()
          )::INTEGER AS COUNT
        FROM
          (
            SELECT
              stx_events.amount AS amount,
              contract_logs.value AS memo,
              stx_events.sender AS sender,
              stx_events.block_height AS block_height,
              stx_events.tx_id,
              stx_events.microblock_sequence,
              stx_events.tx_index,
              'bulk-send' as transfer_type
            FROM
              contract_logs,
              stx_events
            WHERE
              contract_logs.contract_identifier = $2
              AND contract_logs.tx_id = stx_events.tx_id
              AND stx_events.recipient = $1
              AND contract_logs.event_index = (stx_events.event_index + 1)
              AND stx_events.canonical = true AND stx_events.microblock_canonical = true
              AND contract_logs.canonical = true AND contract_logs.microblock_canonical = true
            UNION ALL
            SELECT
              token_transfer_amount AS amount,
              token_transfer_memo AS memo,
              sender_address AS sender,
              block_height,
              tx_id,
              microblock_sequence,
              tx_index,
              'stx-transfer' as transfer_type
            FROM
              txs
            WHERE
              canonical = true AND microblock_canonical = true
              AND type_id = 0
              AND token_transfer_recipient_address = $1
          ) transfers
        ${whereClause}
        ORDER BY
          block_height DESC,
          microblock_sequence DESC,
          tx_index DESC
        LIMIT $3
        OFFSET $4
        `,
        [args.stxAddress, args.sendManyContractId, args.limit, args.offset, args.blockHeight]
      );
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      const parsed: DbInboundStxTransfer[] = resultQuery.rows.map(r => {
        return {
          sender: r.sender,
          memo: bufferToHexPrefixString(r.memo),
          amount: BigInt(r.amount),
          tx_id: bufferToHexPrefixString(r.tx_id),
          tx_index: r.tx_index,
          block_height: r.block_height,
          transfer_type: r.transfer_type,
        };
      });
      return {
        results: parsed,
        total: count,
      };
    });
  }

  async searchHash({ hash }: { hash: string }): Promise<FoundOrNot<DbSearchResult>> {
    // TODO(mb): add support for searching for microblock by hash
    return this.query(async client => {
      const txQuery = await client.query<ContractTxQueryResult>(
        `SELECT ${TX_COLUMNS}, ${abiColumn()} FROM txs WHERE tx_id = $1 LIMIT 1`,
        [hexToBuffer(hash)]
      );
      if (txQuery.rowCount > 0) {
        const txResult = this.parseTxQueryResult(txQuery.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'tx_id',
            entity_id: bufferToHexPrefixString(txQuery.rows[0].tx_id),
            entity_data: txResult,
          },
        };
      }

      const txMempoolQuery = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs WHERE pruned = false AND tx_id = $1 LIMIT 1
        `,
        [hexToBuffer(hash)]
      );
      if (txMempoolQuery.rowCount > 0) {
        const txResult = this.parseMempoolTxQueryResult(txMempoolQuery.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'mempool_tx_id',
            entity_id: bufferToHexPrefixString(txMempoolQuery.rows[0].tx_id),
            entity_data: txResult,
          },
        };
      }

      const blockQueryResult = await client.query<BlockQueryResult>(
        `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE block_hash = $1 LIMIT 1`,
        [hexToBuffer(hash)]
      );
      if (blockQueryResult.rowCount > 0) {
        const blockResult = this.parseBlockQueryResult(blockQueryResult.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'block_hash',
            entity_id: bufferToHexPrefixString(blockQueryResult.rows[0].block_hash),
            entity_data: blockResult,
          },
        };
      }
      return { found: false };
    });
  }

  async searchPrincipal({ principal }: { principal: string }): Promise<FoundOrNot<DbSearchResult>> {
    const isContract = principal.includes('.');
    const entityType = isContract ? 'contract_address' : 'standard_address';
    const successResponse = {
      found: true,
      result: {
        entity_type: entityType,
        entity_id: principal,
      },
    } as const;
    return await this.query(async client => {
      if (isContract) {
        const contractMempoolTxResult = await client.query<MempoolTxQueryResult>(
          `
          SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
          FROM mempool_txs WHERE pruned = false AND smart_contract_contract_id = $1 LIMIT 1
          `,
          [principal]
        );
        if (contractMempoolTxResult.rowCount > 0) {
          const txResult = this.parseMempoolTxQueryResult(contractMempoolTxResult.rows[0]);
          return {
            found: true,
            result: {
              entity_type: 'contract_address',
              entity_id: principal,
              entity_data: txResult,
            },
          };
        }
        const contractTxResult = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE smart_contract_contract_id = $1
          ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
          LIMIT 1
          `,
          [principal]
        );
        if (contractTxResult.rowCount > 0) {
          const txResult = this.parseTxQueryResult(contractTxResult.rows[0]);
          return {
            found: true,
            result: {
              entity_type: 'tx_id',
              entity_id: principal,
              entity_data: txResult,
            },
          };
        }
        return { found: false } as const;
      }

      const addressQueryResult = await client.query(
        `
        SELECT sender_address, token_transfer_recipient_address
        FROM txs
        WHERE sender_address = $1 OR token_transfer_recipient_address = $1
        LIMIT 1
        `,
        [principal]
      );
      if (addressQueryResult.rowCount > 0) {
        return successResponse;
      }

      const stxQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM stx_events
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (stxQueryResult.rowCount > 0) {
        return successResponse;
      }

      const ftQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM ft_events
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (ftQueryResult.rowCount > 0) {
        return successResponse;
      }

      const nftQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM nft_events
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (nftQueryResult.rowCount > 0) {
        return successResponse;
      }

      return { found: false };
    });
  }

  async insertFaucetRequest(faucetRequest: DbFaucetRequest) {
    await this.query(async client => {
      try {
        await client.query(
          `
          INSERT INTO faucet_requests(
            currency, address, ip, occurred_at
          ) values($1, $2, $3, $4)
          `,
          [
            faucetRequest.currency,
            faucetRequest.address,
            faucetRequest.ip,
            faucetRequest.occurred_at,
          ]
        );
      } catch (error) {
        logError(`Error performing faucet request update: ${error}`, error);
        throw error;
      }
    });
  }

  async getBTCFaucetRequests(address: string) {
    return this.query(async client => {
      const queryResult = await client.query<FaucetRequestQueryResult>(
        `
        SELECT ip, address, currency, occurred_at
        FROM faucet_requests
        WHERE address = $1 AND currency = 'btc'
        ORDER BY occurred_at DESC
        LIMIT 5
        `,
        [address]
      );
      const results = queryResult.rows.map(r => this.parseFaucetRequestQueryResult(r));
      return { results };
    });
  }

  async getSTXFaucetRequests(address: string) {
    return await this.query(async client => {
      const queryResult = await client.query<FaucetRequestQueryResult>(
        `
        SELECT ip, address, currency, occurred_at
        FROM faucet_requests
        WHERE address = $1 AND currency = 'stx'
        ORDER BY occurred_at DESC
        LIMIT 5
        `,
        [address]
      );
      const results = queryResult.rows.map(r => this.parseFaucetRequestQueryResult(r));
      return { results };
    });
  }

  async getRawTx(txId: string) {
    return this.query(async client => {
      const result = await client.query<RawTxQueryResult>(
        // Note the extra "limit 1" statements are only query hints
        `
        (
          SELECT raw_tx
          FROM txs
          WHERE tx_id = $1
          LIMIT 1
        )
        UNION ALL
        (
          SELECT raw_tx
          FROM mempool_txs
          WHERE tx_id = $1
          LIMIT 1
        )
        LIMIT 1
        `,
        [hexToBuffer(txId)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const queryResult: RawTxQueryResult = {
        raw_tx: result.rows[0].raw_tx,
      };
      return { found: true, result: queryResult };
    });
  }

  async getNftHoldings(args: {
    principal: string;
    assetIdentifiers?: string[];
    limit: number;
    offset: number;
    includeUnanchored: boolean;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftHoldingInfoWithTxMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const queryArgs: (string | string[] | number)[] = [args.principal, args.limit, args.offset];
      if (args.assetIdentifiers) {
        queryArgs.push(args.assetIdentifiers);
      }
      const nftCustody = args.includeUnanchored ? 'nft_custody_unanchored' : 'nft_custody';
      const assetIdFilter = args.assetIdentifiers ? 'AND nft.asset_identifier = ANY ($4)' : '';
      const nftTxResults = await client.query<
        NftHoldingInfo & ContractTxQueryResult & { count: number }
      >(
        `
        WITH nft AS (
          SELECT *, (COUNT(*) OVER())::integer AS count
          FROM ${nftCustody} AS nft
          WHERE nft.recipient = $1
          ${assetIdFilter}
          LIMIT $2
          OFFSET $3
        )
        ` +
          (args.includeTxMetadata
            ? `SELECT nft.asset_identifier, nft.value, ${txColumns()}, ${abiColumn()}, nft.count
            FROM nft
            INNER JOIN txs USING (tx_id)
            WHERE txs.canonical = TRUE AND txs.microblock_canonical = TRUE`
            : `SELECT * FROM nft`),
        queryArgs
      );
      return {
        results: nftTxResults.rows.map(row => ({
          nft_holding_info: {
            asset_identifier: row.asset_identifier,
            value: row.value,
            recipient: row.recipient,
            tx_id: row.tx_id,
          },
          tx: args.includeTxMetadata ? this.parseTxQueryResult(row) : undefined,
        })),
        total: nftTxResults.rows.length > 0 ? nftTxResults.rows[0].count : 0,
      };
    });
  }

  async getNftHistory(args: {
    assetIdentifier: string;
    value: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftEventWithTxMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const queryArgs: (string | number | Buffer)[] = [
        args.assetIdentifier,
        hexToBuffer(args.value),
        args.blockHeight,
        args.limit,
        args.offset,
      ];
      const columns = args.includeTxMetadata
        ? `asset_identifier, value, event_index, asset_event_type_id, sender, recipient,
           ${txColumns()}, ${abiColumn()}`
        : `nft.*`;
      const nftTxResults = await client.query<
        DbNftEvent & ContractTxQueryResult & { count: number }
      >(
        `
        SELECT ${columns}, ${COUNT_COLUMN}
        FROM nft_events AS nft
        INNER JOIN txs USING (tx_id)
        WHERE asset_identifier = $1 AND nft.value = $2
          AND txs.canonical = TRUE AND txs.microblock_canonical = TRUE
          AND nft.canonical = TRUE AND nft.microblock_canonical = TRUE
          AND nft.block_height <= $3
        ORDER BY nft.block_height DESC
        LIMIT $4
        OFFSET $5
        `,
        queryArgs
      );
      return {
        results: nftTxResults.rows.map(row => ({
          nft_event: {
            event_type: DbEventTypeId.NonFungibleTokenAsset,
            value: row.value,
            asset_identifier: row.asset_identifier,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
          },
          tx: args.includeTxMetadata ? this.parseTxQueryResult(row) : undefined,
        })),
        total: nftTxResults.rows.length > 0 ? nftTxResults.rows[0].count : 0,
      };
    });
  }

  getNftMints(args: {
    assetIdentifier: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftEventWithTxMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const queryArgs: (string | number)[] = [
        args.assetIdentifier,
        args.blockHeight,
        args.limit,
        args.offset,
      ];
      const columns = args.includeTxMetadata
        ? `asset_identifier, value, event_index, asset_event_type_id, sender, recipient,
           ${txColumns()}, ${abiColumn()}`
        : `nft.*`;
      const nftTxResults = await client.query<
        DbNftEvent & ContractTxQueryResult & { count: number }
      >(
        `
        SELECT ${columns}, ${COUNT_COLUMN}
        FROM nft_events AS nft
        INNER JOIN txs USING (tx_id)
        WHERE nft.asset_identifier = $1
          AND nft.asset_event_type_id = ${DbAssetEventTypeId.Mint}
          AND nft.canonical = TRUE AND nft.microblock_canonical = TRUE
          AND txs.canonical = TRUE AND txs.microblock_canonical = TRUE
          AND nft.block_height <= $2
        ORDER BY nft.block_height DESC
        LIMIT $3
        OFFSET $4
        `,
        queryArgs
      );
      return {
        results: nftTxResults.rows.map(row => ({
          nft_event: {
            event_type: DbEventTypeId.NonFungibleTokenAsset,
            value: row.value,
            asset_identifier: row.asset_identifier,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
          },
          tx: args.includeTxMetadata ? this.parseTxQueryResult(row) : undefined,
        })),
        total: nftTxResults.rows.length > 0 ? nftTxResults.rows[0].count : 0,
      };
    });
  }

  async getAddressNFTEvent(args: {
    stxAddress: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeUnanchored: boolean;
  }): Promise<{ results: AddressNftEventIdentifier[]; total: number }> {
    return this.queryTx(async client => {
      const result = await client.query<AddressNftEventIdentifier & { count: string }>(
        // Join against `nft_custody` materialized view only if we're looking for canonical results.
        `
        WITH address_transfers AS (
          SELECT asset_identifier, value, sender, recipient, block_height, microblock_sequence, tx_index, event_index, tx_id
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true
          AND recipient = $1 AND block_height <= $4
        ),
        last_nft_transfers AS (
          SELECT DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true
          AND block_height <= $4
          ORDER BY asset_identifier, value, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        )
        SELECT sender, recipient, asset_identifier, value, address_transfers.block_height, address_transfers.tx_id, COUNT(*) OVER() AS count
        FROM address_transfers
        INNER JOIN ${args.includeUnanchored ? 'last_nft_transfers' : 'nft_custody'}
          USING (asset_identifier, value, recipient)
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT $2 OFFSET $3
        `,
        [args.stxAddress, args.limit, args.offset, args.blockHeight]
      );

      const count = result.rows.length > 0 ? parseInt(result.rows[0].count) : 0;

      const nftEvents = result.rows.map(row => ({
        sender: row.sender,
        recipient: row.recipient,
        asset_identifier: row.asset_identifier,
        value: row.value,
        block_height: row.block_height,
        tx_id: row.tx_id,
      }));

      return { results: nftEvents, total: count };
    });
  }

  async updateNames(
    client: ClientBase,
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    bnsName: DbBnsName
  ) {
    const {
      name,
      address,
      registered_at,
      expire_block,
      zonefile,
      zonefile_hash,
      namespace_id,
      tx_id,
      tx_index,
      status,
      canonical,
    } = bnsName;
    // inserting remaining names information in names table
    const validZonefileHash = this.validateZonefileHash(zonefile_hash);
    await client.query(
      `
        INSERT INTO zonefiles (zonefile, zonefile_hash) 
        VALUES ($1, $2)
        `,
      [zonefile, validZonefileHash]
    );
    await client.query(
      `
        INSERT INTO names(
          name, address, registered_at, expire_block, zonefile_hash, namespace_id,
          tx_index, tx_id, status, canonical,
          index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
        ) values($1, $2, $3, $4, $5, $6, $7, $8,$9, $10, $11, $12, $13, $14, $15)
        `,
      [
        name,
        address,
        registered_at,
        expire_block,
        validZonefileHash,
        namespace_id,
        tx_index,
        hexToBuffer(tx_id),
        status,
        canonical,
        hexToBuffer(blockData.index_block_hash),
        hexToBuffer(blockData.parent_index_block_hash),
        hexToBuffer(blockData.microblock_hash),
        blockData.microblock_sequence,
        blockData.microblock_canonical,
      ]
    );
  }

  async updateNamespaces(
    client: ClientBase,
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    bnsNamespace: DbBnsNamespace
  ) {
    const {
      namespace_id,
      launched_at,
      address,
      reveal_block,
      ready_block,
      buckets,
      base,
      coeff,
      nonalpha_discount,
      no_vowel_discount,
      lifetime,
      status,
      tx_id,
      tx_index,
      canonical,
    } = bnsNamespace;

    await client.query(
      `
      INSERT INTO namespaces(
        namespace_id, launched_at, address, reveal_block, ready_block, buckets,
        base,coeff, nonalpha_discount,no_vowel_discount, lifetime, status, tx_index,
        tx_id, canonical,
        index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      `,
      [
        namespace_id,
        launched_at,
        address,
        reveal_block,
        ready_block,
        buckets,
        base,
        coeff,
        nonalpha_discount,
        no_vowel_discount,
        lifetime,
        status,
        tx_index,
        hexToBuffer(tx_id ?? ''),
        canonical,
        hexToBuffer(blockData.index_block_hash),
        hexToBuffer(blockData.parent_index_block_hash),
        hexToBuffer(blockData.microblock_hash),
        blockData.microblock_sequence,
        blockData.microblock_canonical,
      ]
    );
  }

  async getTxListDetails({
    txIds,
    includeUnanchored,
  }: {
    txIds: string[];
    includeUnanchored: boolean;
  }) {
    return this.queryTx(async client => {
      const values = txIds.map(id => hexToBuffer(id));
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE tx_id = ANY($1) AND block_height <= $2 AND canonical = true AND microblock_canonical = true
        `,
        [values, maxBlockHeight]
      );
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows.map(row => {
        return this.parseTxQueryResult(row);
      });
    });
  }

  async getConfigState(): Promise<DbConfigState> {
    const queryResult = await this.pool.query(`SELECT * FROM config_state`);
    const result: DbConfigState = {
      bns_names_onchain_imported: queryResult.rows[0].bns_names_onchain_imported,
      bns_subdomains_imported: queryResult.rows[0].bns_subdomains_imported,
      token_offering_imported: queryResult.rows[0].token_offering_imported,
    };
    return result;
  }

  async updateConfigState(configState: DbConfigState, client?: ClientBase): Promise<void> {
    const queryResult = await (client ?? this.pool).query(
      `
      UPDATE config_state SET
      bns_names_onchain_imported = $1,
      bns_subdomains_imported = $2,
      token_offering_imported = $3
      `,
      [
        configState.bns_names_onchain_imported,
        configState.bns_subdomains_imported,
        configState.token_offering_imported,
      ]
    );
    if (queryResult.rowCount !== 1) {
      throw new Error(`Unexpected config update row count: ${queryResult.rowCount}`);
    }
  }

  async getNamespaceList({ includeUnanchored }: { includeUnanchored: boolean }) {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ namespace_id: string }>(
        `
        SELECT DISTINCT ON (namespace_id) namespace_id
        FROM namespaces
        WHERE canonical = true AND microblock_canonical = true
        AND ready_block <= $1
        ORDER BY namespace_id, ready_block DESC, tx_index DESC
        `,
        [maxBlockHeight]
      );
    });

    const results = queryResult.rows.map(r => r.namespace_id);
    return { results };
  }

  async getNamespaceNamesList({
    namespace,
    page,
    includeUnanchored,
  }: {
    namespace: string;
    page: number;
    includeUnanchored: boolean;
  }): Promise<{
    results: string[];
  }> {
    const offset = page * 100;
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ name: string }>(
        `
        SELECT DISTINCT ON (name) name
        FROM names
        WHERE namespace_id = $1
        AND registered_at <= $3
        AND canonical = true AND microblock_canonical = true
        ORDER BY name, registered_at DESC, tx_index DESC
        LIMIT 100
        OFFSET $2
        `,
        [namespace, offset, maxBlockHeight]
      );
    });

    const results = queryResult.rows.map(r => r.name);
    return { results };
  }

  async getNamespace({
    namespace,
    includeUnanchored,
  }: {
    namespace: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsNamespace & { index_block_hash: string }>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<DbBnsNamespace & { tx_id: Buffer; index_block_hash: Buffer }>(
        `
        SELECT DISTINCT ON (namespace_id) namespace_id, *
        FROM namespaces
        WHERE namespace_id = $1
        AND ready_block <= $2
        AND canonical = true AND microblock_canonical = true
        ORDER BY namespace_id, ready_block DESC, tx_index DESC
        LIMIT 1
        `,
        [namespace, maxBlockHeight]
      );
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: {
          ...queryResult.rows[0],
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          index_block_hash: bufferToHexPrefixString(queryResult.rows[0].index_block_hash),
        },
      };
    }
    return { found: false } as const;
  }

  async getName({
    name,
    includeUnanchored,
  }: {
    name: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsName & { index_block_hash: string }>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<DbBnsName & { tx_id: Buffer; index_block_hash: Buffer }>(
        `
        SELECT DISTINCT ON (names.name) names.name, names.*, zonefiles.zonefile
        FROM names
        LEFT JOIN zonefiles ON names.zonefile_hash = zonefiles.zonefile_hash
        WHERE name = $1
        AND registered_at <= $2
        AND canonical = true AND microblock_canonical = true
        ORDER BY name, registered_at DESC, tx_index DESC
        LIMIT 1
        `,
        [name, maxBlockHeight]
      );
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: {
          ...queryResult.rows[0],
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          index_block_hash: bufferToHexPrefixString(queryResult.rows[0].index_block_hash),
        },
      };
    }
    return { found: false } as const;
  }

  async getHistoricalZoneFile(args: {
    name: string;
    zoneFileHash: string;
  }): Promise<FoundOrNot<DbBnsZoneFile>> {
    const queryResult = await this.query(client => {
      const validZonefileHash = this.validateZonefileHash(args.zoneFileHash);
      return client.query<{ zonefile: string }>(
        `
        SELECT zonefile
        FROM names
        LEFT JOIN zonefiles ON zonefiles.zonefile_hash = names.zonefile_hash
        WHERE name = $1
        AND names.zonefile_hash = $2
        UNION ALL
        SELECT zonefile
        FROM subdomains
        LEFT JOIN zonefiles ON zonefiles.zonefile_hash = subdomains.zonefile_hash
        WHERE fully_qualified_subdomain = $1
        AND subdomains.zonefile_hash = $2
        `,
        [args.name, validZonefileHash]
      );
    });

    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows[0],
      };
    }
    return { found: false } as const;
  }

  async getLatestZoneFile({
    name,
    includeUnanchored,
  }: {
    name: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsZoneFile>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const zonefileHashResult = await client.query<{ name: string; zonefile: string }>(
        `
        SELECT name, zonefile_hash as zonefile FROM (
          (
            SELECT DISTINCT ON (name) name, zonefile_hash
            FROM names
            WHERE name = $1
            AND registered_at <= $2
            AND canonical = true AND microblock_canonical = true
            ORDER BY name, registered_at DESC, tx_index DESC
            LIMIT 1
          )
          UNION ALL (
            SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain as name, zonefile_hash
            FROM subdomains
            WHERE fully_qualified_subdomain = $1
            AND block_height <= $2
            AND canonical = true AND microblock_canonical = true
            ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
            LIMIT 1
          )
        ) results
        LIMIT 1
        `,
        [name, maxBlockHeight]
      );
      if (zonefileHashResult.rowCount === 0) {
        return zonefileHashResult;
      }
      const zonefileHash = zonefileHashResult.rows[0].zonefile;
      const zonefileResult = await client.query<{ zonefile: string }>(
        `
        SELECT zonefile
        FROM zonefiles
        WHERE zonefile_hash = $1
      `,
        [zonefileHash]
      );
      if (zonefileResult.rowCount === 0) {
        return zonefileHashResult;
      }
      zonefileHashResult.rows[0].zonefile = zonefileResult.rows[0].zonefile;
      return zonefileHashResult;
    });

    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows[0],
      };
    }
    return { found: false } as const;
  }

  async getNamesByAddressList({
    address,
    includeUnanchored,
  }: {
    address: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<string[]>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const query = await client.query<{ name: string }>(
        `
      WITH address_names AS(
        (
          SELECT name
          FROM names
          WHERE address = $1
          AND registered_at <= $2
          AND canonical = true AND microblock_canonical = true
        )
        UNION ALL (
          SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain as name
          FROM subdomains
          WHERE owner = $1
          AND block_height <= $2
          AND canonical = true AND microblock_canonical = true
        )), 

      latest_names AS( 
      ( 
        SELECT DISTINCT ON (names.name) names.name, address, registered_at as block_height, tx_index
        FROM names, address_names
        WHERE address_names.name = names.name
        AND canonical = true AND microblock_canonical = true
        ORDER BY names.name, registered_at DESC, tx_index DESC
      )
      UNION ALL(
        SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain as name, owner as address, block_height, tx_index
        FROM subdomains, address_names
        WHERE fully_qualified_subdomain = address_names.name
        AND canonical = true AND microblock_canonical = true
        ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
      ))

      SELECT name from latest_names
      WHERE address = $1
      ORDER BY name, block_height DESC, tx_index DESC
        `,
        [address, maxBlockHeight]
      );
      return query;
    });

    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows.map(r => r.name),
      };
    }
    return { found: false } as const;
  }

  async getSubdomainsList({
    page,
    includeUnanchored,
  }: {
    page: number;
    includeUnanchored: boolean;
  }) {
    const offset = page * 100;
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ fully_qualified_subdomain: string }>(
        `
        SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain
        FROM subdomains
        WHERE block_height <= $2
        AND canonical = true AND microblock_canonical = true
        ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
        LIMIT 100
        OFFSET $1
        `,
        [offset, maxBlockHeight]
      );
    });
    const results = queryResult.rows.map(r => r.fully_qualified_subdomain);
    return { results };
  }

  async getNamesList({ page, includeUnanchored }: { page: number; includeUnanchored: boolean }) {
    const offset = page * 100;
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ name: string }>(
        `
        SELECT DISTINCT ON (name) name
        FROM names
        WHERE canonical = true AND microblock_canonical = true
        AND registered_at <= $2
        ORDER BY name, registered_at DESC, tx_index DESC
        LIMIT 100
        OFFSET $1
        `,
        [offset, maxBlockHeight]
      );
    });

    const results = queryResult.rows.map(r => r.name);
    return { results };
  }

  async getSubdomain({
    subdomain,
    includeUnanchored,
  }: {
    subdomain: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsSubdomain & { index_block_hash: string }>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const subdomainResult = await client.query<
        DbBnsSubdomain & { tx_id: Buffer; index_block_hash: Buffer }
      >(
        `
        SELECT DISTINCT ON(subdomains.fully_qualified_subdomain) subdomains.fully_qualified_subdomain, *
        FROM subdomains
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= $2
        AND fully_qualified_subdomain = $1
        ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
        `,
        [subdomain, maxBlockHeight]
      );
      if (subdomainResult.rowCount === 0 || !subdomainResult.rows[0].zonefile_hash) {
        return subdomainResult;
      }
      const zonefileHash = subdomainResult.rows[0].zonefile_hash;
      const zonefileResult = await client.query(
        `
        SELECT zonefile
        FROM zonefiles
        WHERE zonefile_hash = $1
      `,
        [zonefileHash]
      );
      if (zonefileResult.rowCount === 0) {
        return subdomainResult;
      }
      subdomainResult.rows[0].zonefile = zonefileResult.rows[0].zonefile;
      return subdomainResult;
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: {
          ...queryResult.rows[0],
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          index_block_hash: bufferToHexPrefixString(queryResult.rows[0].index_block_hash),
        },
      };
    }
    return { found: false } as const;
  }

  async getSubdomainResolver(args: { name: string }): Promise<FoundOrNot<string>> {
    const queryResult = await this.query(client => {
      return client.query<{ resolver: string }>(
        `
        SELECT DISTINCT ON (name) name, resolver
        FROM subdomains
        WHERE canonical = true AND microblock_canonical = true
        AND name = $1
        ORDER BY name, block_height DESC, tx_index DESC
        LIMIT 1
        `,
        [args.name]
      );
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows[0].resolver,
      };
    }
    return { found: false } as const;
  }

  async updateBatchTokenOfferingLocked(client: ClientBase, lockedInfos: DbTokenOfferingLocked[]) {
    const columnCount = 3;
    const insertParams = this.generateParameterizedInsertString({
      rowCount: lockedInfos.length,
      columnCount,
    });
    const values: any[] = [];
    for (const lockedInfo of lockedInfos) {
      values.push(lockedInfo.address, lockedInfo.value, lockedInfo.block);
    }
    const insertQuery = `INSERT INTO token_offering_locked (
      address, value, block
      ) VALUES ${insertParams}`;
    const insertQueryName = `insert-batch-token-offering-locked_${columnCount}x${lockedInfos.length}`;
    const insertLockedInfosQuery: QueryConfig = {
      name: insertQueryName,
      text: insertQuery,
      values,
    };
    try {
      const res = await client.query(insertLockedInfosQuery);
      if (res.rowCount !== lockedInfos.length) {
        throw new Error(`Expected ${lockedInfos.length} inserts, got ${res.rowCount}`);
      }
    } catch (e: any) {
      logError(`Locked Info errors ${e.message}`, e);
      throw e;
    }
  }

  async getTokenOfferingLocked(address: string, blockHeight: number) {
    return this.query(async client => {
      const queryResult = await client.query<DbTokenOfferingLocked>(
        `
         SELECT block, value
         FROM token_offering_locked
         WHERE address = $1
         ORDER BY block ASC
       `,
        [address]
      );
      if (queryResult.rowCount > 0) {
        let totalLocked = 0n;
        let totalUnlocked = 0n;
        const unlockSchedules: AddressUnlockSchedule[] = [];
        queryResult.rows.forEach(lockedInfo => {
          const unlockSchedule: AddressUnlockSchedule = {
            amount: lockedInfo.value.toString(),
            block_height: lockedInfo.block,
          };
          unlockSchedules.push(unlockSchedule);
          if (lockedInfo.block > blockHeight) {
            totalLocked += BigInt(lockedInfo.value);
          } else {
            totalUnlocked += BigInt(lockedInfo.value);
          }
        });

        const tokenOfferingLocked: AddressTokenOfferingLocked = {
          total_locked: totalLocked.toString(),
          total_unlocked: totalUnlocked.toString(),
          unlock_schedule: unlockSchedules,
        };
        return {
          found: true,
          result: tokenOfferingLocked,
        };
      } else {
        return { found: false } as const;
      }
    });
  }

  async getUnlockedAddressesAtBlock(block: DbBlock): Promise<StxUnlockEvent[]> {
    return this.queryTx(async client => {
      return await this.internalGetUnlockedAccountsAtHeight(client, block);
    });
  }

  async internalGetUnlockedAccountsAtHeight(
    client: ClientBase,
    block: DbBlock
  ): Promise<StxUnlockEvent[]> {
    const current_burn_height = block.burn_block_height;
    let previous_burn_height = current_burn_height;
    if (block.block_height > 1) {
      const previous_block = await this.getBlockByHeightInternal(client, block.block_height - 1);
      if (previous_block.found) {
        previous_burn_height = previous_block.result.burn_block_height;
      }
    }

    const lockQuery = await client.query<{
      locked_amount: string;
      unlock_height: string;
      locked_address: string;
      tx_id: Buffer;
    }>(
      `
      SELECT locked_amount, unlock_height, locked_address
      FROM stx_lock_events
      WHERE microblock_canonical = true AND canonical = true
      AND unlock_height <= $1 AND unlock_height > $2
      `,
      [current_burn_height, previous_burn_height]
    );

    const txIdQuery = await client.query<{
      tx_id: Buffer;
    }>(
      `
      SELECT tx_id
      FROM txs
      WHERE microblock_canonical = true AND canonical = true
      AND block_height = $1 AND type_id = $2
      LIMIT 1
      `,
      [block.block_height, DbTxTypeId.Coinbase]
    );

    const result: StxUnlockEvent[] = [];
    lockQuery.rows.forEach(row => {
      const unlockEvent: StxUnlockEvent = {
        unlock_height: row.unlock_height,
        unlocked_amount: row.locked_amount,
        stacker_address: row.locked_address,
        tx_id: bufferToHexPrefixString(txIdQuery.rows[0].tx_id),
      };
      result.push(unlockEvent);
    });

    return result;
  }

  async getStxUnlockHeightAtTransaction(txId: string): Promise<FoundOrNot<number>> {
    return this.queryTx(async client => {
      const lockQuery = await client.query<{ unlock_height: number }>(
        `
        SELECT unlock_height
        FROM stx_lock_events
        WHERE canonical = true AND tx_id = $1
        `,
        [hexToBuffer(txId)]
      );
      if (lockQuery.rowCount > 0) {
        return { found: true, result: lockQuery.rows[0].unlock_height };
      }
      return { found: false };
    });
  }
  async getFtMetadata(contractId: string): Promise<FoundOrNot<DbFungibleTokenMetadata>> {
    return this.query(async client => {
      const queryResult = await client.query<FungibleTokenMetadataQueryResult>(
        `
         SELECT token_uri, name, description, image_uri, image_canonical_uri, symbol, decimals, contract_id, tx_id, sender_address
         FROM ft_metadata
         WHERE contract_id = $1
         LIMIT 1
       `,
        [contractId]
      );
      if (queryResult.rowCount > 0) {
        const metadata: DbFungibleTokenMetadata = {
          token_uri: queryResult.rows[0].token_uri,
          name: queryResult.rows[0].name,
          description: queryResult.rows[0].description,
          image_uri: queryResult.rows[0].image_uri,
          image_canonical_uri: queryResult.rows[0].image_canonical_uri,
          symbol: queryResult.rows[0].symbol,
          decimals: queryResult.rows[0].decimals,
          contract_id: queryResult.rows[0].contract_id,
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          sender_address: queryResult.rows[0].sender_address,
        };
        return {
          found: true,
          result: metadata,
        };
      } else {
        return { found: false } as const;
      }
    });
  }

  async getNftMetadata(contractId: string): Promise<FoundOrNot<DbNonFungibleTokenMetadata>> {
    return this.query(async client => {
      const queryResult = await client.query<NonFungibleTokenMetadataQueryResult>(
        `
         SELECT token_uri, name, description, image_uri, image_canonical_uri, contract_id, tx_id, sender_address
         FROM nft_metadata
         WHERE contract_id = $1
         LIMIT 1
       `,
        [contractId]
      );
      if (queryResult.rowCount > 0) {
        const metadata: DbNonFungibleTokenMetadata = {
          token_uri: queryResult.rows[0].token_uri,
          name: queryResult.rows[0].name,
          description: queryResult.rows[0].description,
          image_uri: queryResult.rows[0].image_uri,
          image_canonical_uri: queryResult.rows[0].image_canonical_uri,
          contract_id: queryResult.rows[0].contract_id,
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          sender_address: queryResult.rows[0].sender_address,
        };
        return {
          found: true,
          result: metadata,
        };
      } else {
        return { found: false } as const;
      }
    });
  }

  async updateFtMetadata(ftMetadata: DbFungibleTokenMetadata, dbQueueId: number): Promise<number> {
    const {
      token_uri,
      name,
      description,
      image_uri,
      image_canonical_uri,
      contract_id,
      symbol,
      decimals,
      tx_id,
      sender_address,
    } = ftMetadata;

    const rowCount = await this.queryTx(async client => {
      const result = await client.query(
        `
        INSERT INTO ft_metadata(
          token_uri, name, description, image_uri, image_canonical_uri, contract_id, symbol, decimals, tx_id, sender_address
        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          token_uri,
          name,
          description,
          image_uri,
          image_canonical_uri,
          contract_id,
          symbol,
          decimals,
          hexToBuffer(tx_id),
          sender_address,
        ]
      );
      await client.query(
        `
        UPDATE token_metadata_queue
        SET processed = true
        WHERE queue_id = $1
        `,
        [dbQueueId]
      );
      return result.rowCount;
    });
    await this.notifier?.sendTokens({ contractID: contract_id });
    return rowCount;
  }

  async updateNFtMetadata(
    nftMetadata: DbNonFungibleTokenMetadata,
    dbQueueId: number
  ): Promise<number> {
    const {
      token_uri,
      name,
      description,
      image_uri,
      image_canonical_uri,
      contract_id,
      tx_id,
      sender_address,
    } = nftMetadata;
    const rowCount = await this.queryTx(async client => {
      const result = await client.query(
        `
        INSERT INTO nft_metadata(
          token_uri, name, description, image_uri, image_canonical_uri, contract_id, tx_id, sender_address
        ) values($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          token_uri,
          name,
          description,
          image_uri,
          image_canonical_uri,
          contract_id,
          hexToBuffer(tx_id),
          sender_address,
        ]
      );
      await client.query(
        `
        UPDATE token_metadata_queue
        SET processed = true
        WHERE queue_id = $1
        `,
        [dbQueueId]
      );
      return result.rowCount;
    });
    await this.notifier?.sendTokens({ contractID: contract_id });
    return rowCount;
  }

  getFtMetadataList({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbFungibleTokenMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const totalQuery = await client.query<{ count: number }>(
        `
          SELECT COUNT(*)::integer
          FROM ft_metadata
          `
      );
      const resultQuery = await client.query<FungibleTokenMetadataQueryResult>(
        `
          SELECT *
          FROM ft_metadata
          LIMIT $1
          OFFSET $2
          `,
        [limit, offset]
      );
      const parsed = resultQuery.rows.map(r => {
        const metadata: DbFungibleTokenMetadata = {
          name: r.name,
          description: r.description,
          token_uri: r.token_uri,
          image_uri: r.image_uri,
          image_canonical_uri: r.image_canonical_uri,
          decimals: r.decimals,
          symbol: r.symbol,
          contract_id: r.contract_id,
          tx_id: bufferToHexPrefixString(r.tx_id),
          sender_address: r.sender_address,
        };
        return metadata;
      });
      return { results: parsed, total: totalQuery.rows[0].count };
    });
  }

  getNftMetadataList({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbNonFungibleTokenMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const totalQuery = await client.query<{ count: number }>(
        `
          SELECT COUNT(*)::integer
          FROM nft_metadata
          `
      );
      const resultQuery = await client.query<FungibleTokenMetadataQueryResult>(
        `
          SELECT *
          FROM nft_metadata
          LIMIT $1
          OFFSET $2
          `,
        [limit, offset]
      );
      const parsed = resultQuery.rows.map(r => {
        const metadata: DbNonFungibleTokenMetadata = {
          name: r.name,
          description: r.description,
          token_uri: r.token_uri,
          image_uri: r.image_uri,
          image_canonical_uri: r.image_canonical_uri,
          contract_id: r.contract_id,
          tx_id: bufferToHexPrefixString(r.tx_id),
          sender_address: r.sender_address,
        };
        return metadata;
      });
      return { results: parsed, total: totalQuery.rows[0].count };
    });
  }

  /**
   * Called when a full event import is complete.
   */
  async finishEventReplay() {
    if (!this.eventReplay) {
      return;
    }
    await this.queryTx(async client => {
      await this.refreshMaterializedView(client, 'nft_custody', false);
    });
  }

  async close(): Promise<void> {
    await this.notifier?.close();
    await this.pool.end();
  }
}
