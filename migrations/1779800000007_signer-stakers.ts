import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Supports listing the stakers that belong to a pox-5 signer.
 *
 * pox-5 `stake` / `stake-update` / `unstake` events carry the `signer` the
 * staker staked under, so we materialize it on `stx_locked_balances` (null for
 * pox-1..4 locks, which have no signer concept). Bond stakers already carry
 * their signer in `bond_registrations(signer, staker)`. The two `signer`
 * indexes back the `/staking/signers/{signer}/stakers` lookup.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('stx_locked_balances', {
    signer: { type: 'text', notNull: false },
  });
  pgm.createIndex('stx_locked_balances', 'signer', {
    name: 'stx_locked_balances_signer_idx',
    where: 'signer IS NOT NULL',
  });
  pgm.createIndex('bond_registrations', ['signer', 'staker'], {
    name: 'bond_registrations_signer_staker_idx',
  });

  // Backfill signer for existing pox-5 STX locks from each staker's latest
  // canonical stake event (a no-op until pox-5 stake events exist).
  pgm.sql(`
    UPDATE stx_locked_balances slb
    SET signer = latest.signer
    FROM (
      SELECT DISTINCT ON (data->>'staker')
        data->>'staker' AS staker,
        data->>'signer' AS signer
      FROM pox5_events
      WHERE canonical = true AND microblock_canonical = true
        AND name IN ('stake', 'stake-update', 'unstake')
      ORDER BY data->>'staker', block_height DESC, microblock_sequence DESC,
        tx_index DESC, event_index DESC
    ) latest
    WHERE slb.principal = latest.staker AND slb.pox_version = 5
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('bond_registrations', ['signer', 'staker'], {
    name: 'bond_registrations_signer_staker_idx',
  });
  pgm.dropIndex('stx_locked_balances', 'signer', {
    name: 'stx_locked_balances_signer_idx',
  });
  pgm.dropColumn('stx_locked_balances', 'signer');
}
