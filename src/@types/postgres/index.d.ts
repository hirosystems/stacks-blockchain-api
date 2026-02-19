import 'postgres';

/**
 * In postgres 3.4.x, `TransactionSql` changed from `extends Sql` to `extends Omit<Sql, ...>`.
 * TypeScript's `Omit` strips call/construct signatures and several properties. Declaration merging
 * allows adding a new `extends` clause, so we restore `Sql` inheritance here. This makes
 * `TransactionSql` extend both `Omit<Sql, ...>` (original) and `Sql` (ours), effectively restoring
 * full type compatibility.
 */
declare module 'postgres' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/ban-types
  interface TransactionSql<TTypes extends Record<string, unknown> = {}> extends Sql<TTypes> {}
}
