/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
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

  pgm.createIndex('burnchain_rewards', 'burn_block_hash', { method: 'hash' });
  pgm.createIndex('burnchain_rewards', 'reward_recipient', { method: 'hash' });
  pgm.createIndex('burnchain_rewards', [{ name: 'burn_block_height', sort: 'DESC' }]);
}
