import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * pox-5 bond position roll-overs, one row per bond position a staker rolled out of. pox-5 keeps a
 * staker in exactly one live position: `register-for-bond` replaces any earlier bond membership
 * and `stake` deletes it, with the node carrying the single account lock into the new position.
 * The API mirrors that by marking the earlier `principal_bond_positions` row `rolled_over` and
 * releasing its locked STX/BTC from the bond and principal aggregates.
 *
 * That is an in-place mutation of a row from an older block, which the reorg flip of
 * `principal_bond_positions` (keyed by the row's own `index_block_hash`) cannot undo. These rows
 * are the flag-carrying source behind it: they are flipped by the roll-over tx's block like every
 * other pox-5 source row, and the flip restores the position (from `previous_*` / `released_*`)
 * when the block is orphaned, or applies the roll-over when a side-fork block becomes canonical.
 *
 * `previous_status` is NULL while the roll-over has not been applied to the position (side-fork
 * row, or a position that was not eligible at apply time); `released_*` are 0 in that state.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('bond_position_rollovers', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    // The staker and the bond position that was rolled out of.
    principal: {
      type: 'text',
      notNull: true,
    },
    bond_index: {
      type: 'integer',
      notNull: true,
    },
    // Position state captured when the roll-over was applied, for restoration on orphan.
    previous_status: {
      type: 'smallint',
    },
    previous_active: {
      type: 'boolean',
    },
    released_btc: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    released_stx: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    // The roll-over tx (`register-for-bond` or `stake`).
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
    },
    block_time: {
      type: 'bigint',
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
    },
    burn_block_time: {
      type: 'bigint',
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
  });

  pgm.createIndex('bond_position_rollovers', ['index_block_hash', 'canonical']);
  pgm.createIndex('bond_position_rollovers', ['principal', 'bond_index']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('bond_position_rollovers');
}
