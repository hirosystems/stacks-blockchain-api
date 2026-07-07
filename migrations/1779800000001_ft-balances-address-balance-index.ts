import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Supports the principal FT balances endpoint, which lists a principal's tokens
 * sorted by balance descending and keyset-paginates by `(balance, token)`. This
 * composite index lets the `WHERE address = $1 ORDER BY balance DESC, token ASC`
 * scan be served directly from the index.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('ft_balances', [
    { name: 'address' },
    { name: 'balance', sort: 'DESC' },
    { name: 'token', sort: 'ASC' },
  ]);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('ft_balances', [
    { name: 'address' },
    { name: 'balance', sort: 'DESC' },
    { name: 'token', sort: 'ASC' },
  ]);
}
