import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('contract_log_counts', {
    contract_identifier: {
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
    INSERT INTO contract_log_counts (contract_identifier, count)
    (SELECT contract_identifier, COUNT(*) AS count FROM contract_logs WHERE canonical = true AND microblock_canonical = true GROUP BY contract_identifier)
  `);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('contract_log_counts');
};
