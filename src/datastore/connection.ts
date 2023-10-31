import { PgConnectionArgs, PgConnectionOptions } from '@hirosystems/api-toolkit';

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
 * Retrieve a postgres ENV value depending on the target database server (read-replica/default or
 * primary). We will fall back to read-replica values if a primary value was not given. See the
 * `.env` file for more information on these options.
 */
export function getPgConnectionEnvValue(
  name: string,
  pgServer: PgServer = PgServer.default
): string | undefined {
  const defaultVal = process.env[`PG_${name}`] ?? process.env[`PG${name}`];
  return pgServer === PgServer.primary
    ? process.env[`PG_PRIMARY_${name}`] ?? defaultVal
    : defaultVal;
}

export function getConnectionArgs(server: PgServer = PgServer.default): PgConnectionArgs {
  return (
    getPgConnectionEnvValue('CONNECTION_URI', server) ?? {
      database: getPgConnectionEnvValue('DATABASE', server),
      user: getPgConnectionEnvValue('USER', server),
      password: getPgConnectionEnvValue('PASSWORD', server),
      host: getPgConnectionEnvValue('HOST', server),
      port: parseInt(getPgConnectionEnvValue('PORT', server) ?? '5432'),
      ssl: getPgConnectionEnvValue('SSL', server) == 'true',
      schema: getPgConnectionEnvValue('SCHEMA', server),
      application_name: getPgConnectionEnvValue('APPLICATION_NAME', server),
    }
  );
}

export function getConnectionConfig(server: PgServer = PgServer.default): PgConnectionOptions {
  const statementTimeout = getPgConnectionEnvValue('STATEMENT_TIMEOUT', server);
  return {
    idleTimeout: parseInt(getPgConnectionEnvValue('IDLE_TIMEOUT', server) ?? '30'),
    maxLifetime: parseInt(getPgConnectionEnvValue('MAX_LIFETIME', server) ?? '60'),
    poolMax: parseInt(getPgConnectionEnvValue('CONNECTION_POOL_MAX', server) ?? '10'),
    statementTimeout: statementTimeout ? parseInt(statementTimeout) : undefined,
  };
}
