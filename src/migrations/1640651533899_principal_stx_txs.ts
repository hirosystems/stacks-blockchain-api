/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  /**
   * Stores all `tx_id`s of transactions that affect a principal's STX balance since that cannot be
   * directly determined from the `txs` table (an expensive JOIN with `stx_events` is required).
   */
  pgm.createTable('principal_stx_txs', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    principal: {
      type: 'string',
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
  });

  pgm.createIndex('principal_stx_txs', 'tx_id', { method: 'hash' });
  pgm.createIndex('principal_stx_txs', 'principal', { method: 'hash' });
  pgm.createIndex('principal_stx_txs', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' }
  ]);

  pgm.addConstraint('principal_stx_txs', 'unique_principal_tx_id', `UNIQUE(principal, tx_id)`);
}
