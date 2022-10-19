/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.addColumn('mempool_txs', {
    tx_size: {
      type: 'integer',
      notNull: true,
      expressionGenerated: 'length(raw_tx)'
    }
  });

  pgm.createIndex('mempool_txs', ['type_id', 'receipt_block_height'], { where: 'pruned = false'});
  pgm.createIndex('mempool_txs', ['type_id', 'fee_rate'], { where: 'pruned = false'});
  pgm.createIndex('mempool_txs', ['type_id', 'tx_size'], { where: 'pruned = false'});

}
