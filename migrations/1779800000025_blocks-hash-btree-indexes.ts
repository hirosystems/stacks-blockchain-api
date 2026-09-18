import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Replaces the hash-method indexes on `blocks.block_hash` and `blocks.index_block_hash` with
 * btrees, so search can resolve a partial block hash.
 *
 * A hash index only answers equality, which is all these columns needed while the API looked up
 * blocks by a complete hash. Matching a pasted hash prefix is a range scan, which only a btree can
 * serve. Equality lookups are unaffected in practice: a btree over this table is three levels deep
 * with its upper levels permanently cached, so a probe costs the same one or two leaf reads as the
 * hash bucket it replaces, and `blocks` takes one insert per Stacks block, far too slow a write
 * rate for the extra index maintenance to matter. The tradeoff is size (a btree stores the whole
 * 32-byte key where the hash index stored a 4-byte hash code) which is why the hash indexes are
 * dropped rather than kept alongside.
 *
 * `txs.tx_id` needs no equivalent change: its unique constraint over `(tx_id, index_block_hash,
 * microblock_hash)` is already a btree led by `tx_id`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.dropIndex('blocks', 'block_hash');
  pgm.createIndex('blocks', 'block_hash');
  pgm.dropIndex('blocks', 'index_block_hash');
  pgm.createIndex('blocks', 'index_block_hash');
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('blocks', 'index_block_hash');
  pgm.createIndex('blocks', 'index_block_hash', { method: 'hash' });
  pgm.dropIndex('blocks', 'block_hash');
  pgm.createIndex('blocks', 'block_hash', { method: 'hash' });
}
