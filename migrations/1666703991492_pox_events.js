/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('pox2_events', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    event_index: {
      type: 'integer',
      notNull: true,
    },
    tx_id: {
      notNull: true,
      type: 'bytea',
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
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
    stacker: {
      type: 'string',
      notNull: true,
    },
    locked: {
      type: 'numeric',
      notNull: true,
    },
    balance: {
      type: 'numeric',
      notNull: true,
    },
    burnchain_unlock_height: {
      type: 'bigint',
      notNull: true,
    },
    name: {
      type: 'string',
      notNull: true,
    },
    pox_addr: {
      type: 'string',
    },
    pox_addr_raw: {
      type: 'bytea',
    },
    first_cycle_locked: { // unique to handle-unlock
      type: 'numeric',
    },
    first_unlocked_cycle: { // unique to handle-unlock
      type: 'numeric',
    },
    lock_period: { // unique to stack-stx, delegate-stack-stx
      type: 'numeric'
    },
    lock_amount: { // unique to stack-stx, delegate-stack-stx
      type: 'numeric'
    },
    start_burn_height: { // unique to stack-stx, delegate-stack-stx
      type: 'numeric',
    },
    unlock_burn_height: { // unique to stack-stx, stack-extend, delegate-stack-stx, delegate-stack-extend
      type: 'numeric',
    },
    delegator: { // unique to delegate-stack-stx, delegate-stack-increase, delegate-stack-extend
      type: 'string',
    },
    increase_by: { // unique to stack-increase, delegate-stack-increase
      type: 'numeric',
    },
    total_locked: { // unique to stack-increase, delegate-stack-increase
      type: 'numeric',
    },
    extend_count: { // unique to stack-extend, delegate-stack-extend
      type: 'numeric',
    },
    reward_cycle: { // unique to stack-aggregation-commit
      type: 'numeric',
    },
    amount_ustx: { // unique to stack-aggregation-commit
      type: 'numeric',
    },
  });

  pgm.addConstraint('pox2_events', 'valid_handle_unlock', `CHECK(name != 'handle-unlock' OR (
    first_cycle_locked IS NOT NULL AND 
    first_unlocked_cycle IS NOT NULL
  ))`);

  pgm.addConstraint('pox2_events', 'valid_stack_stx', `CHECK(name != 'stack-stx' OR (
    lock_period IS NOT NULL AND 
    lock_amount IS NOT NULL AND 
    start_burn_height IS NOT NULL AND 
    unlock_burn_height IS NOT NULL
  ))`);

  pgm.addConstraint('pox2_events', 'valid_stack_increase', `CHECK(name != 'stack-increase' OR (
    increase_by IS NOT NULL AND 
    total_locked IS NOT NULL
  ))`);

  pgm.addConstraint('pox2_events', 'valid_stack_extend', `CHECK(name != 'stack-extend' OR (
    extend_count IS NOT NULL AND 
    unlock_burn_height IS NOT NULL
  ))`);

  pgm.addConstraint('pox2_events', 'valid_delegate_stack_stx', `CHECK(name != 'delegate-stack-stx' OR (
    lock_period IS NOT NULL AND 
    lock_amount IS NOT NULL AND 
    start_burn_height IS NOT NULL AND 
    unlock_burn_height IS NOT NULL AND 
    delegator IS NOT NULL
  ))`);

  pgm.addConstraint('pox2_events', 'valid_delegate_stack_increase', `CHECK(name != 'delegate-stack-increase' OR (
    increase_by IS NOT NULL AND 
    total_locked IS NOT NULL AND
    delegator IS NOT NULL
  ))`);

  pgm.addConstraint('pox2_events', 'valid_delegate_stack_extend', `CHECK(name != 'delegate-stack-extend' OR (
    extend_count IS NOT NULL AND 
    unlock_burn_height IS NOT NULL AND 
    delegator IS NOT NULL
  ))`);

  pgm.addConstraint('pox2_events', 'valid_stack_aggregation_commit', `CHECK(name != 'stack-aggregation-commit' OR (
    reward_cycle IS NOT NULL AND 
    amount_ustx IS NOT NULL
  ))`);

  pgm.createIndex('pox2_events', 'block_height');
  pgm.createIndex('pox2_events', 'tx_id');
  pgm.createIndex('pox2_events', 'index_block_hash');
  pgm.createIndex('pox2_events', 'microblock_hash');

  pgm.createIndex('pox2_events', 'stacker');
  pgm.createIndex('pox2_events', 'burnchain_unlock_height');
  pgm.createIndex('pox2_events', 'pox_addr');
  pgm.createIndex('pox2_events', 'delegator');
  pgm.createIndex('pox2_events', 'name');
}
