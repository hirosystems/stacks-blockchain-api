import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('burnchain_rewards', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    burn_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    burn_amount: {
      type: 'numeric',
      notNull: true,
    },
    reward_recipient: {
      type: 'string',
      notNull: true,
    },
    reward_amount: {
      type: 'numeric',
      notNull: true,
    },
    reward_index: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.createIndex('burnchain_rewards', 'canonical');
  pgm.createIndex('burnchain_rewards', 'burn_block_hash');
  pgm.createIndex('burnchain_rewards', 'burn_block_height');
  pgm.createIndex('burnchain_rewards', 'reward_recipient');

}
