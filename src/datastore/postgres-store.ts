import { Pool, PoolClient, ClientConfig, Client } from 'pg';
import {
  parsePort,
  getCurrentGitTag,
  PROJECT_DIR,
  isTestEnv,
  isDevEnv,
  bufferToHexPrefixString,
  hexToBuffer,
} from '../helpers';
import { DataStore, DbBlock, DbTx, DbStxEvent, DbFtEvent, DbNftEvent, DbTxTypeId } from './common';
import PgMigrate from 'node-pg-migrate';
import * as path from 'path';

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

export async function runMigrations(
  clientConfig: ClientConfig = getPgClientConfig(),
  direction: 'up' | 'down' = 'up'
): Promise<void> {
  if (direction !== 'up' && !isTestEnv && !isDevEnv) {
    throw new Error(
      'Whoa there! This is a testing function that will drop all data from PG. ' +
        'Set NODE_ENV to "test" or "development" to enable migration testing.'
    );
  }
  clientConfig = clientConfig ?? getPgClientConfig();
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
  const clientConfig = getPgClientConfig();
  await runMigrations(clientConfig, 'down');
  await runMigrations(clientConfig, 'up');
}

/**
 * Reformats a `0x` prefixed hex string to the PG `\\x` prefix format.
 * @param hex - A hex string with a `0x` prefix.
 */
function formatPgHexString(hex: string): string {
  const buff = hexToBuffer(hex);
  return formatPgHexBuffer(buff);
}

function formatPgHexBuffer(buff: Buffer): string {
  return '\\x' + buff.toString('hex');
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
          block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, canonical
        ) values($1, $2, $3, $4, $5, $6)
        on conflict(block_hash)
        do update set 
          index_block_hash = $2, parent_block_hash = $3, parent_microblock = $4, block_height = $5, canonical = $6
        `,
        [
          formatPgHexString(block.block_hash),
          formatPgHexString(block.index_block_hash),
          formatPgHexString(block.parent_block_hash),
          formatPgHexString(block.parent_microblock),
          block.block_height,
          block.canonical,
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
      canonical: boolean;
    }>(
      `
      select 
        block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, canonical
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
      canonical: row.canonical,
    };
    return block;
  }

  async updateTx(tx: DbTx): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `
        insert into txs(
          tx_id, tx_index, block_hash, block_height, type_id, status, canonical, post_conditions
        ) values($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          formatPgHexString(tx.tx_id),
          tx.tx_index,
          formatPgHexString(tx.block_hash),
          tx.block_height,
          tx.type_id,
          tx.status,
          tx.canonical,
          tx.post_conditions === undefined ? null : formatPgHexBuffer(tx.post_conditions),
        ]
      );
    } finally {
      client.release();
    }
  }

  async getTx(txId: string): Promise<DbTx> {
    const result = await this.pool.query<{
      tx_id: Buffer;
      tx_index: number;
      block_hash: Buffer;
      block_height: number;
      type_id: number;
      status: number;
      canonical: boolean;
      post_conditions?: Buffer;
    }>(
      `
      select 
        tx_id, tx_index, block_hash, block_height, type_id, status, canonical, post_conditions
      from txs
      where tx_id = $1
      `,
      [formatPgHexString(txId)]
    );
    const row = result.rows[0];
    const tx: DbTx = {
      tx_id: txId,
      tx_index: row.tx_index,
      block_hash: bufferToHexPrefixString(row.block_hash),
      block_height: row.block_height,
      type_id: row.type_id as DbTxTypeId,
      status: row.status,
      canonical: row.canonical,
      post_conditions: row.post_conditions === null ? undefined : row.post_conditions,
    };
    return tx;
  }

  updateStxEvent(event: DbStxEvent): Promise<void> {
    throw new Error('not implemented.');
  }
  updateFtEvent(event: DbFtEvent): Promise<void> {
    throw new Error('not implemented.');
  }
  updateNftEvent(event: DbNftEvent): Promise<void> {
    throw new Error('not implemented.');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
