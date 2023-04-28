/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {

  pgm.addColumn('pox_state', { 
    pox_v2_unlock_height: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
  });
}

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropColumn('pox_state', 'pox_v2_unlock_height');
}
