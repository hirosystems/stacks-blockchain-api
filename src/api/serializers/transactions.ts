import {
  BaseTransactionSummary,
  CoinbaseTransactionSummary,
  ContractCallTransactionSummary,
  PoisonMicroblockTransactionSummary,
  SmartContractTransactionSummary,
  TenureChangeTransactionSummary,
  TokenTransferTransactionSummary,
  TransactionSummary,
  TransactionStatus,
} from '../schemas/v3/entities/transaction-summaries.js';
import {
  DbPrincipalTransactionBalanceChange,
  DbPrincipalTransactionSummary,
  DbTransactionSummary,
} from '../../datastore/v3/types.js';
import { DbAssetType, DbTxStatus, DbTxTypeId } from '../../datastore/common.js';
import { getTxTenureChangeCauseString } from '../controllers/db-controller.js';
import { PrincipalTransactionSummary } from '../schemas/v3/entities/principal-transactions.js';
import {
  PrincipalBalanceChange,
  PrincipalTransactionBalanceChange,
} from '../schemas/v3/entities/principal-balance-changes.js';

/**
 * Parses a database transaction summary status into a transaction summary status.
 * @param status - The database transaction status.
 * @returns The parsed transaction summary status.
 */
function serializeDbTransactionSummaryStatus(status: DbTxStatus): TransactionStatus {
  switch (status) {
    case DbTxStatus.AbortByResponse:
      return 'abort_by_response';
    case DbTxStatus.AbortByPostCondition:
      return 'abort_by_post_condition';
    case DbTxStatus.Success:
      return 'success';
    default:
      throw new Error(`Unexpected DbTxStatus: ${status}`);
  }
}

/**
 * Parses a database transaction summary into a transaction summary.
 * @param summary - The database transaction summary to parse.
 * @returns The parsed transaction summary.
 */
export function serializeDbTransactionSummary(summary: DbTransactionSummary): TransactionSummary {
  const result: BaseTransactionSummary = {
    tx_id: summary.tx_id,
    sender: {
      address: summary.sender_address,
      nonce: summary.nonce,
    },
    sponsor:
      summary.sponsor_address !== null && summary.sponsor_nonce !== null
        ? {
            address: summary.sponsor_address,
            nonce: summary.sponsor_nonce,
          }
        : null,
    fee_rate: summary.fee_rate,
    block: {
      height: summary.block_height,
      hash: summary.block_hash,
      index_hash: summary.index_block_hash,
      time: summary.block_time,
      tx_index: summary.tx_index,
    },
    bitcoin_block: {
      height: summary.burn_block_height,
      time: summary.burn_block_time,
    },
    status: serializeDbTransactionSummaryStatus(summary.status),
  };
  switch (summary.type_id) {
    case DbTxTypeId.TokenTransfer: {
      const tokenTransfer: TokenTransferTransactionSummary = {
        ...result,
        type: 'token_transfer',
        token_transfer: {
          recipient: summary.token_transfer_recipient_address!,
          amount: summary.token_transfer_amount!,
          memo: summary.token_transfer_memo,
        },
      };
      return tokenTransfer;
    }
    case DbTxTypeId.SmartContract: {
      const smartContract: SmartContractTransactionSummary = {
        ...result,
        type: 'smart_contract',
        smart_contract: {
          clarity_version: summary.smart_contract_clarity_version,
          contract_id: summary.smart_contract_contract_id!,
        },
      };
      return smartContract;
    }
    case DbTxTypeId.ContractCall: {
      const contractCall: ContractCallTransactionSummary = {
        ...result,
        type: 'contract_call',
        contract_call: {
          contract_id: summary.contract_call_contract_id!,
          function_name: summary.contract_call_function_name!,
        },
      };
      return contractCall;
    }
    case DbTxTypeId.PoisonMicroblock: {
      const poisonMicroblock: PoisonMicroblockTransactionSummary = {
        ...result,
        type: 'poison_microblock',
      };
      return poisonMicroblock;
    }
    case DbTxTypeId.Coinbase: {
      const coinbase: CoinbaseTransactionSummary = {
        ...result,
        type: 'coinbase',
        coinbase: {
          alt_recipient: summary.coinbase_alt_recipient,
        },
      };
      return coinbase;
    }
    case DbTxTypeId.TenureChange: {
      const tenureChange: TenureChangeTransactionSummary = {
        ...result,
        type: 'tenure_change',
        tenure_change: {
          cause: getTxTenureChangeCauseString(summary.tenure_change_cause!),
        },
      };
      return tenureChange;
    }
    default:
      throw new Error(`Unexpected DbTxTypeId: ${summary.type_id}`);
  }
}

/**
 * Parses a database principal transaction summary into a principal transaction summary.
 * @param summary - The database principal transaction summary to parse.
 * @returns The parsed principal transaction summary.
 */
export function serializePrincipalTransactionSummary(
  summary: DbPrincipalTransactionSummary
): PrincipalTransactionSummary {
  return {
    transaction: serializeDbTransactionSummary(summary),
    involvement: summary.involvement,
    balance_changes: {
      stx: {
        sent: summary.stx_sent,
        received: summary.stx_received,
        net: summary.stx_net,
      },
    },
    affected_balances: {
      stx: summary.stx_balance_affected,
      ft: summary.ft_balance_affected,
      nft: summary.nft_balance_affected,
    },
  };
}

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
