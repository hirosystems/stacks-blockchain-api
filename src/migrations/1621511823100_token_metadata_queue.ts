/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('token_metadata_queue', {
    queue_id: {
      type: 'serial',
      primaryKey: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    contract_id: {
      type: 'string',
      notNull: true,
    },
    contract_abi: {
      type: 'string',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    processed: {
      type: 'boolean',
      notNull: true,
    }
  });

  pgm.createIndex('token_metadata_queue', 'block_height');
  pgm.createIndex('token_metadata_queue', 'processed');
}
