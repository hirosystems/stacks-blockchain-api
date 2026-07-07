import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Materialized pox-5 staking signer registry — one row per signer principal,
 * holding its currently-registered signing key. Mirrors the contract's
 * `(define-map signers principal (buff 33))`: `register-signer` does a
 * `map-set` keyed by the signer principal, so re-registering overwrites the
 * key (latest-wins). This is a current-state accumulator like
 * `stx_locked_balances` (no canonical column) — upserted on write and
 * recomputed for affected signers on reorg from the canonical `register-signer`
 * rows in `pox5_events`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('staking_signers', {
    // The signer principal (the signer-manager contract that registered itself).
    signer: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    // The registered compressed secp256k1 public key (33 bytes).
    signer_key: {
      type: 'bytea',
      notNull: true,
    },
    // Provenance of the registration.
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('staking_signers');
}
