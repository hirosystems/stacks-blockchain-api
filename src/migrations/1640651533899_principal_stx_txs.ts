/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  /**
   * Stores all `tx_id`s of **canonical** transactions that affect a principal's STX balance since
   * that cannot be directly determined from the `txs` table (an expensive JOIN with `stx_events` is required).
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
  });

  pgm.createIndex('principal_stx_txs', [
    { name: 'principal' },
    { name: 'block_height', sort: 'DESC' },
  ]);

  pgm.addConstraint('principal_stx_txs', 'unique_principal_tx_id', `UNIQUE(principal, tx_id)`);
}
