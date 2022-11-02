import { InvalidRequestError, InvalidRequestErrorType } from '../errors';

export function parsePagingQueryInput(val: any) {
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val !== 'string') {
    throw new InvalidRequestError(
      'Input must be either typeof `string` or `number`',
      InvalidRequestErrorType.invalid_query
    );
  }
  if (!/^\d+$/.test(val)) {
    throw new InvalidRequestError(
      '`limit` and `offset` must be integers',
      InvalidRequestErrorType.invalid_query
    );
  }
  const parsedInput = parseInt(val, 10);
  if (isNaN(parsedInput))
    throw new InvalidRequestError(
      'Pagination value parsed as NaN',
      InvalidRequestErrorType.invalid_query
    );
  return parsedInput;
}

// const MAX_BLOCKS_PER_REQUEST = 30;
// const DEFAULT_BLOCKS_PER_REQUEST = 20;

// const MAX_BLOCKS_PER_REQUEST_BURNCHAIN = 250;

// const MAX_TX_PER_REQUEST = 50;
// const DEFAULT_TX_PER_REQUEST = 20;

// const MAX_ASSETS_PER_REQUEST = 50;
// const MAX_STX_INBOUND_PER_REQUEST = 500;
// const MAX_CONTRACT_EVENTS_PER_REQUEST = 50;
// const MAX_MICROBLOCKS_PER_REQUEST = 200;
// const MAX_TXS_PER_REQUEST = 200;
// const MAX_MEMPOOL_TXS_PER_REQUEST = 200;
// const MAX_TX_EVENTS_PER_REQUEST = 200;
// const MAX_TOKENS_PER_REQUEST = 200;

// const pagedApiRoutes = [
//   '/block',
//   '/address/:principal/transactions',
//   '/address/:stx_address/assets',
//   '/address/:stx_address/nft_events',
//   '/address/:stx_address/transactions_with_transfers',
//   '/address/:address/mempool',
//   '/address/:stx_address/stx_inbound',
//   '/burnchain/reward_slot_holders',
//   '/burnchain/reward_slot_holders/:address',
//   '/burnchain/rewards',
//   '/burnchain/rewards/:address',
//   '/contract/by_trait',
//   '/contract/:contract_id/events',
//   '/microblock',
//   '/tx',
//   '/tx/mempool/dropped',
//   '/tx/mempool',
//   '/tx/multiple',
//   '/tx/events',
//   '/tx/:tx_id',
//   '/tx/block/:block_hash',
//   '/tx/block_height/:height',
//   '/tokens/nft/holdings',
//   '/tokens/nft/history',
//   '/tokens/nft/mints',
//   '/tokens/ft/metadata',
//   '/tokens/nft/metadata',
// ] as const;

// type PagedApiRoutes = typeof pagedApiRoutes[number];

