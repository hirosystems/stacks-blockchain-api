import { Static, Type } from '@sinclair/typebox';
import { AddressStxBalanceSchema } from './addresses';
import { BlockSchema } from './block';
import { MempoolTransactionSchema, TransactionSchema } from './transactions';

const AddressSearchResultSchema = Type.Object(
  {
    entity_id: Type.String({ description: 'The id used to search this query.' }),
    entity_type: Type.Literal('standard_address'),
    metadata: Type.Optional(AddressStxBalanceSchema),
  },
  { title: 'AddressSearchResult', description: 'Address search result' }
);
export type AddressSearchResult = Static<typeof AddressSearchResultSchema>;

const BlockSearchResultSchema = Type.Object(
  {
    entity_id: Type.String({ description: 'The id used to search this query.' }),
    entity_type: Type.Literal('block_hash'),
    block_data: Type.Object({
      canonical: Type.Boolean(),
      hash: Type.String(),
      parent_block_hash: Type.String(),
      burn_block_time: Type.Integer(),
      height: Type.Integer(),
    }),
    metadata: Type.Optional(BlockSchema),
  },
  { title: 'BlockSearchResult', description: 'Block search result' }
);
export type BlockSearchResult = Static<typeof BlockSearchResultSchema>;

const ContractSearchResultSchema = Type.Object(
  {
    entity_id: Type.String({ description: 'The id used to search this query.' }),
    entity_type: Type.Literal('contract_address'),
    tx_data: Type.Optional(
      Type.Object({
        canonical: Type.Optional(Type.Boolean()),
        block_hash: Type.Optional(Type.String()),
        burn_block_time: Type.Optional(Type.Integer()),
        block_height: Type.Optional(Type.Integer()),
        tx_type: Type.String(),
        tx_id: Type.String(),
      })
    ),
    metadata: Type.Optional(Type.Union([TransactionSchema, MempoolTransactionSchema])),
  },
  { title: 'ContractSearchResult', description: 'Contract search result' }
);
export type ContractSearchResult = Static<typeof ContractSearchResultSchema>;

const MempoolTxSearchResultSchema = Type.Object(
  {
    entity_id: Type.String({ description: 'The id used to search this query.' }),
    entity_type: Type.Literal('mempool_tx_id'),
    tx_data: Type.Object({
      tx_type: Type.String(),
    }),
    metadata: Type.Optional(MempoolTransactionSchema),
  },
  { title: 'MempoolTxSearchResult', description: 'Mempool transaction search result' }
);
export type MempoolTxSearchResult = Static<typeof MempoolTxSearchResultSchema>;

const TxSearchResultSchema = Type.Object(
  {
    entity_id: Type.String({ description: 'The id used to search this query.' }),
    entity_type: Type.Literal('tx_id'),
    tx_data: Type.Object({
      canonical: Type.Boolean(),
      block_hash: Type.String(),
      burn_block_time: Type.Integer(),
      block_height: Type.Integer(),
      tx_type: Type.String(),
    }),
    metadata: Type.Optional(TransactionSchema),
  },
  { title: 'TxSearchResult', description: 'Transaction search result' }
);
export type TxSearchResult = Static<typeof TxSearchResultSchema>;

export const SearchResultSchema = Type.Union([
  AddressSearchResultSchema,
  BlockSearchResultSchema,
  ContractSearchResultSchema,
  MempoolTxSearchResultSchema,
  TxSearchResultSchema,
]);
export type SearchResult = Static<typeof SearchResultSchema>;
