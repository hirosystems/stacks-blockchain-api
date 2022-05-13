/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

const INDEX_METHOD = process.env.PG_IDENT_INDEX_TYPE as any;

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('token_offering_locked', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bigint',
      notNull: true,
    },
    block: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.createIndex('token_offering_locked', 'address', { method: INDEX_METHOD });
}
