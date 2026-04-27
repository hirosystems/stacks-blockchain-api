import { DbTxStatus, DbTxTypeId } from '../common.js';

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
  tenure_height: number;
  burn_block_height: number;
  burn_block_time: number;
  canonical: boolean;
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