// const pagingQueryLimits: Record<PagedApiRoutes, { defaultLimit: number; maxLimit: number }> = {
//   '/block': {
//     defaultLimit: 20,
//     maxLimit: MAX_BLOCKS_PER_REQUEST,
//   },
//   '/address/:principal/transactions': {
//     defaultLimit: 20,
//     maxLimit: MAX_TX_PER_REQUEST,
//   },
//   '/address/:stx_address/assets': {
//     defaultLimit: 20,
//     maxLimit: MAX_ASSETS_PER_REQUEST,
//   },
//   '/address/:stx_address/nft_events': {
//     defaultLimit: 20,
//     maxLimit: MAX_ASSETS_PER_REQUEST,
//   },
//   '/address/:stx_address/transactions_with_transfers': {
//     defaultLimit: 20,
//     maxLimit: MAX_TX_PER_REQUEST,
//   },
//   '/address/:address/mempool': {
//     defaultLimit: MAX_TX_PER_REQUEST,
//     maxLimit: MAX_TX_PER_REQUEST,
//   },
//   '/address/:stx_address/stx_inbound': {
//     defaultLimit: 20,
//     maxLimit: MAX_STX_INBOUND_PER_REQUEST,
//   },
//   '/burnchain/reward_slot_holders': {
//     defaultLimit: 96,
//     maxLimit: MAX_BLOCKS_PER_REQUEST_BURNCHAIN,
//   },
//   '/burnchain/reward_slot_holders/:address': {
//     defaultLimit: 96,
//     maxLimit: MAX_BLOCKS_PER_REQUEST_BURNCHAIN,
//   },
//   '/burnchain/rewards': {
//     defaultLimit: 96,
//     maxLimit: MAX_BLOCKS_PER_REQUEST_BURNCHAIN,
//   },
//   '/burnchain/rewards/:address': {
//     defaultLimit: 96,
//     maxLimit: MAX_BLOCKS_PER_REQUEST_BURNCHAIN,
//   },
//   '/contract/by_trait': {
//     defaultLimit: 20,
//     maxLimit: MAX_CONTRACT_EVENTS_PER_REQUEST,
//   },
//   '/contract/:contract_id/events': {
//     defaultLimit: 20,
//     maxLimit: MAX_CONTRACT_EVENTS_PER_REQUEST,
//   },
//   '/microblock': {
//     defaultLimit: 20,
//     maxLimit: MAX_MICROBLOCKS_PER_REQUEST,
//   },
//   '/tx': {
//     defaultLimit: 96,
//     maxLimit: MAX_TXS_PER_REQUEST,
//   },
//   '/tx/mempool/dropped': {
//     defaultLimit: 96,
//     maxLimit: MAX_TXS_PER_REQUEST,
//   },
//   '/tx/mempool': {
//     defaultLimit: 96,
//     maxLimit: MAX_MEMPOOL_TXS_PER_REQUEST,
//   },
//   '/tx/multiple': {
//     defaultLimit: 96,
//     maxLimit: MAX_TX_EVENTS_PER_REQUEST,
//   },
//   '/tx/events': {
//     defaultLimit: 96,
//     maxLimit: MAX_TX_EVENTS_PER_REQUEST,
//   },
//   '/tx/:tx_id': {
//     defaultLimit: 96,
//     maxLimit: MAX_TX_EVENTS_PER_REQUEST,
//   },
//   '/tx/block/:block_hash': {
//     defaultLimit: 96,
//     maxLimit: MAX_TX_EVENTS_PER_REQUEST,
//   },
//   '/tx/block_height/:height': {
//     defaultLimit: 96,
//     maxLimit: MAX_TX_EVENTS_PER_REQUEST,
//   },
//   '/tokens/nft/holdings': {
//     defaultLimit: 50,
//     maxLimit: MAX_TOKENS_PER_REQUEST,
//   },
//   '/tokens/nft/history': {
//     defaultLimit: 50,
//     maxLimit: MAX_TOKENS_PER_REQUEST,
//   },
//   '/tokens/nft/mints': {
//     defaultLimit: 50,
//     maxLimit: MAX_TOKENS_PER_REQUEST,
//   },
//   '/tokens/ft/metadata': {
//     defaultLimit: 96,
//     maxLimit: MAX_TOKENS_PER_REQUEST,
//   },
//   '/tokens/nft/metadata': {
//     defaultLimit: 96,
//     maxLimit: MAX_TOKENS_PER_REQUEST,
//   },
// };

export enum ResourceType {
  Block,
  Tx,
  Event,
  Burnchain,
  Contract,
  Microblock,
  Token,
}

const pagingQueryLimits: Record<ResourceType, { defaultLimit: number; maxLimit: number }> = {
  [ResourceType.Block]: {
    defaultLimit: 20,
    maxLimit: 30,
  },
  // '/block'
  [ResourceType.Tx]: {
    defaultLimit: 20,
    maxLimit: 50,
  },
  // '/address/:principal/transactions'
  // '/address/:stx_address/transactions_with_transfers'
  //'/address/:address/mempool'
  // '/address/:address/mempool'
  // '/address/:stx_address/stx_inbound'
  // '/tx'
  // '/tx/mempool/dropped'
  // '/tx/mempool'
  // '/tx/multiple'
  // '/tx/events'
  // '/tx/:tx_id'
  // '/tx/block/:block_hash'
  // '/tx/block_height/:height'
  // '/tx/mempool'
  [ResourceType.Event]: {
    defaultLimit: 20,
    maxLimit: 50,
  },
  // '/address/:stx_address/assets' 20/50
  // '/address/:stx_address/nft_events' 20/50 Deprecated
  [ResourceType.Burnchain]: {
    defaultLimit: 96,
    maxLimit: 250,
  },
  // '/burnchain/reward_slot_holders'
  // '/burnchain/reward_slot_holders/:address'
  // '/burnchain/rewards'
  // '/burnchain/rewards/:address'
  [ResourceType.Contract]: {
    defaultLimit: 20,
    maxLimit: 50,
  },
  // '/contract/by_trait'
  // '/contract/:contract_id/events'
  [ResourceType.Microblock]: {
    defaultLimit: 20,
    maxLimit: 200,
  },
  //'/microblock': {
  [ResourceType.Token]: {
    defaultLimit: 50,
    maxLimit: 200,
  },
  // '/tokens/nft/holdings'
  // '/tokens/nft/history'
  // '/tokens/nft/mints'
  // '/tokens/ft/metadata'
  // '/tokens/nft/metadata'
};

export function getPagingQueryLimit(resourceType: ResourceType, limitOverride?: any) {
  const pagingQueryLimit = pagingQueryLimits[resourceType];
  if (!limitOverride) {
    return pagingQueryLimit.defaultLimit;
  }
  const newLimit = parsePagingQueryInput(limitOverride);
  if (newLimit > pagingQueryLimit.maxLimit) {
    throw new InvalidRequestError(
      `'limit' must be equal to or less than ${pagingQueryLimit.maxLimit}`,
      InvalidRequestErrorType.invalid_query
    );
  }
  return newLimit;
}
