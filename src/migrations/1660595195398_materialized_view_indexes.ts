/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addIndex('chain_tip', 'block_height', { unique: true });
  pgm.addIndex('mempool_digest', 'digest', { unique: true });
  pgm.addIndex('nft_custody', ['asset_identifier', 'value'], { unique: true });
  pgm.addIndex('nft_custody_unanchored', ['asset_identifier', 'value'], { unique: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('chain_tip', 'block_height', { unique: true, ifExists: true });
  pgm.dropIndex('mempool_digest', 'digest', { unique: true, ifExists: true });
  pgm.dropIndex('nft_custody', ['asset_identifier', 'value'], { unique: true, ifExists: true });
  pgm.dropIndex('nft_custody_unanchored', ['asset_identifier', 'value'], { unique: true, ifExists: true });
}
