import { DbMempoolTransaction, DbMempoolTransactionSummary } from '../../../datastore/v3/types.js';
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
import {
  BaseMempoolTransaction,
  CoinbaseMempoolTransaction,
  ContractCallMempoolTransaction,
  MempoolTransaction,
  PoisonMicroblockMempoolTransaction,
  SmartContractMempoolTransaction,
  TenureChangeMempoolTransaction,
  TokenTransferMempoolTransaction,
} from '../../schemas/v3/entities/mempool-transactions.js';
import { TransactionIncludeField } from '../../schemas/v3/entities/transactions.js';
import { serializePostCondition } from './post-conditions.js';
import { decodeClarityValueList, decodePostConditions } from '@stacks/codec';

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

/**
 * Parses a database mempool transaction into a mempool transaction.
 * @param transaction - The database mempool transaction to parse.
 * @param include - Heavy fields to populate. Omitted fields skip their decode entirely
 *   (clarity-value parsing, post-condition decode) so callers pay nothing for what they
 *   don't ask for.
 * @returns The parsed mempool transaction.
 */
export function serializeDbMempoolTransaction(
  transaction: DbMempoolTransaction,
  include?: readonly TransactionIncludeField[]
): MempoolTransaction {
  const summary = serializeDbMempoolTransactionSummary(transaction);
  const result: BaseMempoolTransaction = {
    ...summary,
    replaced_by_tx_id: transaction.replaced_by_tx_id,
  };
  if (include?.includes('post_conditions')) {
    result.post_conditions = decodePostConditions(transaction.post_conditions).post_conditions.map(
      pc => serializePostCondition(pc)
    );
  }
  switch (transaction.type_id) {
    case DbTxTypeId.TokenTransfer: {
      const tokenTransfer: TokenTransferMempoolTransaction = {
        ...result,
        type: 'token_transfer',
        token_transfer: {
          recipient: transaction.token_transfer_recipient_address!,
          amount: transaction.token_transfer_amount!,
          memo: transaction.token_transfer_memo,
        },
      };
      return tokenTransfer;
    }
    case DbTxTypeId.SmartContract: {
      const smartContract: SmartContractMempoolTransaction = {
        ...result,
        type: 'smart_contract',
        smart_contract: {
          clarity_version: transaction.smart_contract_clarity_version,
          contract_id: transaction.smart_contract_contract_id!,
          ...(include?.includes('source_code')
            ? { source_code: transaction.smart_contract_source_code! }
            : {}),
        },
      };
      return smartContract;
    }
    case DbTxTypeId.ContractCall: {
      const contractCall: ContractCallMempoolTransaction = {
        ...result,
        type: 'contract_call',
        contract_call: {
          contract_id: transaction.contract_call_contract_id!,
          function_name: transaction.contract_call_function_name!,
          ...(include?.includes('function_args')
            ? {
                function_args: decodeClarityValueList(transaction.contract_call_function_args!).map(
                  c => ({ hex: c.hex, repr: c.repr })
                ),
              }
            : {}),
        },
      };
      return contractCall;
    }
    case DbTxTypeId.PoisonMicroblock: {
      const poisonMicroblock: PoisonMicroblockMempoolTransaction = {
        ...result,
        type: 'poison_microblock',
      };
      return poisonMicroblock;
    }
    case DbTxTypeId.Coinbase: {
      const coinbase: CoinbaseMempoolTransaction = {
        ...result,
        type: 'coinbase',
      };
      return coinbase;
    }
    case DbTxTypeId.TenureChange: {
      const tenureChange: TenureChangeMempoolTransaction = {
        ...result,
        type: 'tenure_change',
      };
      return tenureChange;
    }
    default:
      throw new Error(`Unexpected DbTxTypeId: ${transaction.type_id}`);
  }
}
