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

  // Create the unique constraint *before* the backfill. Two reasons:
  //   1. The per-source backfill INSERTs below use ON CONFLICT to merge rows when the same
  //      (principal, tx, asset) is touched by multiple sources (e.g. the fee payer also
  //      appears as an STX sender for the same tx). This avoids the single huge UNION ALL
  //      + GROUP BY across every source table, whose hash aggregate was blowing past
  //      work_mem and getting cancelled.
  //   2. (principal, tx_id, index_block_hash, microblock_hash, ...) is a leading prefix of
  //      what the balance_change_count update at the bottom GROUPs by, so that final
  //      COUNT(*) UPDATE can use this index instead of a seq scan + hash aggregate.
  pgm.addConstraint(
    'principal_tx_balance_changes',
    'unique_principal_tx_balance_changes',
    'UNIQUE(principal, tx_id, index_block_hash, microblock_hash, asset_type, asset_identifier)'
  );

  // Backfill `principal_tx_balance_changes` from existing event/tx tables. Must mirror the
  // write path in `PgWriteStore.updatePrincipalTxs`:
  //   - The tx fee always contributes an STX `sent` row from the fee payer
  //     (sponsor if sponsored, otherwise the sender).
  //   - For STX/FT/NFT events, the sender contributes `sent` and the recipient contributes
  //     `received`. NFT events count tokens moved (1 per event), matching the `numeric`
  //     `sent`/`received` semantics of this table.
  // The event-table CHECK constraints guarantee `sender IS NULL` on mints and
  // `recipient IS NULL` on burns, so the `IS NOT NULL` filters are sufficient — no need to
  // also gate on `asset_event_type_id`.
  //
  // Each source is its own INSERT so that the hash aggregate stays bounded by a single
  // table's cardinality. Within each statement we still GROUP BY so the rows we hand to
  // Postgres are already unique on the conflict key (Postgres rejects ON CONFLICT DO UPDATE
  // when the same row is affected twice by a single statement). Across statements,
  // ON CONFLICT merges sent/received from the prior source.
  const conflictMerge = `
    ON CONFLICT ON CONSTRAINT unique_principal_tx_balance_changes DO UPDATE SET
      sent     = principal_tx_balance_changes.sent     + EXCLUDED.sent,
      received = principal_tx_balance_changes.received + EXCLUDED.received
  `;

  // Tx fee paid by sponsor (if sponsored) or sender. One row per tx — no GROUP BY needed.
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      COALESCE(sponsor_address, sender_address),
      tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      1::smallint, 'stx'::text,
      fee_rate::numeric, 0::numeric
    FROM txs
    ${conflictMerge}
  `);

  // STX sender side (transfer + burn).
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      sender,
      tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      1::smallint, 'stx'::text,
      SUM(amount)::numeric, 0::numeric
    FROM stx_events
    WHERE sender IS NOT NULL
    GROUP BY sender, tx_id, block_height, index_block_hash, microblock_hash,
             microblock_sequence, tx_index, canonical, microblock_canonical
    ${conflictMerge}
  `);

  // STX recipient side (transfer + mint).
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      recipient,
      tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      1::smallint, 'stx'::text,
      0::numeric, SUM(amount)::numeric
    FROM stx_events
    WHERE recipient IS NOT NULL
    GROUP BY recipient, tx_id, block_height, index_block_hash, microblock_hash,
             microblock_sequence, tx_index, canonical, microblock_canonical
    ${conflictMerge}
  `);

  // FT sender side.
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      sender,
      tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      2::smallint, asset_identifier,
      SUM(amount)::numeric, 0::numeric
    FROM ft_events
    WHERE sender IS NOT NULL
    GROUP BY sender, asset_identifier, tx_id, block_height, index_block_hash,
             microblock_hash, microblock_sequence, tx_index, canonical, microblock_canonical
    ${conflictMerge}
  `);

  // FT recipient side.
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      recipient,
      tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      2::smallint, asset_identifier,
      0::numeric, SUM(amount)::numeric
    FROM ft_events
    WHERE recipient IS NOT NULL
    GROUP BY recipient, asset_identifier, tx_id, block_height, index_block_hash,
             microblock_hash, microblock_sequence, tx_index, canonical, microblock_canonical
    ${conflictMerge}
  `);

  // NFT sender side, counted as 1 token per event.
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      sender,
      tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      3::smallint, asset_identifier,
      COUNT(*)::numeric, 0::numeric
    FROM nft_events
    WHERE sender IS NOT NULL
    GROUP BY sender, asset_identifier, tx_id, block_height, index_block_hash,
             microblock_hash, microblock_sequence, tx_index, canonical, microblock_canonical
    ${conflictMerge}
  `);

  // NFT recipient side, counted as 1 token per event.
  pgm.sql(`
    INSERT INTO principal_tx_balance_changes (
      principal, tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      asset_type, asset_identifier, sent, received
    )
    SELECT
      recipient,
      tx_id, block_height, index_block_hash, microblock_hash,
      microblock_sequence, tx_index, canonical, microblock_canonical,
      3::smallint, asset_identifier,
      0::numeric, COUNT(*)::numeric
    FROM nft_events
    WHERE recipient IS NOT NULL
    GROUP BY recipient, asset_identifier, tx_id, block_height, index_block_hash,
             microblock_hash, microblock_sequence, tx_index, canonical, microblock_canonical
    ${conflictMerge}
  `);

  // Refresh stats so the planner picks the unique index for the COUNT(*) below instead of
  // falling back to a seq scan based on stale (empty-table) statistics.
  pgm.sql(`ANALYZE principal_tx_balance_changes`);

  // Backfill `principal_txs.balance_change_count` from the rows just inserted. The GROUP BY
  // columns are the leading prefix of `unique_principal_tx_balance_changes`, so the planner
  // can satisfy the aggregate via that index (sort/group rather than seq scan + hash). The
  // join target's `principal_txs_unique` covers the same key on the UPDATE side.
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

  pgm.createIndex('principal_tx_balance_changes', 'tx_id');
  pgm.createIndex('principal_tx_balance_changes', ['index_block_hash', 'canonical']);
  pgm.createIndex('principal_tx_balance_changes', 'microblock_hash');
}

export function down(pgm: MigrationBuilder) {
  pgm.dropTable('principal_tx_balance_changes');
  pgm.dropColumn('principal_txs', 'balance_change_count');
}
