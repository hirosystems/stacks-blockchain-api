import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Indexes backing the name matching in the v3 search endpoint.
 *
 * Search resolves a partial term against contract ids and principals, which the existing indexes
 * cannot serve: the default btrees use the database collation, so they are unusable for `LIKE
 * 'term%'` prefix scans, and no index at all can serve the substring match (`ILIKE '%term%'`) that
 * powers fuzzy contract-name search. Two index kinds cover both:
 *
 * - `text_pattern_ops` btrees for prefix matching, on `smart_contracts.contract_id` (a partial
 *   contract principal such as `SP2C2….arkadi`) and `principal_tx_counts.principal` (a partial
 *   account address). The latter table holds one row per principal ever seen (millions, versus the
 *   billions of rows in `txs` and the event tables) so prefix search never touches the large
 *   tables, and its index only gains an entry when a principal is seen for the first time.
 * - A `pg_trgm` GIN index on `smart_contracts.contract_id` for substring and similarity matching,
 *   which also supplies the `similarity()` ranking score. `smart_contracts` gains one row per
 *   contract deploy, so GIN maintenance is negligible on the ingestion path.
 *
 * `pg_trgm` is optional. It is a trusted extension (PG 13+), so the database owner can install it
 * without superuser, but an operator whose server does not ship it (or whose role lacks `CREATE` on
 * the database) must still be able to migrate. Both failures are caught here and the trigram index
 * is skipped; the API detects its absence at runtime and falls back to unindexed substring
 * matching, which is correct but slower and ranks by match position instead of similarity.
 *
 * Installing the extension after this migration has run does NOT create the skipped index:
 * node-pg-migrate records a migration once and never re-runs it. An operator who adds `pg_trgm`
 * later should create the indexes by hand:
 *
 *   CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX CONCURRENTLY IF NOT EXISTS
 *   smart_contracts_contract_id_trgm_idx ON smart_contracts USING gin (contract_id gin_trgm_ops);
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS token_assets_asset_identifier_trgm_idx ON token_assets
 *   USING gin (asset_identifier gin_trgm_ops);
 */
export function up(pgm: MigrationBuilder): void {
  // `CREATE EXTENSION` inside an exception block runs as a subtransaction, so a failure rolls back
  // to the savepoint and leaves this migration's transaction intact.
  pgm.sql(`
    DO $$
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not install the pg_trgm extension (%). Fuzzy name matching in the v3 search endpoint will fall back to unindexed substring matching. Install pg_trgm and create the trigram indexes by hand to enable it.', SQLERRM;
    END
    $$;
  `);

  pgm.createIndex('smart_contracts', [{ name: 'contract_id', opclass: 'text_pattern_ops' }], {
    name: 'smart_contracts_contract_id_pattern_idx',
  });
  pgm.createIndex('principal_tx_counts', [{ name: 'principal', opclass: 'text_pattern_ops' }], {
    name: 'principal_tx_counts_principal_pattern_idx',
  });

  // Deferred through `EXECUTE` so `gin_trgm_ops` is never parsed when the extension is absent.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        EXECUTE 'CREATE INDEX smart_contracts_contract_id_trgm_idx
                   ON smart_contracts USING gin (contract_id gin_trgm_ops)';
      END IF;
    END
    $$;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('principal_tx_counts', [], {
    name: 'principal_tx_counts_principal_pattern_idx',
    ifExists: true,
  });
  pgm.dropIndex('smart_contracts', [], {
    name: 'smart_contracts_contract_id_trgm_idx',
    ifExists: true,
  });
  pgm.dropIndex('smart_contracts', [], {
    name: 'smart_contracts_contract_id_pattern_idx',
    ifExists: true,
  });
  // The extension is deliberately left installed. `up` creates it with `IF NOT EXISTS`, so it may
  // well predate this migration and be shared with objects this migration knows nothing about;
  // dropping it could remove something another feature depends on, or fail outright.
}
