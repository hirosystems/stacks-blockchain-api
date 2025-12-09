import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('reward_slot_holders', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    burn_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    slot_index: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.createIndex('reward_slot_holders', 'burn_block_hash', { method: 'hash' });
  pgm.createIndex('reward_slot_holders', [{ name: 'burn_block_height', sort: 'DESC' }]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('reward_slot_holders');
}

