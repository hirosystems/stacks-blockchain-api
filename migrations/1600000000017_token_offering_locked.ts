import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('token_offering_locked', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bigint',
      notNull: true,
    },
    block: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.createIndex('token_offering_locked', 'address', { method: 'hash' });
}

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('token_offering_locked');
}

