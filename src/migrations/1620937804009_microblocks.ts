/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('microblocks', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    receive_timestamp: {
      type: 'timestamp',
      default: pgm.func('(now() at time zone \'utc\')'),
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    // For the first microblock (sequence number 0), this points to the parent/anchor block hash, 
    // for subsequent microblocks it points to the previous microblock's hash.
    microblock_parent_hash: {
      type: 'bytea',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    parent_block_height: {
      type: 'integer',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    parent_burn_block_time: {
      type: 'integer',
      notNull: true,
    },
    parent_burn_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    }
  });

  pgm.createIndex('microblocks', 'index_block_hash');
  pgm.createIndex('microblocks', 'parent_index_block_hash');
  pgm.createIndex('microblocks', 'canonical');

  // TODO(mb): create indexes once we know what they should be by writing the queries using this table
}
