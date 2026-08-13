import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Append-only history of pox-5 signer key bindings: one row per `register-signer`,
 * `grant-signer-key`, or `revoke-signer-grant` event. This table preserves the full timeline so key
 * bindings can be resolved *as of a PoX cycle*: a binding is effective for cycle N if it landed
 * strictly before cycle N's anchor block (the block that computed the cycle's reward set, recorded
 * in `pox_cycles`), which encodes the contract rule that key changes made before the prepare phase
 * apply next cycle and later ones the cycle after. Pure event log with no derived totals — reorgs
 * only flip the canonical flag.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('signer_key_grants', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    // The source event, as `DbSignerKeyGrantKind`: 0 = register-signer, 1 = grant-signer-key, 2 =
    // revoke-signer-grant.
    kind: {
      type: 'smallint',
      notNull: true,
    },
    // The signer manager contract principal the key is bound to (the event's `signer_manager`, or
    // `signer` for register-signer).
    signer_manager: {
      type: 'text',
      notNull: true,
    },
    // The compressed secp256k1 public key (33 bytes).
    signer_key: {
      type: 'bytea',
      notNull: true,
    },
    // The grant's auth id; null for registers and revokes.
    auth_id: {
      type: 'numeric',
    },
    event_index: {
      type: 'integer',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
    },
    block_time: {
      type: 'bigint',
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
    },
    burn_block_time: {
      type: 'bigint',
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
  });

  pgm.createIndex('signer_key_grants', 'tx_id');
  pgm.createIndex('signer_key_grants', ['index_block_hash', 'canonical']);
  // Latest-binding-per-pair resolution, both by key (cycle signer join) and by manager (pending key
  // updates), always position-ordered and canonical-only.
  pgm.createIndex(
    'signer_key_grants',
    [
      'signer_key',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    {
      name: 'signer_key_grants_signer_key_idx',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
  pgm.createIndex(
    'signer_key_grants',
    [
      'signer_manager',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    {
      name: 'signer_key_grants_signer_manager_idx',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  // Backfill from the raw pox-5 event log.
  pgm.sql(`
    INSERT INTO signer_key_grants (
      kind, signer_manager, signer_key, auth_id, event_index, tx_id, tx_index,
      block_height, block_hash, block_time, index_block_hash, parent_block_hash,
      parent_index_block_hash, burn_block_height, burn_block_time, microblock_hash,
      microblock_sequence, microblock_canonical, canonical
    )
    SELECT
      CASE name
        WHEN 'register-signer' THEN 0
        WHEN 'grant-signer-key' THEN 1
        ELSE 2
      END,
      COALESCE(data->>'signer_manager', data->>'signer'),
      decode(substr(data->>'signer_key', 3), 'hex'),
      (data->>'auth_id')::numeric,
      event_index, tx_id, tx_index,
      block_height, block_hash, block_time, index_block_hash, parent_block_hash,
      parent_index_block_hash, burn_block_height, burn_block_time, microblock_hash,
      microblock_sequence, microblock_canonical, canonical
    FROM pox5_events
    WHERE name IN ('register-signer', 'grant-signer-key', 'revoke-signer-grant')
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('signer_key_grants');
}
