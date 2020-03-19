import { Pool, PoolClient, ClientConfig, Client } from 'pg';
import { parsePort, getCurrentGitTag, PROJECT_DIR, isTestEnv, isDevEnv, bufferToHexPrefixString } from '../helpers';
import { DataStore, DbBlock, DbTx } from './common';
import PgMigrate from 'node-pg-migrate';
import path = require('path');

const MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATIONS_DIR = path.join(PROJECT_DIR, 'migrations');

export function getPgClientConfig(): ClientConfig {
  const config: ClientConfig = {
    database: process.env['PG_DATABASE'],
    user: process.env['PG_USER'],
    password: process.env['PG_USER'],
    host: process.env['PG_HOST'],
    port: parsePort(process.env['PG_PORT']),
  };
  return config;
}

async function runMigrations(clientConfig: ClientConfig, direction: 'up' | 'down' = 'up'): Promise<void> {
  const client = new Client(clientConfig);
  try {
    await client.connect();
    await PgMigrate({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      direction: direction,
      migrationsTable: MIGRATIONS_TABLE,
      count: Infinity,
    });
  } finally {
    await client.end();
  }
}

export async function cycleMigrations(): Promise<void> {
  if (!isTestEnv && !isDevEnv) {
    throw new Error(
      'Whoa there! This is a testing function that will drop all data from PG. ' +
        'Set NODE_ENV to "test" or "development" to enable migration testing.'
    );
  }
  const clientConfig = getPgClientConfig();
  await runMigrations(clientConfig, 'down');
  await runMigrations(clientConfig, 'up');
}

/**
 * Reformats a `0x` prefixed hex string to the PG `\\x` prefix format.
 * @param hex - A hex string with a `0x` prefix.
 */
function formatPgHexString(hex: string): string {
  if (!hex.startsWith('0x')) {
    throw new Error(`Hex string is missing the "0x" prefix: "${hex}"`);
  }
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string is an odd number of digits: ${hex}`);
  }
  return '\\x' + hex.substring(2);
}

export class PgDataStore implements DataStore {
  private readonly pool: Pool;
  private constructor(pool: Pool) {
    this.pool = pool;
  }

  static async connect(): Promise<PgDataStore> {
    const clientConfig = getPgClientConfig();
    await runMigrations(clientConfig);
    const pool = new Pool({
      ...clientConfig,
      application_name: `stacks-core-sidecar-${getCurrentGitTag()}`,
    });
    let poolClient: PoolClient | undefined;
    try {
      poolClient = await pool.connect();
      return new PgDataStore(pool);
    } catch (error) {
      console.error(`Error connecting to Postgres using ${JSON.stringify(clientConfig)}: ${error}`);
      console.error(error);
      throw error;
    } finally {
      poolClient?.release();
    }
  }

  async updateBlock(block: DbBlock): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `
        insert into blocks(
          block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height
        ) values($1, $2, $3, $4, $5)
        on conflict(block_hash)
        do update set 
          index_block_hash = $2, parent_block_hash = $3, parent_microblock = $4, block_height = $5;
        `,
        [
          formatPgHexString(block.block_hash),
          formatPgHexString(block.index_block_hash),
          formatPgHexString(block.parent_block_hash),
          formatPgHexString(block.parent_microblock),
          block.block_height,
        ]
      );
    } finally {
      client.release();
    }
  }

  async getBlock(blockHash: string): Promise<DbBlock> {
    const result = await this.pool.query<{
      block_hash: Buffer;
      index_block_hash: Buffer;
      parent_block_hash: Buffer;
      parent_microblock: Buffer;
      block_height: number;
    }>(
      `
      select 
        block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height 
      from blocks
      where block_hash = $1
      `,
      [formatPgHexString(blockHash)]
    );
    const row = result.rows[0];
    const block: DbBlock = {
      block_hash: bufferToHexPrefixString(row.block_hash),
      index_block_hash: bufferToHexPrefixString(row.index_block_hash),
      parent_block_hash: bufferToHexPrefixString(row.parent_block_hash),
      parent_microblock: bufferToHexPrefixString(row.parent_microblock),
      block_height: row.block_height,
    };
    return block;
  }

  updateTx(tx: DbTx): Promise<void> {
    throw new Error('not implemented');
  }

  getTx(txId: string): Promise<DbTx> {
    throw new Error('not implemented');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
