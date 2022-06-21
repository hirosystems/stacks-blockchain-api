/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex('nft_custody', 'value', { method: 'hash' });
  pgm.createIndex('nft_custody_unanchored', 'value', { method: 'hash' });
}
