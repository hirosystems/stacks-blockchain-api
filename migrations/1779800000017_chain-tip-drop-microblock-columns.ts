import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Microblocks were removed in the Nakamoto upgrade and the API no longer ingests them, so the
 * `chain_tip` columns that tracked the unanchored microblock stream are dead: `microblock_hash` and
 * `microblock_sequence` have been NULL since the 3.0 activation, `microblock_count` stopped
 * advancing then, and `tx_count_unanchored` always mirrored `tx_count`. Nothing reads them anymore.
 *
 * `chain_tip` is a single-row table, so the drop is metadata-only and instant.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.dropColumn('chain_tip', 'microblock_hash');
  pgm.dropColumn('chain_tip', 'microblock_sequence');
  pgm.dropColumn('chain_tip', 'microblock_count');
  pgm.dropColumn('chain_tip', 'tx_count_unanchored');
}

export function down(pgm: MigrationBuilder): void {
  pgm.addColumn('chain_tip', {
    microblock_hash: {
      type: 'bytea',
    },
    microblock_sequence: {
      type: 'integer',
    },
    microblock_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    tx_count_unanchored: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`UPDATE chain_tip SET tx_count_unanchored = tx_count`);
}
