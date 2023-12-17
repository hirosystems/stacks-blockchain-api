/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.addColumn('pox_state', { 
    pox_v3_unlock_height: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
  });

  pgm.addColumns('txs', {
    // `nakamoto-coinbase` tx types
    coinbase_vrf_proof: 'bytea',

    // `tenure-change` tx types
    tenure_change_tenure_consensus_hash: 'bytea',
    tenure_change_prev_tenure_consensus_hash: 'bytea',
    tenure_change_burn_view_consensus_hash: 'bytea',
    tenure_change_previous_tenure_end: 'bytea',
    tenure_change_previous_tenure_blocks: 'integer',
    tenure_change_cause: 'smallint',
    tenure_change_pubkey_hash: 'bytea',
    tenure_change_signature: 'bytea',
    tenure_change_signers: 'bytea',
  });

  pgm.addColumns('mempool_txs', {
    // `nakamoto-coinbase` tx  types
    coinbase_vrf_proof: 'bytea',

    // `tenure-change` tx types
    tenure_change_tenure_consensus_hash: 'bytea',
    tenure_change_prev_tenure_consensus_hash: 'bytea',
    tenure_change_burn_view_consensus_hash: 'bytea',
    tenure_change_previous_tenure_end: 'bytea',
    tenure_change_previous_tenure_blocks: 'integer',
    tenure_change_cause: 'smallint',
    tenure_change_pubkey_hash: 'bytea',
    tenure_change_signature: 'bytea',
    tenure_change_signers: 'bytea',
  });

  pgm.addConstraint('txs', 'valid_tenure-change', `CHECK (type_id != 7 OR (
    NOT (tenure_change_tenure_consensus_hash, tenure_change_prev_tenure_consensus_hash, tenure_change_burn_view_consensus_hash, tenure_change_previous_tenure_end, tenure_change_previous_tenure_blocks, tenure_change_cause, tenure_change_pubkey_hash, tenure_change_signature, tenure_change_signers) IS NULL
  ))`);

  pgm.addConstraint('txs', 'valid_nakamoto-coinbase', `CHECK (type_id != 8 OR (
    NOT (coinbase_payload, coinbase_vrf_proof) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_tenure-change', `CHECK (type_id != 7 OR (
    NOT (tenure_change_tenure_consensus_hash, tenure_change_prev_tenure_consensus_hash, tenure_change_burn_view_consensus_hash, tenure_change_previous_tenure_end, tenure_change_previous_tenure_blocks, tenure_change_cause, tenure_change_pubkey_hash, tenure_change_signature, tenure_change_signers) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_nakamoto-coinbase', `CHECK (type_id != 8 OR (
    NOT (coinbase_payload, coinbase_vrf_proof) IS NULL
  ))`);
};
