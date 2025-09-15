/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('txs', {
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
    stx_lock_event_count: {
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
    contract_log_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
};
