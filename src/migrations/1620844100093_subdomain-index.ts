/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex('subdomains', 'owner' )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('subdomains', 'owner');
}
