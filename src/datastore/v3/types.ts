import { DbAssetType, DbTxStatus, DbTxTypeId } from '../common.js';

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

export interface DbPrincipalTransactionBalanceChange {
  principal: string;
  tx_id: string;
  block_height: number;
  index_block_hash: string;
  microblock_hash: string;
  microblock_sequence: number;
  tx_index: number;
  canonical: boolean;
  microblock_canonical: boolean;
  asset_type: DbAssetType;
  asset_identifier: string;
  sent: string;
  received: string;
  net: string;
}
