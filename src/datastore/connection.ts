import { PgConnectionArgs, PgConnectionOptions } from '@stacks/api-toolkit';
import { ENV } from '../env';

/**
 * The postgres server being used for a particular connection, transaction or query.
 * The API will automatically choose between `default` (or read replica) and `primary`.
 * See `.env` for more information.
 */
export enum PgServer {
  default,
  primary,
}

/**
 * Get the connection arguments for a particular server.
 * @param server - The server to get the connection arguments for.
 * @returns The connection arguments.
 */
export function getConnectionArgs(server: PgServer = PgServer.default): PgConnectionArgs {
  const primary = server === PgServer.primary;
  return {
    database: primary ? (ENV.PG_PRIMARY_DATABASE ?? ENV.PG_DATABASE) : ENV.PG_DATABASE,
    user: primary ? (ENV.PG_PRIMARY_USER ?? ENV.PG_USER) : ENV.PG_USER,
    password: primary ? (ENV.PG_PRIMARY_PASSWORD ?? ENV.PG_PASSWORD) : ENV.PG_PASSWORD,
    host: primary ? (ENV.PG_PRIMARY_HOST ?? ENV.PG_HOST) : ENV.PG_HOST,
    port: primary ? (ENV.PG_PRIMARY_PORT ?? ENV.PG_PORT) : ENV.PG_PORT,
    ssl: primary ? (ENV.PG_PRIMARY_SSL ?? ENV.PG_SSL) : ENV.PG_SSL,
    schema: primary ? (ENV.PG_PRIMARY_SCHEMA ?? ENV.PG_SCHEMA) : ENV.PG_SCHEMA,
    application_name: ENV.PG_APPLICATION_NAME,
  };
}

/**
 * Get the connection config for a particular server.
 * @param server - The server to get the connection config for.
 * @returns The connection config.
 */
export function getConnectionConfig(server: PgServer = PgServer.default): PgConnectionOptions {
  const primary = server === PgServer.primary;
  return {
    idleTimeout: primary
      ? (ENV.PG_PRIMARY_IDLE_TIMEOUT ?? ENV.PG_IDLE_TIMEOUT)
      : ENV.PG_IDLE_TIMEOUT,
    maxLifetime: primary
      ? (ENV.PG_PRIMARY_MAX_LIFETIME ?? ENV.PG_MAX_LIFETIME)
      : ENV.PG_MAX_LIFETIME,
    poolMax: primary
      ? (ENV.PG_PRIMARY_CONNECTION_POOL_MAX ?? ENV.PG_CONNECTION_POOL_MAX)
      : ENV.PG_CONNECTION_POOL_MAX,
    statementTimeout: primary
      ? (ENV.PG_PRIMARY_STATEMENT_TIMEOUT ?? ENV.PG_STATEMENT_TIMEOUT)
      : ENV.PG_STATEMENT_TIMEOUT,
  };
}
