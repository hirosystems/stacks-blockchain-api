/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

const INDEX_METHOD = process.env.PG_IDENT_INDEX_TYPE as any;

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('zonefiles', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    zonefile: {
      type: 'string',
      notNull: true,
    },
    zonefile_hash: {
      type: 'string',
      notNull: true,
    }
  });

  pgm.createIndex('zonefiles', 'zonefile_hash', { method: INDEX_METHOD });
}
