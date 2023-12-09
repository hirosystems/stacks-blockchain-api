/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  // Adds pox4_events table which matches previous pox2_events table
  pgm.createTable('pox4_events', {
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
    first_cycle_locked: {
      // unique to handle-unlock
      type: 'numeric',
    },
    first_unlocked_cycle: {
      // unique to handle-unlock
      type: 'numeric',
    },
    delegate_to: {
      // unique to delegate-stx
      type: 'string',
    },
    lock_period: {
      // unique to stack-stx, delegate-stack-stx
      type: 'numeric',
    },
    lock_amount: {
      // unique to stack-stx, delegate-stack-stx
      type: 'numeric',
    },
    start_burn_height: {
      // unique to stack-stx, delegate-stack-stx
      type: 'numeric',
    },
    unlock_burn_height: {
      // unique to stack-stx, stack-extend, delegate-stack-stx, delegate-stack-extend, delegate-stx
      type: 'numeric',
    },
    delegator: {
      // unique to delegate-stack-stx, delegate-stack-increase, delegate-stack-extend
      type: 'string',
    },
    increase_by: {
      // unique to stack-increase, delegate-stack-increase
      type: 'numeric',
    },
    total_locked: {
      // unique to stack-increase, delegate-stack-increase
      type: 'numeric',
    },
    extend_count: {
      // unique to stack-extend, delegate-stack-extend
      type: 'numeric',
    },
    reward_cycle: {
      // unique to stack-aggregation-*
      type: 'numeric',
    },
    amount_ustx: {
      // unique to stack-aggregation-*, delegate-stx
      type: 'numeric',
    },
  });

  pgm.addConstraint(
    'pox4_events',
    'valid_event_specific_columns',
    `CHECK (
    CASE name
      WHEN 'handle-unlock' THEN
        first_cycle_locked IS NOT NULL AND
        first_unlocked_cycle IS NOT NULL
      WHEN 'stack-stx' THEN
        lock_period IS NOT NULL AND
        lock_amount IS NOT NULL AND
        start_burn_height IS NOT NULL AND
        unlock_burn_height IS NOT NULL
      WHEN 'stack-increase' THEN
        increase_by IS NOT NULL AND
        total_locked IS NOT NULL
      WHEN 'stack-extend' THEN
        extend_count IS NOT NULL AND
        unlock_burn_height IS NOT NULL
      WHEN 'delegate-stx' THEN
        amount_ustx IS NOT NULL AND
        delegate_to IS NOT NULL
      WHEN 'delegate-stack-stx' THEN
        lock_period IS NOT NULL AND
        lock_amount IS NOT NULL AND
        start_burn_height IS NOT NULL AND
        unlock_burn_height IS NOT NULL AND
        delegator IS NOT NULL
      WHEN 'delegate-stack-increase' THEN
        increase_by IS NOT NULL AND
        total_locked IS NOT NULL AND
        delegator IS NOT NULL
      WHEN 'delegate-stack-extend' THEN
        extend_count IS NOT NULL AND
        unlock_burn_height IS NOT NULL AND
        delegator IS NOT NULL
      WHEN 'stack-aggregation-commit' THEN
        reward_cycle IS NOT NULL AND
        amount_ustx IS NOT NULL
      WHEN 'stack-aggregation-commit-indexed' THEN
        reward_cycle IS NOT NULL AND
        amount_ustx IS NOT NULL
      WHEN 'stack-aggregation-increase' THEN
        reward_cycle IS NOT NULL AND
        amount_ustx IS NOT NULL
      ELSE false
    END
  )`
  );

  pgm.createIndex('pox4_events', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' },
  ]);

  pgm.createIndex('pox4_events', 'tx_id');
  pgm.createIndex('pox4_events', 'index_block_hash');
  pgm.createIndex('pox4_events', 'microblock_hash');

  pgm.createIndex('pox4_events', 'stacker');
  pgm.createIndex('pox4_events', 'burnchain_unlock_height');
  pgm.createIndex('pox4_events', 'pox_addr');
  pgm.createIndex('pox4_events', 'delegator');
  pgm.createIndex('pox4_events', 'name');

  pgm.createIndex('pox4_events', 'delegate_to');
  pgm.createIndex('pox4_events', 'unlock_burn_height');
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropTable('pox4_events');
};
