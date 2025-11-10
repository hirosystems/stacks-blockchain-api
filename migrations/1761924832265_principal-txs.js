/* eslint-disable camelcase */

exports.shorthands = undefined;

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('principal_txs', {
    principal: {
      type: 'string',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
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
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    stx_balance_affected: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    ft_balance_affected: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    nft_balance_affected: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    stx_sent: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
    stx_received: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
    stx_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    stx_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    stx_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });

  // Migrate principal mentions from `principal_stx_txs` to `principal_txs`. Do this before creating
  // the unique constraint to gain some speed.
  pgm.sql(`
    INSERT INTO principal_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical)
    (
      SELECT principal, tx_id, block_height, index_block_hash, microblock_hash, microblock_sequence,
        tx_index, canonical, microblock_canonical
      FROM principal_stx_txs
    )
  `);

  // Add the unique constraint.
  pgm.addConstraint(
    'principal_txs',
    'principal_txs_unique',
    `UNIQUE(principal, tx_id, index_block_hash, microblock_hash)`
  );

  // Migrate amounts from `stx_events` senders (transfers and burns) and recipients (transfers and
  // mints). Create indexes first to gain some speed.
  pgm.createIndex('stx_events', ['sender', 'tx_id', 'index_block_hash', 'microblock_hash'], { name: 'tmp_stx_events_1' });
  pgm.createIndex('stx_events', ['recipient', 'tx_id', 'index_block_hash', 'microblock_hash'], { name: 'tmp_stx_events_2' });
  pgm.sql(`
    INSERT INTO principal_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical, stx_balance_affected,
      stx_sent,
      stx_transfer_event_count, stx_burn_event_count)
    (
      SELECT
        sender AS principal,
        tx_id,
        MAX(block_height),
        index_block_hash,
        microblock_hash,
        MAX(microblock_sequence),
        MAX(tx_index),
        BOOL_AND(canonical),
        BOOL_AND(microblock_canonical),
        TRUE AS stx_balance_affected,
        SUM(amount),
        COUNT(*) FILTER (WHERE asset_event_type_id = 1),
        COUNT(*) FILTER (WHERE asset_event_type_id = 3)
      FROM stx_events
      WHERE sender IS NOT NULL AND asset_event_type_id IN (1, 3)
      GROUP BY sender, tx_id, index_block_hash, microblock_hash
    )
    ON CONFLICT ON CONSTRAINT principal_txs_unique DO UPDATE
    SET
      stx_balance_affected = TRUE,
      stx_sent = principal_txs.stx_sent + EXCLUDED.stx_sent,
      stx_transfer_event_count = principal_txs.stx_transfer_event_count + EXCLUDED.stx_transfer_event_count,
      stx_burn_event_count = principal_txs.stx_burn_event_count + EXCLUDED.stx_burn_event_count
  `);
  pgm.sql(`
    INSERT INTO principal_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical, stx_balance_affected,
      stx_received,
      stx_transfer_event_count, stx_mint_event_count)
    (
      SELECT
        recipient AS principal,
        tx_id,
        MAX(block_height),
        index_block_hash,
        microblock_hash,
        MAX(microblock_sequence),
        MAX(tx_index),
        BOOL_AND(canonical),
        BOOL_AND(microblock_canonical),
        TRUE AS stx_balance_affected,
        SUM(amount),
        COUNT(*) FILTER (WHERE asset_event_type_id = 1),
        COUNT(*) FILTER (WHERE asset_event_type_id = 2)
      FROM stx_events
      WHERE recipient IS NOT NULL AND asset_event_type_id IN (1, 2)
      GROUP BY recipient, tx_id, index_block_hash, microblock_hash
    )
    ON CONFLICT ON CONSTRAINT principal_txs_unique DO UPDATE
    SET
      stx_balance_affected = TRUE,
      stx_received = principal_txs.stx_received + EXCLUDED.stx_received,
      stx_transfer_event_count = principal_txs.stx_transfer_event_count + EXCLUDED.stx_transfer_event_count,
      stx_mint_event_count = principal_txs.stx_mint_event_count + EXCLUDED.stx_mint_event_count
  `);
  pgm.sql(`DROP INDEX tmp_stx_events_1`);
  pgm.sql(`DROP INDEX tmp_stx_events_2`);

  // Migrate counts from `ft_events` senders (transfers and burns) and recipients (transfers and
  // mints). Create indexes first to gain some speed.
  pgm.createIndex('ft_events', ['sender', 'tx_id', 'index_block_hash', 'microblock_hash'], { name: 'tmp_ft_events_1' });
  pgm.createIndex('ft_events', ['recipient', 'tx_id', 'index_block_hash', 'microblock_hash'], { name: 'tmp_ft_events_2' });
  pgm.sql(`
    INSERT INTO principal_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical, ft_balance_affected,
      ft_transfer_event_count, ft_burn_event_count)
    (
      SELECT
        sender AS principal,
        tx_id,
        MAX(block_height),
        index_block_hash,
        microblock_hash,
        MAX(microblock_sequence),
        MAX(tx_index),
        BOOL_AND(canonical),
        BOOL_AND(microblock_canonical),
        TRUE AS ft_balance_affected,
        COUNT(*) FILTER (WHERE asset_event_type_id = 1),
        COUNT(*) FILTER (WHERE asset_event_type_id = 3)
      FROM ft_events
      WHERE sender IS NOT NULL AND asset_event_type_id IN (1, 3)
      GROUP BY sender, tx_id, index_block_hash, microblock_hash
    )
    ON CONFLICT ON CONSTRAINT principal_txs_unique DO UPDATE
    SET
      ft_balance_affected = TRUE,
      ft_transfer_event_count = principal_txs.ft_transfer_event_count + EXCLUDED.ft_transfer_event_count,
      ft_burn_event_count = principal_txs.ft_burn_event_count + EXCLUDED.ft_burn_event_count
  `);
  pgm.sql(`
    INSERT INTO principal_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical, ft_balance_affected,
      ft_transfer_event_count, ft_mint_event_count)
    (
      SELECT
        recipient AS principal,
        tx_id,
        MAX(block_height),
        index_block_hash,
        microblock_hash,
        MAX(microblock_sequence),
        MAX(tx_index),
        BOOL_AND(canonical),
        BOOL_AND(microblock_canonical),
        TRUE AS ft_balance_affected,
        COUNT(*) FILTER (WHERE asset_event_type_id = 1),
        COUNT(*) FILTER (WHERE asset_event_type_id = 2)
      FROM ft_events
      WHERE recipient IS NOT NULL AND asset_event_type_id IN (1, 2)
      GROUP BY recipient, tx_id, index_block_hash, microblock_hash
    )
    ON CONFLICT ON CONSTRAINT principal_txs_unique DO UPDATE
    SET
      ft_balance_affected = TRUE,
      ft_transfer_event_count = principal_txs.ft_transfer_event_count + EXCLUDED.ft_transfer_event_count,
      ft_mint_event_count = principal_txs.ft_mint_event_count + EXCLUDED.ft_mint_event_count
  `);
  pgm.sql(`DROP INDEX tmp_ft_events_1`);
  pgm.sql(`DROP INDEX tmp_ft_events_2`);

  // Migrate counts from `nft_events` senders (transfers and burns) and recipients (transfers and
  // mints). Create indexes first to gain some speed.
  pgm.createIndex('nft_events', ['sender', 'tx_id', 'index_block_hash', 'microblock_hash'], { name: 'tmp_nft_events_1' });
  pgm.createIndex('nft_events', ['recipient', 'tx_id', 'index_block_hash', 'microblock_hash'], { name: 'tmp_nft_events_2' });
  pgm.sql(`
    INSERT INTO principal_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical, nft_balance_affected,
      nft_transfer_event_count, nft_burn_event_count)
    (
      SELECT
        sender AS principal,
        tx_id,
        MAX(block_height),
        index_block_hash,
        microblock_hash,
        MAX(microblock_sequence),
        MAX(tx_index),
        BOOL_AND(canonical),
        BOOL_AND(microblock_canonical),
        TRUE AS nft_balance_affected,
        COUNT(*) FILTER (WHERE asset_event_type_id = 1),
        COUNT(*) FILTER (WHERE asset_event_type_id = 3)
      FROM nft_events
      WHERE sender IS NOT NULL AND asset_event_type_id IN (1, 3)
      GROUP BY sender, tx_id, index_block_hash, microblock_hash
    )
    ON CONFLICT ON CONSTRAINT principal_txs_unique DO UPDATE
    SET
      nft_balance_affected = TRUE,
      nft_transfer_event_count = principal_txs.nft_transfer_event_count + EXCLUDED.nft_transfer_event_count,
      nft_burn_event_count = principal_txs.nft_burn_event_count + EXCLUDED.nft_burn_event_count
  `);
  pgm.sql(`
    INSERT INTO principal_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical, nft_balance_affected,
      nft_transfer_event_count, nft_mint_event_count)
    (
      SELECT
        recipient AS principal,
        tx_id,
        MAX(block_height),
        index_block_hash,
        microblock_hash,
        MAX(microblock_sequence),
        MAX(tx_index),
        BOOL_AND(canonical),
        BOOL_AND(microblock_canonical),
        TRUE AS nft_balance_affected,
        COUNT(*) FILTER (WHERE asset_event_type_id = 1),
        COUNT(*) FILTER (WHERE asset_event_type_id = 2)
      FROM nft_events
      WHERE recipient IS NOT NULL AND asset_event_type_id IN (1, 2)
      GROUP BY recipient, tx_id, index_block_hash, microblock_hash
    )
    ON CONFLICT ON CONSTRAINT principal_txs_unique DO UPDATE
    SET
      nft_balance_affected = TRUE,
      nft_transfer_event_count = principal_txs.nft_transfer_event_count + EXCLUDED.nft_transfer_event_count,
      nft_mint_event_count = principal_txs.nft_mint_event_count + EXCLUDED.nft_mint_event_count
  `);
  pgm.sql(`DROP INDEX tmp_nft_events_1`);
  pgm.sql(`DROP INDEX tmp_nft_events_2`);

  // Mark the `principal_stx_txs` table as deprecated.
  pgm.sql(`COMMENT ON TABLE principal_stx_txs IS 'Deprecated. Use principal_txs instead.'`);

  // Add indexes to the `principal_txs` table.
  pgm.createIndex('principal_txs', 'tx_id');
  pgm.createIndex(
    'principal_txs',
    [
      { name: 'principal' },
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
    ],
    {
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
};

exports.down = pgm => {
  pgm.dropTable('principal_txs');
  pgm.sql(`COMMENT ON TABLE principal_stx_txs IS NULL`);
};

