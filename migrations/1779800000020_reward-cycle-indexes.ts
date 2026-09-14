import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Indexes for the staking cycle endpoint's access paths (all on tables that grow by at most a few
 * hundred rows per cycle):
 *  - `signer_reward_claims(reward_cycle)`: the sBTC a cycle's signer managers have claimed
 *    (previously only indexed by manager).
 *  - `principal_stx_reward_distributions(reward_cycle)`: the distinct STX-only stakers credited
 *    for a cycle (previously only indexed by principal).
 *  - `principal_bond_positions(bond_index)`, canonical rows: a bond's participants, read per
 *    cycle here and on every `bond-distribution` ingestion (the table's only index led with
 *    `principal`).
 *  - `bond_reward_distributions(index_block_hash, canonical)` and `(tx_id)`: the table had no
 *    index; the reorg flip filters by block and the cycle endpoint joins distributions to their
 *    `calculate-rewards` row by tx.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('signer_reward_claims', 'reward_cycle');
  pgm.createIndex('principal_stx_reward_distributions', 'reward_cycle');
  pgm.createIndex('principal_bond_positions', 'bond_index', {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
  });
  pgm.createIndex('bond_reward_distributions', ['index_block_hash', 'canonical']);
  pgm.createIndex('bond_reward_distributions', 'tx_id');
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('bond_reward_distributions', 'tx_id');
  pgm.dropIndex('bond_reward_distributions', ['index_block_hash', 'canonical']);
  pgm.dropIndex('principal_bond_positions', 'bond_index');
  pgm.dropIndex('principal_stx_reward_distributions', 'reward_cycle');
  pgm.dropIndex('signer_reward_claims', 'reward_cycle');
}
