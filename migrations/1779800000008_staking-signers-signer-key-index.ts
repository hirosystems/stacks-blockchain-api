import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Backs the signing-key → signer-manager lookup used by the PoX cycle signer
 * endpoints (`/extended/v2/pox/cycles/{cycle}/signers*`), which resolve each
 * `pox_sets.signing_key` to its registered signer-manager contract. Ordered by
 * `block_height DESC` so the latest registration wins when the same key was
 * registered by more than one signer principal.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('staking_signers', ['signer_key', { name: 'block_height', sort: 'DESC' }], {
    name: 'staking_signers_signer_key_block_height_idx',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('staking_signers', ['signer_key', 'block_height'], {
    name: 'staking_signers_signer_key_block_height_idx',
  });
}
