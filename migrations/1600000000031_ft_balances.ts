import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('ft_balances', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    address: {
      type: 'text',
      notNull: true,
    },
    token: {
      type: 'text',
      notNull: true,
    },
    balance: {
      type: 'numeric',
      notNull: true,
    },
  });

  pgm.addConstraint('ft_balances', 'unique_address_token', `UNIQUE(address, token)`);
  pgm.createIndex('ft_balances', [{ name: 'token' }, { name: 'balance', sort: 'DESC' }]);
}

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('ft_balances');
}

