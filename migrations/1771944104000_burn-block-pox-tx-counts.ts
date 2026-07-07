import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('burn_block_pox_tx_counts', {
    recipient: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    INSERT INTO burn_block_pox_tx_counts (recipient, count)
    (SELECT recipient, COUNT(*) AS count FROM burn_block_pox_txs WHERE canonical = true GROUP BY recipient)
  `);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('burn_block_pox_tx_counts');
};
