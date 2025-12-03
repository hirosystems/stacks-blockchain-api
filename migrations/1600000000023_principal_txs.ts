import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('principal_txs', {
    principal: {
      type: 'string',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    stx_balance_affected: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    ft_balance_affected: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    nft_balance_affected: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    stx_sent: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
    stx_received: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
    stx_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    stx_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    stx_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });

  pgm.createIndex('principal_txs', 'tx_id');
  pgm.createIndex(
    'principal_txs',
    [
      { name: 'principal' },
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
    ],
    {
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.addConstraint(
    'principal_txs',
    'principal_txs_unique',
    `UNIQUE(principal, tx_id, index_block_hash, microblock_hash)`
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('principal_txs');
}

