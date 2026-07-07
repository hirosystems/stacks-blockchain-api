import {
  PrincipalBalanceChange,
  PrincipalTransactionBalanceChange,
} from '../../schemas/v3/entities/principal-balance-changes.js';
import { DbPrincipalTransactionBalanceChange } from '../../../datastore/v3/types.js';
import { DbAssetType } from '../../../datastore/common.js';

function serializeAssetType(type: DbAssetType): 'stx' | 'ft' | 'nft' {
  switch (type) {
    case DbAssetType.Stx:
      return 'stx';
    case DbAssetType.Ft:
      return 'ft';
    case DbAssetType.Nft:
      return 'nft';
    default:
      throw new Error(`Unexpected DbAssetType: ${type}`);
  }
}

/**
 * Parses a database principal transaction balance change into a principal transaction balance
 * change.
 * @param change - The database principal transaction balance change to parse.
 * @returns The parsed principal transaction balance change.
 */
export function serializePrincipalTransactionBalanceChange(
  change: DbPrincipalTransactionBalanceChange
): PrincipalTransactionBalanceChange {
  const assetType = serializeAssetType(change.asset_type);
  return {
    asset:
      assetType === 'stx'
        ? {
            type: 'stx',
          }
        : {
            type: assetType,
            identifier: change.asset_identifier,
          },
    balance_change: {
      sent: change.sent,
      received: change.received,
      net: change.net,
    },
  };
}

/**
 * Parses a database principal transaction balance change into a principal balance change
 * (the flattened batch shape that carries `tx_id` alongside the asset and balance fields).
 * @param change - The database principal transaction balance change to parse.
 * @returns The parsed principal balance change.
 */
export function serializePrincipalBalanceChange(
  change: DbPrincipalTransactionBalanceChange
): PrincipalBalanceChange {
  return {
    tx_id: change.tx_id,
    ...serializePrincipalTransactionBalanceChange(change),
  };
}
