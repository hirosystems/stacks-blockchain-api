import {
  BaseTransactionSummary,
  CoinbaseTransactionSummary,
  ContractCallTransactionSummary,
  PoisonMicroblockTransactionSummary,
  SmartContractTransactionSummary,
  TenureChangeTransactionSummary,
  TokenTransferTransactionSummary,
  TransactionSummary,
  TransactionSummaryStatus,
} from '../../schemas/entities/transaction-summaries.js';
import { DbTransactionSummary } from '../../../datastore/v3/types.js';
import { DbTxStatus, DbTxTypeId } from '../../../datastore/common.js';
import { getTxTenureChangeCauseString } from '../../controllers/db-controller.js';

function parseDbTransactionSummaryStatus(status: DbTxStatus): TransactionSummaryStatus {
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
      tenure_height: summary.tenure_height,
    },
    burn_block: {
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
