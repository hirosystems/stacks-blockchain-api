import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
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

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('ft_balances');
}

