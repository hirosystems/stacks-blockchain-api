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

  // Unique constraint created before the backfill so each per-source INSERT below can use
  // ON CONFLICT to merge with rows already produced by earlier sources (e.g. the fee row
  // for a principal that also appears as an STX event participant).
  pgm.addConstraint(
    'principal_tx_balance_changes',
    'unique_principal_tx_balance_changes',
    'UNIQUE(principal, tx_id, index_block_hash, microblock_hash, asset_type, asset_identifier)'
  );

  // Staging table for balance_change_count deltas. Each per-source INSERT captures the
  // rows it actually created (via the xmax = 0 idiom on its RETURNING set — true for fresh
  // inserts, false when ON CONFLICT triggered a merge) and writes one partial-count row per
  // (principal, tx, index_block_hash, microblock_hash) here. A final UPDATE rolls these into
  // principal_txs.balance_change_count.
  //
  // Why a staging table instead of either:
  //   (a) One COUNT(*) over the finished principal_tx_balance_changes (the previous design):
  //       that aggregate spans billions of rows, its hash exceeds work_mem and spills to
  //       disk, and the job never finishes.
  //   (b) Inline UPDATE-per-source against principal_txs: each principal_txs row could be
  //       touched by up to 7 sources, meaning up to 7 heap rewrites + index updates per row.
  //       Staging lets the end-of-migration UPDATE touch each row exactly once.
  //
  // TEMP + ON COMMIT DROP: no WAL for the staging rows, table is gone when the migration's
  // transaction commits.
  pgm.sql(`
    CREATE TEMP TABLE balance_count_deltas (
      principal text NOT NULL,
      tx_id bytea NOT NULL,
      index_block_hash bytea NOT NULL,
      microblock_hash bytea NOT NULL,
      delta integer NOT NULL
    ) ON COMMIT DROP
  `);

  // ===== Per-source backfill =====
  //
  // Mirrors PgWriteStore.updatePrincipalTxs:
  //   - Tx fee always contributes an STX `sent` row from the fee payer (sponsor || sender).
  //   - STX/FT events: sender contributes `sent`, recipient contributes `received`.
  //   - NFT events count 1 token per event.
  // Event-table CHECK constraints guarantee sender IS NULL on mints and recipient IS NULL on
  // burns, so the IS NOT NULL filters are sufficient.
  //
  // Each source is its own INSERT so per-statement memory stays bounded by one source table.
  // The wrapping CTE feeds RETURNING into the deltas staging table — only `is_new` rows
  // (newly inserted rather than merged via ON CONFLICT) count as +1 toward
  // balance_change_count.
  const writeDeltas = (sourceInsert: string) => `
    WITH ins AS (
      ${sourceInsert}
      ON CONFLICT ON CONSTRAINT unique_principal_tx_balance_changes DO UPDATE SET
        sent     = principal_tx_balance_changes.sent     + EXCLUDED.sent,
        received = principal_tx_balance_changes.received + EXCLUDED.received
      RETURNING principal, tx_id, index_block_hash, microblock_hash, (xmax = 0) AS is_new
    )
    INSERT INTO balance_count_deltas (principal, tx_id, index_block_hash, microblock_hash, delta)
    SELECT principal, tx_id, index_block_hash, microblock_hash, COUNT(*)::int
    FROM ins
    WHERE is_new
    GROUP BY principal, tx_id, index_block_hash, microblock_hash
  `;

  // Tx fees: one row per tx, no source-side GROUP BY needed.
  pgm.sql(
    writeDeltas(`
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
    `)
  );

  // STX sender side (transfer + burn).
  pgm.sql(
    writeDeltas(`
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
    `)
  );

  // STX recipient side (transfer + mint).
  pgm.sql(
    writeDeltas(`
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
    `)
  );

  // FT sender side.
  pgm.sql(
    writeDeltas(`
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
    `)
  );

  // FT recipient side.
  pgm.sql(
    writeDeltas(`
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
    `)
  );

  // NFT sender side, counted as 1 token per event.
  pgm.sql(
    writeDeltas(`
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
    `)
  );

  // NFT recipient side, counted as 1 token per event.
  pgm.sql(
    writeDeltas(`
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
    `)
  );

  // Roll the staged deltas into principal_txs.balance_change_count. The deltas table holds
  // at most one row per (source, principal, tx, block, mblock) — orders of magnitude smaller
  // than principal_tx_balance_changes itself — so the SUM aggregation is bounded and the
  // join lookups hit principal_txs_unique directly. This is the work that the previous
  // COUNT(*) over the full balance_changes table tried (and failed) to do.
  pgm.sql(`
    WITH counts AS (
      SELECT principal, tx_id, index_block_hash, microblock_hash,
             SUM(delta)::int AS cnt
      FROM balance_count_deltas
      GROUP BY principal, tx_id, index_block_hash, microblock_hash
    )
    UPDATE principal_txs AS pt
    SET balance_change_count = c.cnt
    FROM counts AS c
    WHERE pt.principal        = c.principal
      AND pt.tx_id            = c.tx_id
      AND pt.index_block_hash = c.index_block_hash
      AND pt.microblock_hash  = c.microblock_hash
  `);

  pgm.createIndex('principal_tx_balance_changes', 'tx_id');
  pgm.createIndex('principal_tx_balance_changes', ['index_block_hash', 'canonical']);
  pgm.createIndex('principal_tx_balance_changes', 'microblock_hash');
}

export function down(pgm: MigrationBuilder) {
  pgm.dropTable('principal_tx_balance_changes');
  pgm.dropColumn('principal_txs', 'balance_change_count');
}
