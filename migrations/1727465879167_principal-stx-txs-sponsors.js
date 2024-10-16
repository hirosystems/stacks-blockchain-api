/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.sql(`
    INSERT INTO principal_stx_txs
      (principal, tx_id, block_height, index_block_hash, microblock_hash, microblock_sequence,
      tx_index, canonical, microblock_canonical)
    (
      SELECT
        sponsor_address AS principal, tx_id, block_height, index_block_hash, microblock_hash,
        microblock_sequence, tx_index, canonical, microblock_canonical
      FROM txs
      WHERE sponsor_address IS NOT NULL
    )
    ON CONFLICT ON CONSTRAINT unique_principal_tx_id_index_block_hash_microblock_hash DO NOTHING  
  `);
};

exports.down = pgm => {};
