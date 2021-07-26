/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    await pgm.db.query('ALTER TABLE subdomains DROP zonefile');
    await pgm.db.query('ALTER TABLE names DROP zonefile');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
}
