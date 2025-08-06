// @ts-check
/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('snp_state', {
    id: {
      type: 'boolean',
      primaryKey: true,
      default: true,
    },
    last_redis_msg_id: {
      type: 'text',
      notNull: true,
      default: '0',
    },
  });
  // Ensure only a single row can exist
  pgm.addConstraint('snp_state', 'snp_state_one_row', 'CHECK(id)');
  // Create the single row
  pgm.sql('INSERT INTO snp_state VALUES(DEFAULT)');
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropTable('snp_state');
};
