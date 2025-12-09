import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('miner_rewards', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    from_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    mature_block_height: {
      type: 'integer',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    recipient: {
      type: 'string',
      notNull: true,
    },
    miner_address: {
      type: 'string',
    },
    coinbase_amount: {
      type: 'numeric',
      notNull: true,
    },
    tx_fees_anchored: {
      type: 'numeric',
      notNull: true,
    },
    tx_fees_streamed_confirmed: {
      type: 'numeric',
      notNull: true,
    },
    tx_fees_streamed_produced: {
      type: 'numeric',
      notNull: true,
    },
  });

  pgm.createIndex('miner_rewards', ['index_block_hash', 'canonical']);
  pgm.createIndex('miner_rewards', 'recipient');
  pgm.createIndex('miner_rewards', 'miner_address');
  pgm.createIndex('miner_rewards', [{ name: 'mature_block_height', sort: 'DESC' }]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('miner_rewards');
}

