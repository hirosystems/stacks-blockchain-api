import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('principal_tx_counts', {
    principal: {
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
    INSERT INTO principal_tx_counts (principal, count)
    (SELECT principal, COUNT(*) AS count FROM principal_txs GROUP BY principal)
  `);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('principal_tx_counts');
};
