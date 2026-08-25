import type { MigrationBuilder } from 'node-pg-migrate';

// Materialized per-principal STX event counts, used by the
// `/v3/principals/:principal/transfers/stx/{inbound,outbound}` endpoints to report totals without a
// per-request COUNT(*) over a principal's entire event set (untenable for exchange-scale accounts).
// Maintained on the write path following the `principal_tx_counts` convention: counts track
// `canonical = true` rows.
export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('principal_stx_event_counts', {
    principal: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    inbound_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    outbound_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    INSERT INTO principal_stx_event_counts (principal, inbound_count, outbound_count)
    SELECT
      COALESCE(i.principal, o.principal) AS principal,
      COALESCE(i.count, 0) AS inbound_count,
      COALESCE(o.count, 0) AS outbound_count
    FROM (
      SELECT recipient AS principal, COUNT(*) AS count
      FROM stx_events
      WHERE canonical = TRUE AND recipient IS NOT NULL
      GROUP BY recipient
    ) AS i
    FULL OUTER JOIN (
      SELECT sender AS principal, COUNT(*) AS count
      FROM stx_events
      WHERE canonical = TRUE AND sender IS NOT NULL
      GROUP BY sender
    ) AS o ON i.principal = o.principal
  `);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('principal_stx_event_counts');
};
