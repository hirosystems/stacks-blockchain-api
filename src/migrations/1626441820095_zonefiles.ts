/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

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
    pgm.createIndex('zonefiles', 'zonefile_hash');

    // migrating zonefiles from names and subdomains into new zonefiles table
    
    const res = await pgm.db.query(`
    SELECT zonefile, zonefile_hash
    FROM subdomains
    UNION
    SELECT zonefile, zonefile_hash
    FROM names
    `);
    for(let i = 0;  i < res.rowCount; i++) {
        await pgm.db.query(`INSERT INTO zonefiles (zonefile, zonefile_hash) VALUES ($1, $2)`, [res.rows[i].zonefile, res.rows[i].zonefile_hash]);
    }
    
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable('zonefiles');
}
