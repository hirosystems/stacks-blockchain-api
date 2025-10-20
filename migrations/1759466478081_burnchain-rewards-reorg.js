/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.sql(`
    UPDATE burnchain_rewards
    SET canonical = COALESCE(
      (
        SELECT canonical
        FROM blocks
        WHERE blocks.burn_block_hash = burnchain_rewards.burn_block_hash
        LIMIT 1
      ),
      false
    )
  `);
};

exports.down = pgm => {};
