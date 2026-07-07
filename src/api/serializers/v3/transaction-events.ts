import { TransactionEvent } from '../../schemas/v3/entities/transaction-events.js';
import { DbTransactionEvent } from '../../../datastore/v3/types.js';
import { DbAssetEventTypeId, DbEventTypeId } from '../../../datastore/common.js';
import { decodeClarityValueToRepr, memoToString } from '@stacks/codec';

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
      switch (event.asset_event_type_id) {
        case DbAssetEventTypeId.Transfer: {
          return {
            event_index: event.event_index,
            type: 'stx_asset',
            stx_asset: {
              type: 'transfer',
              sender: event.sender!,
              recipient: event.recipient!,
              amount: event.amount,
              memo: event.memo
                ? {
                    hex: event.memo,
                    repr: memoToString(event.memo),
                  }
                : null,
            },
          };
        }
        case DbAssetEventTypeId.Mint: {
          return {
            event_index: event.event_index,
            type: 'stx_asset',
            stx_asset: {
              type: 'mint',
              recipient: event.recipient!,
              amount: event.amount,
            },
          };
        }
        case DbAssetEventTypeId.Burn: {
          return {
            event_index: event.event_index,
            type: 'stx_asset',
            stx_asset: {
              type: 'burn',
              sender: event.sender!,
              amount: event.amount,
            },
          };
        }
        default: {
          throw new Error(`Unexpected asset_event_type_id in: ${JSON.stringify(event)}`);
        }
      }
    }
    case DbEventTypeId.FungibleTokenAsset: {
      switch (event.asset_event_type_id) {
        case DbAssetEventTypeId.Transfer: {
          return {
            event_index: event.event_index,
            type: 'ft_asset',
            ft_asset: {
              type: 'transfer',
              asset_identifier: event.asset_identifier!,
              sender: event.sender!,
              recipient: event.recipient!,
              amount: event.amount,
            },
          };
        }
        case DbAssetEventTypeId.Mint: {
          return {
            event_index: event.event_index,
            type: 'ft_asset',
            ft_asset: {
              type: 'mint',
              recipient: event.recipient!,
              asset_identifier: event.asset_identifier!,
              amount: event.amount,
            },
          };
        }
        case DbAssetEventTypeId.Burn: {
          return {
            event_index: event.event_index,
            type: 'ft_asset',
            ft_asset: {
              type: 'burn',
              sender: event.sender!,
              asset_identifier: event.asset_identifier!,
              amount: event.amount,
            },
          };
        }
        default: {
          throw new Error(`Unexpected asset_event_type_id in: ${JSON.stringify(event)}`);
        }
      }
    }
    case DbEventTypeId.NonFungibleTokenAsset: {
      switch (event.asset_event_type_id) {
        case DbAssetEventTypeId.Transfer: {
          return {
            event_index: event.event_index,
            type: 'nft_asset',
            nft_asset: {
              type: 'transfer',
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
        case DbAssetEventTypeId.Mint: {
          return {
            event_index: event.event_index,
            type: 'nft_asset',
            nft_asset: {
              type: 'mint',
              recipient: event.recipient!,
              asset_identifier: event.asset_identifier!,
              value: {
                hex: event.value!,
                repr: decodeClarityValueToRepr(event.value!),
              },
            },
          };
        }
        case DbAssetEventTypeId.Burn: {
          return {
            event_index: event.event_index,
            type: 'nft_asset',
            nft_asset: {
              type: 'burn',
              sender: event.sender!,
              asset_identifier: event.asset_identifier!,
              value: {
                hex: event.value!,
                repr: decodeClarityValueToRepr(event.value!),
              },
            },
          };
        }
        default: {
          throw new Error(`Unexpected asset_event_type_id in: ${JSON.stringify(event)}`);
        }
      }
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
