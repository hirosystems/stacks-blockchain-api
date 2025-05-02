/* eslint-disable camelcase */
/** @param { import("node-pg-migrate").MigrationBuilder } pgm */

exports.up = pgm => {
  pgm.addColumn('mempool_txs', {
    replaced_by_tx_id: {
      type: 'bytea', 
    }
  });
};


