import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export const up = (pgm: MigrationBuilder) => {
  // Serves the per-bond event log (`/extended/v3/staking/bonds/:bond_index/events`): the
  // bond-scoped subset of `pox5_events`, keyed by bond index and ordered by canonical event
  // position. The `IS NOT NULL` predicate excludes events without a `bond_index` payload field as
  // well as `claim-staker-rewards-for-signer` events with a JSON-null `bond_index` (STX-only
  // staking claims).
  pgm.sql(`
    CREATE INDEX pox5_events_bond_index_index ON pox5_events (
      ((data->>'bond_index')::int),
      block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
    )
    WHERE canonical = TRUE AND microblock_canonical = TRUE
      AND (data->>'bond_index') IS NOT NULL
  `);

  // Materialized count of a bond's events, maintained incrementally at ingestion and reorg like
  // `registered_count`. Serves as the paginated `total` for the bond events endpoint.
  pgm.addColumn('bonds', {
    event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });

  // Backfill from already-ingested canonical events.
  pgm.sql(`
    UPDATE bonds AS b
    SET event_count = c.event_count
    FROM (
      SELECT (data->>'bond_index')::int AS bond_index, COUNT(*)::int AS event_count
      FROM pox5_events
      WHERE canonical = TRUE AND microblock_canonical = TRUE
        AND (data->>'bond_index') IS NOT NULL
      GROUP BY 1
    ) AS c
    WHERE b.bond_index = c.bond_index
  `);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('pox5_events', [], { name: 'pox5_events_bond_index_index' });
  pgm.dropColumn('bonds', 'event_count');
};
