/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.sql(`
    WITH burn_blocks AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_hash, canonical
      FROM blocks
      ORDER BY burn_block_height DESC, block_height DESC
    )
    UPDATE burnchain_rewards
    SET canonical = (
      SELECT canonical
      FROM burn_blocks
      WHERE burnchain_rewards.burn_block_hash = burn_blocks.burn_block_hash
    )
  `);
};

exports.down = pgm => {};
