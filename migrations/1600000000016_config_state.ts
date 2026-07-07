import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('config_state', {
    id: {
      type: 'bool',
      primaryKey: true,
      default: true,
    },
    bns_names_onchain_imported: {
      type: 'bool',
      notNull: true,
      default: false,
    },
    bns_subdomains_imported: {
      type: 'bool',
      notNull: true,
      default: false,
    },
    token_offering_imported: {
      type: 'bool',
      notNull: true,
      default: false,
    },
  });

  // Ensure only a single row can exist
  pgm.addConstraint('config_state', 'config_state_one_row', 'CHECK(id)');

  // Create the single row
  pgm.sql('INSERT INTO config_state VALUES(DEFAULT)');
}

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('config_state');
}

