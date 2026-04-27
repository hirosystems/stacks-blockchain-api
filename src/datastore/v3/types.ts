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
