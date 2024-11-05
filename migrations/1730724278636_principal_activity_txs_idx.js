/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  // Indexes used to speed up queries in the `getPrincipalLastActivityTxIds` function:
  // https://github.com/hirosystems/stacks-blockchain-api/blob/e3c30c6e0cb14843d5f089b64010d738b0b27763/src/datastore/pg-store.ts#L4440-L4492
  // See issue https://github.com/hirosystems/stacks-blockchain-api/issues/2147

  pgm.createIndex(
    'ft_events', 
    [
      'sender',
      'recipient',
      { name: 'block_height', order: 'DESC' },
      { name: 'microblock_sequence', order: 'DESC' },
      { name: 'tx_index', order: 'DESC' },
      { name: 'event_index', order: 'DESC' }
    ],
    {
      name: 'idx_ft_events_optimized',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'nft_events', 
    [
      'sender',
      'recipient',
      { name: 'block_height', order: 'DESC' },
      { name: 'microblock_sequence', order: 'DESC' },
      { name: 'tx_index', order: 'DESC' },
      { name: 'event_index', order: 'DESC' }
    ],
    {
      name: 'idx_nft_events_optimized',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'mempool_txs', 
    [
      'sender_address',
      'sponsor_address',
      'token_transfer_recipient_address',
      { name: 'receipt_time', order: 'DESC' }
    ],
    {
      name: 'idx_mempool_txs_optimized',
      where: 'pruned = FALSE',
    }
  );
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('ft_events', ['sender', 'recipient', 'block_height', 'microblock_sequence', 'tx_index', 'event_index'], { name: 'idx_ft_events_optimized' });
  pgm.dropIndex('nft_events', ['sender', 'recipient', 'block_height', 'microblock_sequence', 'tx_index', 'event_index'], { name: 'idx_nft_events_optimized' });
  pgm.dropIndex('mempool_txs', ['sender_address', 'sponsor_address', 'token_transfer_recipient_address', 'receipt_time'], { name: 'idx_mempool_txs_optimized' });
};
