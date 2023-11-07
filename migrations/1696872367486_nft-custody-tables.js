/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropMaterializedView('nft_custody');
  pgm.createTable('nft_custody', {
    asset_identifier: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bytea',
      notNull: true,
    },
    recipient: {
      type: 'text',
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
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    event_index: {
      type: 'integer',
      notNull: true,
    },
  });
  pgm.createConstraint('nft_custody', 'nft_custody_unique', 'UNIQUE(asset_identifier, value)');
  pgm.createIndex('nft_custody', ['recipient', 'asset_identifier']);
  pgm.createIndex('nft_custody', 'value');
  pgm.createIndex('nft_custody', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' }
  ]);
  pgm.sql(`
    INSERT INTO nft_custody (asset_identifier, value, recipient, tx_id, block_height, index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, tx_index, event_index) (
      SELECT
        DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient, tx_id, nft.block_height, 
        nft.index_block_hash, nft.parent_index_block_hash, nft.microblock_hash, nft.microblock_sequence, nft.tx_index, nft.event_index
      FROM
        nft_events AS nft
      INNER JOIN
        txs USING (tx_id)
      WHERE
        txs.canonical = true
        AND txs.microblock_canonical = true
        AND nft.canonical = true
        AND nft.microblock_canonical = true
      ORDER BY
        asset_identifier,
        value,
        txs.block_height DESC,
        txs.microblock_sequence DESC,
        txs.tx_index DESC,
        nft.event_index DESC
    )
  `);

  pgm.dropMaterializedView('nft_custody_unanchored');
  pgm.createTable('nft_custody_unanchored', {
    asset_identifier: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bytea',
      notNull: true,
    },
    recipient: {
      type: 'text',
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
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    event_index: {
      type: 'integer',
      notNull: true,
    },
  });
  pgm.createConstraint('nft_custody_unanchored', 'nft_custody_unanchored_unique', 'UNIQUE(asset_identifier, value)');
  pgm.createIndex('nft_custody_unanchored', ['recipient', 'asset_identifier']);
  pgm.createIndex('nft_custody_unanchored', 'value');
  pgm.createIndex('nft_custody_unanchored', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' }
  ]);
  pgm.sql(`
    INSERT INTO nft_custody_unanchored (asset_identifier, value, recipient, tx_id, block_height, index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, tx_index, event_index) (
      SELECT
        DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient, tx_id, nft.block_height,
        nft.index_block_hash, nft.parent_index_block_hash, nft.microblock_hash, nft.microblock_sequence, nft.tx_index, nft.event_index
      FROM
        nft_events AS nft
      INNER JOIN
        txs USING (tx_id)
      WHERE
        txs.canonical = true
        AND txs.microblock_canonical = true
        AND nft.canonical = true
        AND nft.microblock_canonical = true
      ORDER BY
        asset_identifier,
        value,
        txs.block_height DESC,
        txs.microblock_sequence DESC,
        txs.tx_index DESC,
        nft.event_index DESC
    )
  `);
};

exports.down = pgm => {
  pgm.dropTable('nft_custody');
  pgm.createMaterializedView('nft_custody', { data: true }, `
    SELECT
      DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient, tx_id, nft.block_height
    FROM
      nft_events AS nft
    INNER JOIN
      txs USING (tx_id)
    WHERE
      txs.canonical = true
      AND txs.microblock_canonical = true
      AND nft.canonical = true
      AND nft.microblock_canonical = true
    ORDER BY
      asset_identifier,
      value,
      txs.block_height DESC,
      txs.microblock_sequence DESC,
      txs.tx_index DESC,
      nft.event_index DESC
  `);
  pgm.createIndex('nft_custody', ['recipient', 'asset_identifier']);
  pgm.createIndex('nft_custody', ['asset_identifier', 'value'], { unique: true });
  pgm.createIndex('nft_custody', 'value');

  pgm.dropTable('nft_custody_unanchored');
  pgm.createMaterializedView('nft_custody_unanchored', { data: true }, `
    SELECT
      DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient, tx_id, nft.block_height
    FROM
      nft_events AS nft
    INNER JOIN
      txs USING (tx_id)
    WHERE
      txs.canonical = true
      AND txs.microblock_canonical = true
      AND nft.canonical = true
      AND nft.microblock_canonical = true
    ORDER BY
      asset_identifier,
      value,
      txs.block_height DESC,
      txs.microblock_sequence DESC,
      txs.tx_index DESC,
      nft.event_index DESC
  `);
  pgm.createIndex('nft_custody_unanchored', ['recipient', 'asset_identifier']);
  pgm.createIndex('nft_custody_unanchored', ['asset_identifier', 'value'], { unique: true });
  pgm.createIndex('nft_custody_unanchored', 'value');
};
