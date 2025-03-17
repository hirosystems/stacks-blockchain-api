// @ts-check
/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  /**
   * A previous migration used `order` instead of `sort` in the index definition which caused it to be ignored and default to ASC.
   * The `@ts-check` directive at the top of the file will catch these errors in the future.
   */

  pgm.dropIndex('principal_stx_txs', [], { name: 'idx_principal_stx_txs_optimized' });
  pgm.dropIndex('ft_events', [], { name: 'idx_ft_events_optimized' });
  pgm.dropIndex('nft_events', [], { name: 'idx_nft_events_optimized' });
  pgm.dropIndex('mempool_txs', [], { name: 'idx_mempool_txs_optimized' });

  pgm.createIndex(
    'principal_stx_txs', 
    [
      'principal',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' }],
    {
      name: 'idx_principal_stx_txs_optimized',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'nft_events', 
    [
      'sender',
      'recipient',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' }
    ],
    {
      name: 'idx_nft_events_optimized',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'ft_events', 
    [
      'sender',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' }
    ],
    {
      name: 'idx_ft_events_optimized_sender',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'ft_events', 
    [
      'recipient',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' }
    ],
    {
      name: 'idx_ft_events_optimized_recipient',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'mempool_txs', 
    [
      { name: 'receipt_time', sort: 'DESC' }
    ],
    {
      name: 'idx_mempool_txs_optimized',
      where: 'pruned = FALSE',
    }
  );

};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('principal_stx_txs', [], { name: 'idx_principal_stx_txs_optimized' });
  pgm.dropIndex('ft_events', [], { name: 'idx_ft_events_optimized_sender' });
  pgm.dropIndex('ft_events', [], { name: 'idx_ft_events_optimized_recipient' });
  pgm.dropIndex('nft_events', [], { name: 'idx_nft_events_optimized' });
  pgm.dropIndex('mempool_txs', [], { name: 'idx_mempool_txs_optimized' });

  pgm.createIndex(
    'principal_stx_txs', 
    [
      'principal',
      // @ts-ignore
      { name: 'block_height', order: 'DESC' },
      // @ts-ignore
      { name: 'microblock_sequence', order: 'DESC' },
      // @ts-ignore
      { name: 'tx_index', order: 'DESC' }],
    {
      name: 'idx_principal_stx_txs_optimized',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'ft_events', 
    [
      'sender',
      'recipient',
      // @ts-ignore
      { name: 'block_height', order: 'DESC' },
      // @ts-ignore
      { name: 'microblock_sequence', order: 'DESC' },
      // @ts-ignore
      { name: 'tx_index', order: 'DESC' },
      // @ts-ignore
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
      // @ts-ignore
      { name: 'block_height', order: 'DESC' },
      // @ts-ignore
      { name: 'microblock_sequence', order: 'DESC' },
      // @ts-ignore
      { name: 'tx_index', order: 'DESC' },
      // @ts-ignore
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
      // @ts-ignore
      { name: 'receipt_time', order: 'DESC' }
    ],
    {
      name: 'idx_mempool_txs_optimized',
      where: 'pruned = FALSE',
    }
  );
};
