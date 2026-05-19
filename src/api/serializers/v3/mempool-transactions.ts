import { DbMempoolTransactionSummary } from '../../../datastore/v3/types.js';
import { DbTxStatus, DbTxTypeId } from '../../../datastore/common.js';
import {
  BaseMempoolTransactionSummary,
  CoinbaseMempoolTransactionSummary,
  ContractCallMempoolTransactionSummary,
  MempoolTransactionStatus,
  MempoolTransactionSummary,
  PoisonMicroblockMempoolTransactionSummary,
  SmartContractMempoolTransactionSummary,
  TenureChangeMempoolTransactionSummary,
  TokenTransferMempoolTransactionSummary,
} from '../../schemas/v3/entities/mempool-transaction-summaries.js';

/**
 * Parses a database mempool transaction summary status into a mempool transaction summary status.
 * @param status - The database mempool transaction status.
 * @returns The parsed mempool transaction status.
 */
function serializeDbMempoolTransactionStatus(status: DbTxStatus): MempoolTransactionStatus {
  switch (status) {
    case DbTxStatus.Pending:
      return 'pending';
    case DbTxStatus.DroppedReplaceByFee:
      return 'dropped_replace_by_fee';
    case DbTxStatus.DroppedReplaceAcrossFork:
      return 'dropped_replace_across_fork';
    case DbTxStatus.DroppedTooExpensive:
      return 'dropped_too_expensive';
    case DbTxStatus.DroppedStaleGarbageCollect:
      return 'dropped_stale_garbage_collect';
    case DbTxStatus.DroppedProblematic:
      return 'dropped_problematic';
    default:
      throw new Error(`Unexpected DbTxStatus: ${status}`);
  }
}

/**
 * Parses a database mempool transaction summary into a mempool transaction summary.
 * @param summary - The database mempool transaction summary to parse.
 * @returns The parsed mempool transaction summary.
 */
export function serializeDbMempoolTransactionSummary(
  summary: DbMempoolTransactionSummary
): MempoolTransactionSummary {
  const result: BaseMempoolTransactionSummary = {
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
    receipt_time: summary.receipt_time,
    receipt_block_height: summary.receipt_block_height,
    status: serializeDbMempoolTransactionStatus(summary.status),
  };
  switch (summary.type_id) {
    case DbTxTypeId.TokenTransfer: {
      const tokenTransfer: TokenTransferMempoolTransactionSummary = {
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
      const smartContract: SmartContractMempoolTransactionSummary = {
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
      const contractCall: ContractCallMempoolTransactionSummary = {
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
      const poisonMicroblock: PoisonMicroblockMempoolTransactionSummary = {
        ...result,
        type: 'poison_microblock',
      };
      return poisonMicroblock;
    }
    case DbTxTypeId.Coinbase: {
      const coinbase: CoinbaseMempoolTransactionSummary = {
        ...result,
        type: 'coinbase',
      };
      return coinbase;
    }
    case DbTxTypeId.TenureChange: {
      const tenureChange: TenureChangeMempoolTransactionSummary = {
        ...result,
        type: 'tenure_change',
      };
      return tenureChange;
    }
    default:
      throw new Error(`Unexpected DbTxTypeId: ${summary.type_id}`);
  }
}
