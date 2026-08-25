export const BNS_DEPRECATION_NOTE = '**Deprecated:** BNS endpoints are no longer maintained.';
export const BNS_DEPRECATION_MESSAGE = 'BNS endpoints are no longer maintained.';

export const BNS_NAMES_OWNED_DEPRECATION_NOTE =
  '**Deprecated:** use `GET /extended/v3/principals/{principal}/balances/nft` instead, filtered ' +
  'to the BNS asset identifier. Note that this returns only NFT-backed names, not subdomains or ' +
  'names imported from Blockstack v1.';
export const BNS_NAMES_OWNED_DEPRECATION_MESSAGE =
  'Use /extended/v3/principals/{principal}/balances/nft filtered to the BNS asset identifier. ' +
  'Subdomains and Blockstack v1 imported names are not included there.';
