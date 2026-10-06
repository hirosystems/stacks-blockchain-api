import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Serves the principal ETag's "latest canonical matured miner reward" lookup (`WHERE recipient = ?
 * AND canonical = true ORDER BY mature_block_height DESC LIMIT 1`) as a single index probe. The
 * existing `recipient` index would have to read and sort every reward an address ever received,
 * which for an active miner is tens of thousands of rows on every cached principal request.
 *
 * `miner_rewards` only gets a handful of rows per block, so the extra index adds negligible
 * write-path cost, and the canonical-only predicate keeps orphaned rewards out of it.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('miner_rewards', ['recipient', { name: 'mature_block_height', sort: 'DESC' }], {
    name: 'miner_rewards_recipient_mature_block_height_canonical_index',
    where: 'canonical = true',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('miner_rewards', [], {
    name: 'miner_rewards_recipient_mature_block_height_canonical_index',
  });
}
