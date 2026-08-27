import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Supports the fungible token holders endpoints, which list a token's holders
 * sorted by balance descending and keyset-paginate by `(balance, address)`.
 *
 * This replaces the older `(token, balance DESC)` index rather than adding to
 * it: the `address` tiebreaker is what lets the keyset predicate
 * `(balance = $1 AND address >= $2)` be served from the index instead of a heap
 * filter, and the two-column index is a strict prefix of this one, so nothing
 * that used it loses its access path.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('ft_balances', [
    { name: 'token' },
    { name: 'balance', sort: 'DESC' },
    { name: 'address', sort: 'ASC' },
  ]);
  pgm.dropIndex('ft_balances', [{ name: 'token' }, { name: 'balance', sort: 'DESC' }]);
}

export function down(pgm: MigrationBuilder): void {
  pgm.createIndex('ft_balances', [{ name: 'token' }, { name: 'balance', sort: 'DESC' }]);
  pgm.dropIndex('ft_balances', [
    { name: 'token' },
    { name: 'balance', sort: 'DESC' },
    { name: 'address', sort: 'ASC' },
  ]);
}
