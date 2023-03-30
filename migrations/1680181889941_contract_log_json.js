/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = async pgm => {
  pgm.addColumn('contract_logs', {
    value_json: {
      type: 'jsonb',
    },
  });
}

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('contract_logs', 'value_json_path_ops_idx');
  pgm.dropColumn('contract_logs', 'value_json');
}
