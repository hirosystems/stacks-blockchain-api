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
  DbPrincipalTransactionSummary,
  DbTransaction,
  DbTransactionSummary,
} from '../../datastore/v3/types.js';
import { DbTxStatus, DbTxTypeId } from '../../datastore/common.js';
import { getTxTenureChangeCauseString } from '../controllers/db-controller.js';
import {
  BaseTransaction,
  CoinbaseTransaction,
  ContractCallTransaction,
  PoisonMicroblockTransaction,
  SmartContractTransaction,
  TenureChangeTransaction,
  TokenTransferTransaction,
  Transaction,
} from '../schemas/v3/entities/transactions.js';
import codec from '@stacks/codec';
import { serializePostCondition } from './post-conditions.js';
import { PrincipalTransactionSummary } from '../schemas/v3/entities/principal-transactions.js';

/**
 * Parses a database transaction summary status into a transaction summary status.
 * @param status - The database transaction status.
 * @returns The parsed transaction summary status.
 */
function parseDbTransactionSummaryStatus(status: DbTxStatus): TransactionStatus {
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
export function parseDbTransactionSummary(summary: DbTransactionSummary): TransactionSummary {
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
    canonical: summary.canonical,
    status: parseDbTransactionSummaryStatus(summary.status),
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
 * Parses a database transaction into a transaction.
 * @param transaction - The database transaction to parse.
 * @returns The parsed transaction.
 */
export function parseDbTransaction(transaction: DbTransaction): Transaction {
  const summary = parseDbTransactionSummary(transaction);
  const decodedPostConditions = codec.decodePostConditions(transaction.post_conditions);
  const result: BaseTransaction = {
    ...summary,
    parent_block: {
      hash: transaction.parent_block_hash,
      index_hash: transaction.parent_index_block_hash,
    },
    post_conditions: decodedPostConditions.post_conditions.map(pc => serializePostCondition(pc)),
    event_count: transaction.event_count,
    execution_cost: {
      read_count: transaction.execution_cost_read_count,
      read_length: transaction.execution_cost_read_length,
      runtime: transaction.execution_cost_runtime,
      write_count: transaction.execution_cost_write_count,
      write_length: transaction.execution_cost_write_length,
    },
    vm_error: transaction.vm_error,
  };
  switch (transaction.type_id) {
    case DbTxTypeId.TokenTransfer: {
      const tokenTransfer: TokenTransferTransaction = {
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
      const smartContract: SmartContractTransaction = {
        ...result,
        type: 'smart_contract',
        smart_contract: {
          clarity_version: transaction.smart_contract_clarity_version,
          contract_id: transaction.smart_contract_contract_id!,
          source_code: transaction.smart_contract_source_code!,
        },
      };
      return smartContract;
    }
    case DbTxTypeId.ContractCall: {
      const contractCall: ContractCallTransaction = {
        ...result,
        type: 'contract_call',
        contract_call: {
          contract_id: transaction.contract_call_contract_id!,
          function_name: transaction.contract_call_function_name!,
          function_args: codec
            .decodeClarityValueList(transaction.contract_call_function_args!)
            .map(c => ({
              hex: c.hex,
              repr: c.repr,
            })),
        },
      };
      return contractCall;
    }
    case DbTxTypeId.PoisonMicroblock: {
      const poisonMicroblock: PoisonMicroblockTransaction = {
        ...result,
        type: 'poison_microblock',
      };
      return poisonMicroblock;
    }
    case DbTxTypeId.Coinbase: {
      const coinbase: CoinbaseTransaction = {
        ...result,
        type: 'coinbase',
        coinbase: {
          alt_recipient: transaction.coinbase_alt_recipient,
          payload: transaction.coinbase_payload!,
          vrf_proof: transaction.coinbase_vrf_proof,
        },
      };
      return coinbase;
    }
    case DbTxTypeId.TenureChange: {
      const tenureChange: TenureChangeTransaction = {
        ...result,
        type: 'tenure_change',
        tenure_change: {
          cause: getTxTenureChangeCauseString(transaction.tenure_change_cause!),
          tenure_consensus_hash: transaction.tenure_change_tenure_consensus_hash!,
          prev_tenure_consensus_hash: transaction.tenure_change_prev_tenure_consensus_hash!,
          burn_view_consensus_hash: transaction.tenure_change_burn_view_consensus_hash!,
          previous_tenure_end: transaction.tenure_change_previous_tenure_end!,
          previous_tenure_blocks: transaction.tenure_change_previous_tenure_blocks!,
          pubkey_hash: transaction.tenure_change_pubkey_hash!,
        },
      };
      return tenureChange;
    }
    default:
      throw new Error(`Unexpected DbTxTypeId: ${transaction.type_id}`);
  }
}

/**
 * Parses a database principal transaction summary into a principal transaction summary.
 * @param summary - The database principal transaction summary to parse.
 * @returns The parsed principal transaction summary.
 */
export function parsePrincipalTransactionSummary(
  summary: DbPrincipalTransactionSummary
): PrincipalTransactionSummary {
  return {
    transaction: parseDbTransactionSummary(summary),
    balance_changes: {
      stx: {
        sent: summary.stx_sent,
        received: summary.stx_received,
      },
    },
  };
}
