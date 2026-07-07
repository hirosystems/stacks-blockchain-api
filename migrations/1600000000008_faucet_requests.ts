import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('faucet_requests', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    currency: {
      type: 'string',
      notNull: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    ip: {
      type: 'string',
      notNull: true,
    },
    occurred_at: {
      type: 'bigint',
      notNull: true,
    },
  });

  pgm.createIndex('faucet_requests', 'address', { method: 'hash' });
}

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('faucet_requests');
}

