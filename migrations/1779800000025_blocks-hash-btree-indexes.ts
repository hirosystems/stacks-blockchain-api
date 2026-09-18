import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Makes the block hash columns answer range scans, so search can resolve a partial block hash.
 *
 * Both columns carried a hash-method index, which only answers equality — all the API needed while
 * it looked blocks up by a complete hash. Matching a pasted hash prefix is a range scan, which only
 * a btree can serve. The two columns need different treatment:
 *
 * - `block_hash` has no other index, so its hash index is replaced with a btree. Equality lookups
 *   are unaffected in practice: a btree over this table is three levels deep with its upper levels
 *   permanently cached, so a probe costs the same one or two leaf reads as the hash bucket it
 *   replaces, and `blocks` takes one insert per Stacks block, far too slow a write rate for the
 *   extra index maintenance to matter. It costs roughly 0.5–1 GB more on disk, since a btree stores
 *   the whole 32-byte key where the hash index stored a 4-byte hash code.
 * - `index_block_hash` is the table's primary key, so a unique btree already covers it and serves
 *   range scans. Its hash index is pure duplication once equality no longer needs it, so it is
 *   dropped rather than replaced, saving both the build and the ongoing maintenance of a second
 *   full index.
 *
 * `txs.tx_id` needs no equivalent change: its unique constraint over `(tx_id, index_block_hash,
 * microblock_hash)` is already a btree led by `tx_id`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.dropIndex('blocks', 'block_hash');
  pgm.createIndex('blocks', 'block_hash');
  pgm.dropIndex('blocks', 'index_block_hash');
}

export function down(pgm: MigrationBuilder): void {
  pgm.createIndex('blocks', 'index_block_hash', { method: 'hash' });
  pgm.dropIndex('blocks', 'block_hash');
  pgm.createIndex('blocks', 'block_hash', { method: 'hash' });
}
