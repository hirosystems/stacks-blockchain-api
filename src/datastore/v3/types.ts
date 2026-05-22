import { DbTxStatus, DbTxTypeId } from '../common.js';

export type DbCursorPaginatedResult<T> = {
  limit: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  current_cursor: string | null;
  total: number;
  results: T[];
};

export interface DbTransactionSummary {
  tx_id: string;
  sender_address: string;
  nonce: number;
  sponsor_address: string | null;
  sponsor_nonce: number | null;
  fee_rate: string;
  block_height: number;
  block_hash: string;
  index_block_hash: string;
  block_time: number;
  tx_index: number;
  burn_block_height: number;
  burn_block_time: number;
  status: DbTxStatus;
  type_id: DbTxTypeId;
  token_transfer_recipient_address: string | null;
  token_transfer_amount: string | null;
  token_transfer_memo: string | null;
  smart_contract_clarity_version: number | null;
  smart_contract_contract_id: string | null;
  contract_call_contract_id: string | null;
  contract_call_function_name: string | null;
  coinbase_alt_recipient: string | null;
  tenure_change_cause: number | null;
}

export interface DbTransaction extends DbTransactionSummary {
  parent_block_hash: string;
  parent_index_block_hash: string;
  post_conditions: string;
  event_count: number;
  execution_cost_read_count: number;
  execution_cost_read_length: number;
  execution_cost_runtime: number;
  execution_cost_write_count: number;
  execution_cost_write_length: number;
  vm_error: string | null;
  raw_result: string;
  smart_contract_source_code: string | null;
  contract_call_function_args: string | null;
  coinbase_payload: string | null;
  coinbase_vrf_proof: string | null;
  tenure_change_tenure_consensus_hash: string | null;
  tenure_change_prev_tenure_consensus_hash: string | null;
  tenure_change_burn_view_consensus_hash: string | null;
  tenure_change_previous_tenure_end: string | null;
  tenure_change_previous_tenure_blocks: number | null;
  tenure_change_pubkey_hash: string | null;
}

export type DbPrincipalTransactionInvolvement = 'sender' | 'sponsor' | 'affected';

export interface DbPrincipalTransactionSummary extends DbTransactionSummary {
  stx_sent: string;
  stx_received: string;
  stx_net: string;
  stx_balance_affected: boolean;
  ft_balance_affected: boolean;
  nft_balance_affected: boolean;
  involvement: DbPrincipalTransactionInvolvement;
}

export interface DbMempoolTransactionSummary {
  tx_id: string;
  type_id: DbTxTypeId;
  status: DbTxStatus;
  sender_address: string;
  nonce: number;
  sponsor_address: string | null;
  sponsor_nonce: number | null;
  fee_rate: string;
  receipt_time: number;
  receipt_block_height: number;
  token_transfer_recipient_address: string | null;
  token_transfer_amount: string | null;
  token_transfer_memo: string | null;
  smart_contract_clarity_version: number | null;
  smart_contract_contract_id: string | null;
  contract_call_contract_id: string | null;
  contract_call_function_name: string | null;
  coinbase_alt_recipient: string | null;
  tenure_change_cause: number | null;
}

export interface DbMempoolTransaction extends DbMempoolTransactionSummary {
  post_conditions: string;
  replaced_by_tx_id: string | null;
  smart_contract_source_code: string | null;
  contract_call_function_args: string | null;
  coinbase_payload: string | null;
  coinbase_vrf_proof: string | null;
  tenure_change_tenure_consensus_hash: string | null;
  tenure_change_prev_tenure_consensus_hash: string | null;
  tenure_change_burn_view_consensus_hash: string | null;
  tenure_change_previous_tenure_end: string | null;
  tenure_change_previous_tenure_blocks: number | null;
  tenure_change_pubkey_hash: string | null;
}
