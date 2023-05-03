import { parseArgBoolean, parsePort, stopwatch, timeout } from '../helpers';
import * as postgres from 'postgres';
import { isPgConnectionError } from './helpers';
import { logger } from '../logger';

export type PgSqlClient = postgres.Sql<any> | postgres.TransactionSql<any>;

/**
 * The postgres server being used for a particular connection, transaction or query.
 * The API will automatically choose between `default` (or read replica) and `primary`.
 * See `.env` for more information.
 */
export enum PgServer {
  default,
  primary,
}

const PG_TYPE_MAPPINGS = {
  // Make both `string` and `Buffer` be compatible with a `bytea` columns.
  // * Buffers and strings with `0x` prefixes will be transformed to hex format (`\x`).
  // * Other strings will be passed as-is.
  // From postgres, all values will be returned as strings with `0x` prefix.
  bytea: {
    to: 17,
    from: [17],
    serialize: (x: any) => {
      if (typeof x === 'string') {
        if (/^(0x|0X)[a-fA-F0-9]*$/.test(x)) {
          // hex string with "0x" prefix
          if (x.length % 2 !== 0) {
            throw new Error(`Hex string is an odd number of digits: "${x}"`);
          }
          return '\\x' + x.slice(2);
        } else if (x.length === 0) {
          return '\\x';
        } else if (/^\\x[a-fA-F0-9]*$/.test(x)) {
          // hex string with "\x" prefix (already encoded for postgres)
          if (x.length % 2 !== 0) {
            throw new Error(`Hex string is an odd number of digits: "${x}"`);
          }
          return x;
        } else {
          throw new Error(`String value for bytea column does not have 0x prefix: "${x}"`);
        }
      } else if (Buffer.isBuffer(x)) {
        return '\\x' + x.toString('hex');
      } else if (ArrayBuffer.isView(x)) {
        return '\\x' + Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('hex');
      } else {
        throw new Error(
          `Cannot serialize unexpected type "${x.constructor.name}" to bytea hex string`
        );
      }
    },
    parse: (x: any) => `0x${x.slice(2)}`,
  },
};
/** Values will be automatically converted into a `bytea` compatible string before sending to pg. */
export type PgBytea = string | Buffer;
/** The `string` type guarantees the value will fit into the `numeric` pg type. */
export type PgNumeric = string;
/** JSON objects will be automatically stringified before insertion. */
export type PgJsonb = any;

/**
 * Connects to Postgres. This function will also test the connection first to make sure
 * all connection parameters are specified correctly in `.env`.
 * @param args - Connection options
 * @returns configured `Pool` object
 */
export async function connectPostgres({
  usageName,
  pgServer,
}: {
  usageName: string;
  pgServer: PgServer;
}): Promise<PgSqlClient> {
  const initTimer = stopwatch();
  let connectionError: Error | undefined;
  let connectionOkay = false;
  let lastElapsedLog = 0;
  do {
    const testSql = getPostgres({
      usageName: `${usageName};conn-poll`,
      pgServer: pgServer,
    });
    try {
      await testSql`SELECT version()`;
      connectionOkay = true;
      break;
    } catch (error: any) {
      if (isPgConnectionError(error) || error instanceof postgres.PostgresError) {
        const timeElapsed = initTimer.getElapsed();
        if (timeElapsed - lastElapsedLog > 2000) {
          lastElapsedLog = timeElapsed;
          logger.error(error, 'Pg connection failed. Retrying..');
        }
        connectionError = error;
        await timeout(100);
      } else {
        logger.error(error, 'Cannot connect to pg');
        throw error;
      }
    } finally {
      await testSql.end();
    }
  } while (initTimer.getElapsed() < Number.MAX_SAFE_INTEGER);
  if (!connectionOkay) {
    connectionError = connectionError ?? new Error('Error connecting to database');
    throw connectionError;
  }
  const sql = getPostgres({
    usageName: `${usageName};datastore-crud`,
    pgServer: pgServer,
  });
  return sql;
}

/**
 * Retrieve a postgres ENV value depending on the target database server (read-replica/default or
 * primary). We will fall back to read-replica values if a primary value was not given. See the
 * `.env` file for more information on these options.
 */
export function getPgConnectionEnvValue(
  name: string,
  pgServer: PgServer = PgServer.default
): string | undefined {
  return pgServer === PgServer.primary
    ? process.env[`PG_PRIMARY_${name}`] ?? process.env[`PG_${name}`]
    : process.env[`PG_${name}`];
}

export function getPostgres({
  usageName,
  pgServer,
}: {
  usageName: string;
  pgServer?: PgServer;
}): PgSqlClient {
  const pgEnvVars = {
    database: getPgConnectionEnvValue('DATABASE', pgServer),
    user: getPgConnectionEnvValue('USER', pgServer),
    password: getPgConnectionEnvValue('PASSWORD', pgServer),
    host: getPgConnectionEnvValue('HOST', pgServer),
    port: getPgConnectionEnvValue('PORT', pgServer),
    ssl: getPgConnectionEnvValue('SSL', pgServer),
    schema: getPgConnectionEnvValue('SCHEMA', pgServer),
    applicationName: getPgConnectionEnvValue('APPLICATION_NAME', pgServer),
    idleTimeout: parseInt(getPgConnectionEnvValue('IDLE_TIMEOUT', pgServer) ?? '30'),
    maxLifetime: parseInt(getPgConnectionEnvValue('MAX_LIFETIME', pgServer) ?? '60'),
    poolMax: parseInt(process.env['PG_CONNECTION_POOL_MAX'] ?? '10'),
  };
  const defaultAppName = 'stacks-blockchain-api';
  const pgConnectionUri = getPgConnectionEnvValue('CONNECTION_URI', pgServer);
  const pgConfigEnvVar = Object.entries(pgEnvVars).find(([, v]) => typeof v === 'string')?.[0];
  if (pgConfigEnvVar && pgConnectionUri) {
    throw new Error(
      `Both PG_CONNECTION_URI and ${pgConfigEnvVar} environmental variables are defined. PG_CONNECTION_URI must be defined without others or omitted.`
    );
  }
  let sql: PgSqlClient;
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
    const appName = `${uri.searchParams.get('application_name') ?? defaultAppName}:${usageName}`;
    uri.searchParams.set('application_name', appName);
    sql = postgres(uri.toString(), {
      types: PG_TYPE_MAPPINGS,
      max: pgEnvVars.poolMax,
      connection: {
        application_name: appName,
        search_path: schema,
      },
    });
  } else {
    const appName = `${pgEnvVars.applicationName ?? defaultAppName}:${usageName}`;
    sql = postgres({
      database: pgEnvVars.database,
      user: pgEnvVars.user,
      password: pgEnvVars.password,
      host: pgEnvVars.host,
      port: parsePort(pgEnvVars.port),
      ssl: parseArgBoolean(pgEnvVars.ssl),
      idle_timeout: pgEnvVars.idleTimeout,
      max_lifetime: pgEnvVars.maxLifetime,
      max: pgEnvVars.poolMax,
      types: PG_TYPE_MAPPINGS,
      connection: {
        application_name: appName,
        search_path: pgEnvVars.schema,
      },
    });
  }
  return sql;
}
