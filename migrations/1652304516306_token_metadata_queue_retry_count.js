/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.addColumn('token_metadata_queue', {
    retry_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    }
  });
}
