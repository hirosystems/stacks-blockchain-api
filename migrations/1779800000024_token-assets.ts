import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Distinct on-chain token assets, so search can match a term against an asset identifier without
 * scanning the event tables.
 *
 * Asset identifiers are otherwise only recorded per occurrence: `ft_events`/`nft_events` hold one
 * row per transfer and `ft_balances` one row per address/token pair, all of them far too large to
 * substring-match or even to `DISTINCT` on demand. This table holds one row per asset identifier
 * ever seen (order of tens of thousands) which makes a trigram index over it trivially small.
 *
 * Only the on-chain identifier is stored (`SP….contract-name::asset-name`). The display name and
 * symbol a token reports through `get-name`/`get-symbol` are runtime contract-call results that
 * this API never reads; they belong to token-metadata-api.
 *
 * Rows are never removed on a re-org, because a re-org does not re-insert the events that would
 * recreate them: an asset first seen on a block that is later promoted would be lost forever.
 * Instead `tx_id` records the transaction the asset was first seen in, and search joins it against
 * `txs` to require a canonical one, so an asset that only ever appeared on an orphaned fork stops
 * being returned while the row stays put in case that fork's transaction is later mined.
 *
 * The backfill resolves a transaction for every asset, so `tx_id` ends up `NOT NULL` and search
 * never has to special-case a missing one. No index leads with `asset_identifier` on `ft_events`,
 * but none is needed: a holder comes from `ft_balances`, and
 * `ft_events_recipient_asset_position_index` (already partial on canonical rows) then resolves
 * `(recipient, asset_identifier)` directly. NFT assets go through `nft_events`' `asset_identifier`
 * index the same way. Both probe per asset rather than scanning, so the cost is bounded by the
 * number of distinct assets rather than by the size of the event tables.
 *
 * The backfill walks the existing indexes rather than scanning the source tables: a recursive
 * "loose index scan" (skip scan) descends once per distinct value, using `ft_balances`'s `(token,
 * balance DESC)` index and `nft_custody`'s `(asset_identifier, value)` unique constraint.
 * `ft_balances` also stores STX balances under the pseudo-token `stx`, which is not an asset
 * identifier, so the backfill keeps only values with the `::` asset separator.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('token_assets', {
    asset_identifier: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    asset_type: {
      type: 'text',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
    },
  });

  pgm.sql(`
    WITH RECURSIVE tokens AS (
      (SELECT token FROM ft_balances ORDER BY token LIMIT 1)
      UNION ALL
      SELECT (
        SELECT b.token FROM ft_balances b WHERE b.token > t.token ORDER BY b.token LIMIT 1
      )
      FROM tokens t
      WHERE t.token IS NOT NULL
    )
    INSERT INTO token_assets (asset_identifier, asset_type)
    SELECT token, 'ft' FROM tokens
    WHERE token IS NOT NULL AND token LIKE '%::%'
    ON CONFLICT (asset_identifier) DO NOTHING
  `);

  pgm.sql(`
    WITH RECURSIVE assets AS (
      (SELECT asset_identifier FROM nft_custody ORDER BY asset_identifier LIMIT 1)
      UNION ALL
      SELECT (
        SELECT c.asset_identifier
        FROM nft_custody c
        WHERE c.asset_identifier > a.asset_identifier
        ORDER BY c.asset_identifier
        LIMIT 1
      )
      FROM assets a
      WHERE a.asset_identifier IS NOT NULL
    )
    INSERT INTO token_assets (asset_identifier, asset_type)
    SELECT asset_identifier, 'nft' FROM assets
    WHERE asset_identifier IS NOT NULL AND asset_identifier LIKE '%::%'
    ON CONFLICT (asset_identifier) DO NOTHING
  `);

  // Resolve the transaction each asset was first seen in. For fungible tokens that means finding
  // any holder, then that holder's receiving event: the holder lookup rides `ft_balances`' `(token,
  // balance DESC)` index and the event lookup rides the partial
  // `ft_events_recipient_asset_position_index`, so neither scans. Holders whose receiving events
  // are all non-canonical drop out of the lateral join, and the next holder is tried.
  pgm.sql(`
    UPDATE token_assets ta
    SET tx_id = (
      SELECT e.tx_id
      FROM ft_balances b
      CROSS JOIN LATERAL (
        SELECT ev.tx_id
        FROM ft_events ev
        WHERE ev.recipient = b.address
          AND ev.asset_identifier = ta.asset_identifier
          AND ev.canonical = true
          AND ev.microblock_canonical = true
        LIMIT 1
      ) e
      WHERE b.token = ta.asset_identifier
      LIMIT 1
    )
    WHERE ta.asset_type = 'ft'
  `);

  pgm.sql(`
    UPDATE token_assets ta
    SET tx_id = (
      SELECT ev.tx_id
      FROM nft_events ev
      WHERE ev.asset_identifier = ta.asset_identifier
        AND ev.canonical = true
        AND ev.microblock_canonical = true
      LIMIT 1
    )
    WHERE ta.asset_type = 'nft'
  `);

  // An asset with no canonical event left is one search would filter out anyway, so drop it rather
  // than keep a row that can never be resolved. Its next event re-creates it.
  pgm.sql(`DELETE FROM token_assets WHERE tx_id IS NULL`);
  pgm.alterColumn('token_assets', 'tx_id', { notNull: true });

  // Prefix matching for a partial asset identifier. The primary key's btree uses the database
  // collation and cannot serve `LIKE 'term%'`.
  pgm.createIndex('token_assets', [{ name: 'asset_identifier', opclass: 'text_pattern_ops' }], {
    name: 'token_assets_asset_identifier_pattern_idx',
  });
  // Only when `pg_trgm` is installed; see `1779800000023_search-name-indexes` for what the API
  // falls back to without it. Deferred through `EXECUTE` so `gin_trgm_ops` is never parsed when
  // the extension is absent.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        EXECUTE 'CREATE INDEX token_assets_asset_identifier_trgm_idx
                   ON token_assets USING gin (asset_identifier gin_trgm_ops)';
      END IF;
    END
    $$;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('token_assets');
}
