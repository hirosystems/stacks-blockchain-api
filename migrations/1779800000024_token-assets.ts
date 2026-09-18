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
 * Rows are never removed on a re-org. An asset that only ever appeared on an orphaned fork stays
 * searchable, but every hit links to canonical-filtered endpoints, so the entity it points at
 * simply resolves empty.
 *
 * The backfill walks the existing indexes rather than scanning the source tables: a recursive
 * "loose index scan" (skip scan) descends once per distinct value, using `ft_balances`'s
 * `(token, balance DESC)` index and `nft_custody`'s `(asset_identifier, value)` unique constraint.
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
