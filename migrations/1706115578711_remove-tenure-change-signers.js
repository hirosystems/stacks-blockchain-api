/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropConstraint('txs', 'valid_tenure-change');
  pgm.dropColumns('txs', ['tenure_change_signature', 'tenure_change_signers']);
  pgm.addConstraint('txs', 'valid_tenure-change', `CHECK (type_id != 7 OR (
    NOT (tenure_change_tenure_consensus_hash, tenure_change_prev_tenure_consensus_hash, tenure_change_burn_view_consensus_hash, tenure_change_previous_tenure_end, tenure_change_previous_tenure_blocks, tenure_change_cause, tenure_change_pubkey_hash) IS NULL
  ))`);

  pgm.dropConstraint('mempool_txs', 'valid_tenure-change');
  pgm.dropColumns('mempool_txs', ['tenure_change_signature', 'tenure_change_signers']);
  pgm.addConstraint('mempool_txs', 'valid_tenure-change', `CHECK (type_id != 7 OR (
    NOT (tenure_change_tenure_consensus_hash, tenure_change_prev_tenure_consensus_hash, tenure_change_burn_view_consensus_hash, tenure_change_previous_tenure_end, tenure_change_previous_tenure_blocks, tenure_change_cause, tenure_change_pubkey_hash) IS NULL
  ))`);
};

exports.down = pgm => {
  pgm.dropConstraint('txs', 'valid_tenure-change');
  pgm.addColumns('txs', {
    tenure_change_signature: 'bytea',
    tenure_change_signers: 'bytea',
  });
  pgm.addConstraint('txs', 'valid_tenure-change', `CHECK (type_id != 7 OR (
    NOT (tenure_change_tenure_consensus_hash, tenure_change_prev_tenure_consensus_hash, tenure_change_burn_view_consensus_hash, tenure_change_previous_tenure_end, tenure_change_previous_tenure_blocks, tenure_change_cause, tenure_change_pubkey_hash, tenure_change_signature, tenure_change_signers) IS NULL
  ))`);

  pgm.dropConstraint('mempool_txs', 'valid_tenure-change');
  pgm.addColumns('mempool_txs', {
    tenure_change_signature: 'bytea',
    tenure_change_signers: 'bytea',
  });
  pgm.addConstraint('mempool_txs', 'valid_tenure-change', `CHECK (type_id != 7 OR (
    NOT (tenure_change_tenure_consensus_hash, tenure_change_prev_tenure_consensus_hash, tenure_change_burn_view_consensus_hash, tenure_change_previous_tenure_end, tenure_change_previous_tenure_blocks, tenure_change_cause, tenure_change_pubkey_hash, tenure_change_signature, tenure_change_signers) IS NULL
  ))`);
};
