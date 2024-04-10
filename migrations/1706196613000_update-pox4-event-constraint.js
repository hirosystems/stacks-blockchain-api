/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropConstraint('pox4_events', 'valid_event_specific_columns', { ifExists: true });
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
      WHEN 'revoke-delegate-stx' THEN
        delegate_to IS NOT NULL
      ELSE false
    END
  )`
  );
};

exports.down = pgm => {
  pgm.dropConstraint('pox4_events', 'valid_event_specific_columns', { ifExists: true });

  // constraint from migrations/1702134678728_pox_4_events.js
  // first, remove rows that would violate the constraint
  pgm.sql("DELETE FROM pox4_events WHERE name = 'revoke-delegate-stx';");
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
};
