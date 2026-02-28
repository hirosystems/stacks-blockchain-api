/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_available_extensions
        WHERE name = 'pg_trgm'
      ) THEN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;

        CREATE INDEX IF NOT EXISTS idx_contract_call_function_name_trgm
        ON txs
        USING gin (contract_call_function_name gin_trgm_ops);
      END IF;
    END
    $$;
  `);
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_contract_call_function_name_trgm;
  `);

  pgm.sql('DROP EXTENSION IF EXISTS pg_trgm;');
};
