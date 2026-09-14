import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Persist the network's PoX cycle geometry on the `pox_state` singleton: the
 * `first_burnchain_block_height`, `reward_cycle_length`, and `prepare_phase_block_length` the node
 * reports at `/v2/pox`. The node does not deliver them through the event stream and they never
 * change for a network, so the writer establishes them once at startup (`ensurePoxConstants`:
 * hardcoded on mainnet, read from the node otherwise) and every API reads them from here
 * (`PgStore.getPoxConstants`). NULL until the writer's first start against this database.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumns('pox_state', {
    pox_first_burnchain_block_height: {
      type: 'integer',
    },
    pox_reward_cycle_length: {
      type: 'integer',
    },
    pox_prepare_phase_block_length: {
      type: 'integer',
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumns('pox_state', [
    'pox_first_burnchain_block_height',
    'pox_reward_cycle_length',
    'pox_prepare_phase_block_length',
  ]);
}
