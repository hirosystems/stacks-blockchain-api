import {
  TokenTransactionEventType,
  TransactionEvent,
} from '../../schemas/v3/entities/transaction-events.js';
import { DbTransactionEvent } from '../../../datastore/v3/types.js';
import { DbAssetEventTypeId, DbEventTypeId } from 'src/datastore/common.js';
import { decodeClarityValueToRepr } from '@stacks/codec';

function serializeDbAssetEventTypeId(
  asset_event_type_id: DbAssetEventTypeId
): TokenTransactionEventType {
  switch (asset_event_type_id) {
    case DbAssetEventTypeId.Transfer:
      return 'transfer';
    case DbAssetEventTypeId.Mint:
      return 'mint';
    case DbAssetEventTypeId.Burn:
      return 'burn';
  }
}

/**
 * Serializes a database transaction event into a transaction event.
 * @param event - The database transaction event to serialize.
 * @returns The serialized transaction event.
 */
export function serializeDbTransactionEvent(event: DbTransactionEvent): TransactionEvent {
  switch (event.event_type_id) {
    case DbEventTypeId.SmartContractLog: {
      return {
        event_index: event.event_index,
        type: 'contract_log',
        contract_log: {
          contract_id: event.contract_identifier!,
          topic: 'print',
          value: {
            hex: event.value!,
            repr: decodeClarityValueToRepr(event.value!),
          },
        },
      };
    }
    case DbEventTypeId.StxAsset: {
      return {
        event_index: event.event_index,
        type: 'stx_asset',
        stx_asset: {
          type: serializeDbAssetEventTypeId(event.asset_event_type_id),
          sender: event.sender!,
          recipient: event.recipient!,
          amount: event.amount,
          memo: event.memo
            ? {
                hex: event.memo,
                repr: decodeClarityValueToRepr(event.memo),
              }
            : null,
        },
      };
    }
    case DbEventTypeId.FungibleTokenAsset: {
      return {
        event_index: event.event_index,
        type: 'ft_asset',
        ft_asset: {
          type: serializeDbAssetEventTypeId(event.asset_event_type_id),
          asset_identifier: event.asset_identifier!,
          sender: event.sender!,
          recipient: event.recipient!,
          amount: event.amount,
        },
      };
    }
    case DbEventTypeId.NonFungibleTokenAsset: {
      return {
        event_index: event.event_index,
        type: 'nft_asset',
        nft_asset: {
          type: serializeDbAssetEventTypeId(event.asset_event_type_id),
          asset_identifier: event.asset_identifier!,
          sender: event.sender!,
          recipient: event.recipient!,
          value: {
            hex: event.value!,
            repr: decodeClarityValueToRepr(event.value!),
          },
        },
      };
    }
    case DbEventTypeId.StxLock: {
      return {
        event_index: event.event_index,
        type: 'stx_lock',
        stx_lock: {
          amount: event.amount,
          unlock_bitcoin_height: event.unlock_height!,
          address: event.sender!,
        },
      };
    }
    default: {
      throw new Error(`Unexpected event_type_id in: ${JSON.stringify(event)}`);
    }
  }
}
