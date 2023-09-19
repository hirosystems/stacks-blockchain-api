/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('microblocks', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    receive_timestamp: {
      type: 'timestamp',
      default: pgm.func('(now() at time zone \'utc\')'),
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    // For the first microblock (sequence number 0), this points to the parent/anchor block hash,
    // for subsequent microblocks it points to the previous microblock's hash.
    microblock_parent_hash: {
      type: 'bytea',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    parent_block_height: {
      type: 'integer',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    parent_burn_block_time: {
      type: 'integer',
      notNull: true,
    },
    parent_burn_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    }
  });

  pgm.createIndex('microblocks', 'microblock_hash', { method: 'hash' });
  pgm.createIndex('microblocks', 'parent_index_block_hash', { method: 'hash' });
  pgm.createIndex('microblocks', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' }
  ]);

  pgm.addConstraint('microblocks', 'unique_microblock_hash', `UNIQUE(microblock_hash)`);
}
