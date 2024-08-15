// TODO: This file exists because we use the old `pg` library to stream node events during replays.
// we should migrate replays into `postgres.js` and delete this file.

import { Client, ClientConfig, Pool, PoolClient, PoolConfig } from 'pg';
import { PgServer } from '../datastore/connection';
import { logger } from '../logger';
import { isPgConnectionError, parseBoolean, stopwatch, timeout } from '@hirosystems/api-toolkit';
import { parsePort } from '../helpers';

type PgClientConfig = ClientConfig & { schema?: string };
type PgPoolConfig = PoolConfig & { schema?: string };

/**
 * Connects to a Postgres pool. This function will also test the connection first to make sure
 * all connection parameters are specified correctly in `.env`.
 * @param args - Connection options
 * @returns configured `Pool` object
 */
export async function connectPgPool({
  usageName,
  pgServer,
}: {
  usageName: string;
  pgServer: PgServer;
}): Promise<Pool> {
  const initTimer = stopwatch();
  let connectionError: Error | undefined;
  let connectionOkay = false;
  let lastElapsedLog = 0;
  do {
    const clientConfig = getPgClientConfig({
      usageName: `${usageName};init-connection-poll`,
      pgServer: pgServer,
    });
    const client = new Client(clientConfig);
    try {
      await client.connect();
      connectionOkay = true;
      break;
    } catch (error: any) {
      const pgConnectionError = isPgConnectionError(error);
      if (!pgConnectionError) {
        logger.error(error, 'Cannot connect to pg');
        throw error;
      }
      const timeElapsed = initTimer.getElapsed();
      if (timeElapsed - lastElapsedLog > 2000) {
        lastElapsedLog = timeElapsed;
        logger.error('Pg connection failed, retrying..');
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
  const poolConfig: PoolConfig = getPgClientConfig({
    usageName: `${usageName};datastore-crud`,
    getPoolConfig: true,
    pgServer: pgServer,
  });
  const pool = new Pool(poolConfig);
  pool.on('error', error => {
    logger.error(error, `Postgres connection pool error: ${error.message}`);
  });
  return pool;
}

/**
 * @typeParam TGetPoolConfig - If specified as true, returns a PoolConfig object where max connections are configured. Otherwise, returns a regular ClientConfig.
 */
function getPgClientConfig<TGetPoolConfig extends boolean = false>({
  usageName,
  pgServer,
  getPoolConfig,
}: {
  usageName: string;
  pgServer?: PgServer;
  getPoolConfig?: TGetPoolConfig;
}): TGetPoolConfig extends true ? PgPoolConfig : PgClientConfig {
  // Retrieve a postgres ENV value depending on the target database server (read-replica/default or primary).
  // We will fall back to read-replica values if a primary value was not given.
  // See the `.env` file for more information on these options.
  const pgEnvValue = (name: string): string | undefined =>
    pgServer === PgServer.primary
      ? process.env[`PG_PRIMARY_${name}`] ?? process.env[`PG_${name}`]
      : process.env[`PG_${name}`];
  const pgEnvVars = {
    database: pgEnvValue('DATABASE'),
    user: pgEnvValue('USER'),
    password: pgEnvValue('PASSWORD'),
    host: pgEnvValue('HOST'),
    port: pgEnvValue('PORT'),
    ssl: pgEnvValue('SSL'),
    schema: pgEnvValue('SCHEMA'),
    applicationName: pgEnvValue('APPLICATION_NAME'),
  };
  const defaultAppName = 'stacks-blockchain-api';
  const pgConnectionUri = pgEnvValue('CONNECTION_URI');
  const pgConfigEnvVar = Object.entries(pgEnvVars).find(([, v]) => typeof v === 'string')?.[0];
  if (pgConfigEnvVar && pgConnectionUri) {
    throw new Error(
      `Both PG_CONNECTION_URI and ${pgConfigEnvVar} environmental variables are defined. PG_CONNECTION_URI must be defined without others or omitted.`
    );
  }
  let clientConfig: PgClientConfig;
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
    clientConfig = {
      connectionString: uri.toString(),
      schema,
    };
  } else {
    const appName = `${pgEnvVars.applicationName ?? defaultAppName}:${usageName}`;
    clientConfig = {
      database: pgEnvVars.database,
      user: pgEnvVars.user,
      password: pgEnvVars.password,
      host: pgEnvVars.host,
      port: parsePort(pgEnvVars.port),
      ssl: parseBoolean(pgEnvVars.ssl),
      schema: pgEnvVars.schema,
      application_name: appName,
    };
  }
  if (getPoolConfig) {
    const poolConfig: PgPoolConfig = { ...clientConfig };
    const pgConnectionPoolMaxEnv = process.env['PG_CONNECTION_POOL_MAX'];
    if (pgConnectionPoolMaxEnv) {
      poolConfig.max = Number.parseInt(pgConnectionPoolMaxEnv);
    }
    return poolConfig;
  } else {
    return clientConfig;
  }
}
