/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    await pgm.db.query(`
        INSERT INTO zonefiles (zonefile, zonefile_hash)
        SELECT zonefile, zonefile_hash
        FROM names
        UNION
        SELECT zonefile, zonefile_hash
        FROM subdomains
    `);

    // dropping these tables as we won't be needing them, now
    pgm.dropColumn('subdomains', 'zonefile');
    pgm.dropColumn('names', 'zonefile');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    // use pgm function to add column
    await pgm.db.query('ALTER TABLE subdomains ADD zonefile varchar');
    await pgm.db.query('ALTER TABLE names ADD zonefile varchar');
    await pgm.db.query(`
        UPDATE names
        SET zonefile = zonefiles.zonefile
        FROM zonefiles
        WHERE names.zonefile_hash = zonefiles.zonefile_hash;
    `);
    await pgm.db.query(`
        UPDATE subdomains
        SET zonefile = zonefiles.zonefile
        FROM zonefiles
        WHERE subdomains.zonefile_hash = zonefiles.zonefile_hash;
    `);
}
