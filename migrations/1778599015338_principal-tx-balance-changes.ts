import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder) {
  pgm.createTable('principal_tx_balance_changes', {
    principal: {
      type: 'text',
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
    asset_type: {
      type: 'smallint', // 1: STX, 2: FT, 3: NFT
      notNull: true,
    },
    asset_identifier: {
      type: 'text',
      notNull: true,
    },
    sent: {
      type: 'numeric',
      notNull: true,
    },
    received: {
      type: 'numeric',
      notNull: true,
    },
  });

  pgm.addColumn('principal_txs', {
    balance_change_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });

  // Backfill `principal_tx_balance_changes` from existing event/tx tables. This must mirror
  // the write path in `PgWriteStore.updatePrincipalTxs` exactly:
  //   - The tx fee always contributes an STX `sent` row from the fee payer
  //     (sponsor if sponsored, otherwise the sender).
  //   - For STX/FT/NFT events, the sender contributes `sent` and the recipient contributes
  //     `received`. NFT events count tokens moved (1 per event), matching the `numeric`
  //     `sent`/`received` semantics of this table.
  // The event-table CHECK constraints guarantee `sender IS NULL` on mints and
  // `recipient IS NULL` on burns, so the `IS NOT NULL` filters are sufficient — no need to
  // also gate on `asset_event_type_id`.
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier,
      SUM(sent)     AS sent,
      SUM(received) AS received
    FROM (
      -- Tx fee paid by sponsor (if sponsored) or sender.
      SELECT
        COALESCE(sponsor_address, sender_address) AS principal,
        tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical,
        1::smallint  AS asset_type,
        'stx'::text AS asset_identifier,
        fee_rate::numeric AS sent,
        0::numeric        AS received
      FROM txs
      UNION ALL
      -- STX sender side (transfer + burn).
      SELECT
        sender AS principal,
        tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical,
        1::smallint, 'stx'::text,
        amount::numeric, 0::numeric
      FROM stx_events
      WHERE sender IS NOT NULL
      UNION ALL
      -- STX recipient side (transfer + mint).
      SELECT
        recipient AS principal,
        tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical,
        1::smallint, 'stx'::text,
        0::numeric, amount::numeric
      FROM stx_events
      WHERE recipient IS NOT NULL
      UNION ALL
      -- FT sender side.
      SELECT
        sender AS principal,
        tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical,
        2::smallint, asset_identifier,
        amount::numeric, 0::numeric
      FROM ft_events
      WHERE sender IS NOT NULL
      UNION ALL
      -- FT recipient side.
      SELECT
        recipient AS principal,
        tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical,
        2::smallint, asset_identifier,
        0::numeric, amount::numeric
      FROM ft_events
      WHERE recipient IS NOT NULL
      UNION ALL
      -- NFT sender side, counted as 1 token per event.
      SELECT
        sender AS principal,
        tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical,
        3::smallint, asset_identifier,
        1::numeric, 0::numeric
      FROM nft_events
      WHERE sender IS NOT NULL
      UNION ALL
      -- NFT recipient side, counted as 1 token per event.
      SELECT
        recipient AS principal,
        tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical,
        3::smallint, asset_identifier,
        0::numeric, 1::numeric
      FROM nft_events
      WHERE recipient IS NOT NULL
    ) AS src
    GROUP BY
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier
  `);

  // Backfill the newly added `principal_txs.balance_change_count` from the rows we just
  // inserted, so the column reflects reality instead of the column default of 0.
  pgm.sql(`
    WITH counts AS (
      SELECT principal, tx_id, index_block_hash, microblock_hash,
             COUNT(*)::integer AS cnt
      FROM principal_tx_balance_changes
      GROUP BY principal, tx_id, index_block_hash, microblock_hash
    )
    UPDATE principal_txs AS pt
    SET balance_change_count = c.cnt
    FROM counts AS c
    WHERE pt.principal        = c.principal
      AND pt.tx_id            = c.tx_id
      AND pt.index_block_hash = c.index_block_hash
      AND pt.microblock_hash  = c.microblock_hash;
  `);

  pgm.addConstraint(
    'principal_tx_balance_changes',
    'unique_principal_tx_balance_changes',
    'UNIQUE(principal, tx_id, index_block_hash, microblock_hash, asset_type, asset_identifier)'
  );

  pgm.createIndex('principal_tx_balance_changes', 'tx_id');
  pgm.createIndex('principal_tx_balance_changes', ['index_block_hash', 'canonical']);
  pgm.createIndex('principal_tx_balance_changes', 'microblock_hash');
}

export function down(pgm: MigrationBuilder) {
  pgm.dropTable('principal_tx_balance_changes');
  pgm.dropColumn('principal_txs', 'balance_change_count');
}
