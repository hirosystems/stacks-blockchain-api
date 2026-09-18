import { Static, Type } from '@sinclair/typebox';
import {
  AddressSchema,
  AssetIdentifierSchema,
  BlockHashSchema,
  BlockHeightSchema,
  SmartContractIdSchema,
} from './common.js';
import { SmartContractSchema } from './smart-contracts.js';
import { TransactionSummarySchema } from './transaction-summaries.js';

export const SearchEntityTypeSchema = Type.Union(
  [
    Type.Literal('block'),
    Type.Literal('bitcoin_block'),
    Type.Literal('transaction'),
    Type.Literal('address'),
    Type.Literal('smart_contract'),
    Type.Literal('token'),
  ],
  {
    title: 'SearchEntityType',
    description: 'The kind of entity a search result refers to',
  }
);
export type SearchEntityType = Static<typeof SearchEntityTypeSchema>;

export const BlockSummarySchema = Type.Object(
  {
    height: BlockHeightSchema,
    hash: BlockHashSchema,
    index_hash: Type.String({
      description: 'Index block hash of the block',
    }),
    time: Type.Number({
      description: 'Unix timestamp (in seconds) indicating when this block was mined.',
    }),
  },
  { title: 'BlockSummary' }
);
export type BlockSummary = Static<typeof BlockSummarySchema>;

export const BitcoinBlockSummarySchema = Type.Object(
  {
    height: Type.Integer({
      description: 'Height of the Bitcoin block',
    }),
    hash: Type.String({
      description: 'Hash of the Bitcoin block',
    }),
  },
  { title: 'BitcoinBlockSummary' }
);
export type BitcoinBlockSummary = Static<typeof BitcoinBlockSummarySchema>;

export const AddressSummarySchema = Type.Object(
  {
    principal: AddressSchema,
  },
  { title: 'AddressSummary' }
);
export type AddressSummary = Static<typeof AddressSummarySchema>;

export const TokenAssetSchema = Type.Object(
  {
    asset_identifier: AssetIdentifierSchema,
    asset_type: Type.Union([Type.Literal('ft'), Type.Literal('nft')], {
      description: 'Whether the asset is a fungible or non-fungible token',
    }),
    contract_id: SmartContractIdSchema,
    asset_name: Type.String({
      description:
        'The name the asset is declared with on-chain. This is the identifier from the ' +
        "contract's token definition, not the display name or symbol the contract reports " +
        'through `get-name` and `get-symbol`.',
      examples: ['diko'],
    }),
  },
  { title: 'TokenAsset' }
);
export type TokenAsset = Static<typeof TokenAssetSchema>;

/**
 * A single search result, tagged with the kind of entity it refers to. Results carry no indication
 * of how closely they matched: match quality decides their order and nothing more.
 */
export const SearchResultSchema = Type.Union(
  [
    Type.Object(
      { type: Type.Literal('block'), result: BlockSummarySchema },
      { title: 'BlockSearchResult' }
    ),
    Type.Object(
      { type: Type.Literal('bitcoin_block'), result: BitcoinBlockSummarySchema },
      { title: 'BitcoinBlockSearchResult' }
    ),
    Type.Object(
      { type: Type.Literal('transaction'), result: TransactionSummarySchema },
      { title: 'TransactionSearchResult' }
    ),
    Type.Object(
      { type: Type.Literal('address'), result: AddressSummarySchema },
      { title: 'AddressSearchResult' }
    ),
    Type.Object(
      { type: Type.Literal('smart_contract'), result: SmartContractSchema },
      { title: 'SmartContractSearchResult' }
    ),
    Type.Object(
      { type: Type.Literal('token'), result: TokenAssetSchema },
      { title: 'TokenSearchResult' }
    ),
  ],
  { title: 'SearchResult' }
);
export type SearchResult = Static<typeof SearchResultSchema>;
