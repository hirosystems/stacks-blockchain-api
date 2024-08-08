import { Static, Type } from '@sinclair/typebox';
import { TransactionSchema } from './transactions';
import { OptionalNullable } from '../util';

const NonFungibleTokenValueSchema = Type.Object(
  {
    hex: Type.String({
      description: 'Hex string representing the identifier of the Non-Fungible Token',
    }),
    repr: Type.String({
      description: 'Readable string of the Non-Fungible Token identifier',
    }),
  },
  {
    description: 'Non-Fungible Token value',
  }
);

export const NonFungibleTokenHoldingWithTxIdSchema = Type.Object(
  {
    asset_identifier: Type.String(),
    value: NonFungibleTokenValueSchema,
    block_height: Type.Integer(),
    tx_id: Type.String(),
  },
  {
    title: 'NonFungibleTokenHoldingWithTxId',
    description: 'Ownership of a Non-Fungible Token',
  }
);

export const NonFungibleTokenHoldingWithTxMetadataSchema = Type.Object(
  {
    asset_identifier: Type.String(),
    value: NonFungibleTokenValueSchema,
    block_height: Type.Integer(),
    tx: TransactionSchema,
  },
  {
    title: 'NonFungibleTokenHoldingWithTxMetadata',
    description: 'Ownership of a Non-Fungible Token with transaction metadata',
  }
);

export const NonFungibleTokenHistoryEventWithTxIdSchema = Type.Object(
  {
    sender: OptionalNullable(Type.String()),
    recipient: Type.Optional(Type.String()),
    event_index: Type.Integer(),
    asset_event_type: Type.String(),
    tx_id: Type.String(),
  },
  {
    title: 'NonFungibleTokenHistoryEventWithTxId',
    description: 'Non-Fungible Token history event with transaction id',
  }
);

export const NonFungibleTokenHistoryEventWithTxMetadataSchema = Type.Object(
  {
    sender: OptionalNullable(Type.String()),
    recipient: Type.Optional(Type.String()),
    event_index: Type.Integer(),
    asset_event_type: Type.String(),
    tx: TransactionSchema,
  },
  {
    title: 'NonFungibleTokenHistoryEventWithTxMetadata',
    description: 'Non-Fungible Token history event with transaction metadata',
  }
);

export const NonFungibleTokenMintWithTxIdSchema = Type.Object(
  {
    recipient: Type.Optional(Type.String()),
    event_index: Type.Integer(),
    value: NonFungibleTokenValueSchema,
    tx_id: Type.String(),
  },
  {
    title: 'NonFungibleTokenMintWithTxId',
    description: 'Non-Fungible Token mint event with transaction id',
  }
);
type NonFungibleTokenMintWithTxId = Static<typeof NonFungibleTokenMintWithTxIdSchema>;

export const NonFungibleTokenMintWithTxMetadataSchema = Type.Object({
  recipient: Type.Optional(Type.String()),
  event_index: Type.Integer(),
  value: NonFungibleTokenValueSchema,
  tx: TransactionSchema,
});
