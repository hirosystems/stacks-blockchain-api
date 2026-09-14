import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Per-cycle lookups for the staking cycle endpoint: the sBTC a cycle's signer managers have claimed
 * (`signer_reward_claims`, previously only indexed by manager) and the distinct STX-only stakers
 * credited for a cycle (`principal_stx_reward_distributions`, previously only indexed by
 * principal). Both tables grow by a few hundred rows per cycle at most.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('signer_reward_claims', 'reward_cycle');
  pgm.createIndex('principal_stx_reward_distributions', 'reward_cycle');
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('principal_stx_reward_distributions', 'reward_cycle');
  pgm.dropIndex('signer_reward_claims', 'reward_cycle');
}
