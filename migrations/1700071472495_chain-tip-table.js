/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropMaterializedView('chain_tip');
  pgm.createTable('chain_tip', {
    id: {
      type: 'bool',
      primaryKey: true,
      default: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    block_count: {
      type: 'integer',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
    },
    microblock_sequence: {
      type: 'integer',
    },
    microblock_count: {
      type: 'integer',
      notNull: true,
    },
    tx_count: {
      type: 'integer',
      notNull: true,
    },
    tx_count_unanchored: {
      type: 'integer',
      notNull: true,
    },
  });
  pgm.addConstraint('chain_tip', 'chain_tip_one_row', 'CHECK(id)');
  pgm.sql(`
    WITH block_tip AS (
      SELECT block_height, block_hash, index_block_hash, burn_block_height
        FROM blocks
        WHERE block_height = (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ),
    microblock_tip AS (
      SELECT microblock_hash, microblock_sequence
      FROM microblocks, block_tip
      WHERE microblocks.parent_index_block_hash = block_tip.index_block_hash
      AND microblock_canonical = true AND canonical = true
      ORDER BY microblock_sequence DESC
      LIMIT 1
    ),
    microblock_count AS (
      SELECT COUNT(*)::INTEGER AS microblock_count
      FROM microblocks
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    ),
    tx_count AS (
      SELECT COUNT(*)::INTEGER AS tx_count
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
        AND block_height <= (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ),
    tx_count_unanchored AS (
      SELECT COUNT(*)::INTEGER AS tx_count_unanchored
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    )
    INSERT INTO chain_tip (block_height, block_hash, index_block_hash, burn_block_height,
      block_count, microblock_hash, microblock_sequence, microblock_count, tx_count,
      tx_count_unanchored)
    VALUES (
      COALESCE((SELECT block_height FROM block_tip), 0),
      COALESCE((SELECT block_hash FROM block_tip), ''),
      COALESCE((SELECT index_block_hash FROM block_tip), ''),
      COALESCE((SELECT burn_block_height FROM block_tip), 0),
      COALESCE((SELECT block_height FROM block_tip), 0),
      (SELECT microblock_hash FROM microblock_tip),
      (SELECT microblock_sequence FROM microblock_tip),
      COALESCE((SELECT microblock_count FROM microblock_count), 0),
      COALESCE((SELECT tx_count FROM tx_count), 0),
      COALESCE((SELECT tx_count_unanchored FROM tx_count_unanchored), 0)
    )
  `);
};

exports.down = pgm => {
  pgm.dropTable('chain_tip');
  pgm.createMaterializedView('chain_tip', {}, `
    WITH block_tip AS (
      SELECT block_height, block_hash, index_block_hash, burn_block_height
        FROM blocks
        WHERE block_height = (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ),
    microblock_tip AS (
      SELECT microblock_hash, microblock_sequence
      FROM microblocks, block_tip
      WHERE microblocks.parent_index_block_hash = block_tip.index_block_hash
      AND microblock_canonical = true AND canonical = true
      ORDER BY microblock_sequence DESC
      LIMIT 1
    ),
    microblock_count AS (
      SELECT COUNT(*)::INTEGER AS microblock_count
      FROM microblocks
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    ),
    tx_count AS (
      SELECT COUNT(*)::INTEGER AS tx_count
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
        AND block_height <= (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ),
    tx_count_unanchored AS (
      SELECT COUNT(*)::INTEGER AS tx_count_unanchored
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    )
    SELECT *, block_tip.block_height AS block_count
    FROM block_tip
    LEFT JOIN microblock_tip ON TRUE
    LEFT JOIN microblock_count ON TRUE
    LEFT JOIN tx_count ON TRUE
    LEFT JOIN tx_count_unanchored ON TRUE
    LIMIT 1
  `);
  pgm.createIndex('chain_tip', 'block_height', { unique: true });
};
