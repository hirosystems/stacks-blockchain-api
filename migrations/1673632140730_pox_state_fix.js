/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {

  pgm.alterColumn('pox_state', 'pox_v1_unlock_height', {
    type: 'bigint'
  });

}
