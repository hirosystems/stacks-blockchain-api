import { Pool, PoolClient, ClientConfig, Client } from 'pg';
import { parsePort, getCurrentGitTag, PROJECT_DIR } from '../helpers';
import { DataStore, DbBlock } from './common';
import PgMigrate from 'node-pg-migrate';
import path = require('path');

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

async function runMigrations(clientConfig: ClientConfig): Promise<void> {
  const client = new Client(clientConfig);
  try {
    await client.connect();
    const migrationsDir = path.join(PROJECT_DIR, 'migrations');
    await PgMigrate({
      dbClient: client,
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
    });
  } finally {
    await client.end();
  }
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
        insert into blocks(block_hash, index_block_hash, parent_block_hash, parent_microblock) values($1, $2, $3, $4)
        on conflict(block_hash)
        do update set index_block_hash = $2, parent_block_hash = $3, parent_microblock = $4;
        `,
        [block.block_hash, block.index_block_hash, block.parent_block_hash, block.parent_microblock]
      );
    } finally {
      client.release();
    }
  }

  async getBlock(blockHash: string): Promise<DbBlock> {
    const result = await this.pool.query<DbBlock>(
      `
      select block_hash, index_block_hash, parent_block_hash, parent_microblock from blocks
      where block_hash = $1
      `,
      [blockHash]
    );
    return result.rows[0];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
