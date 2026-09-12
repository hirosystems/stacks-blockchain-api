import {
  DbAssetEventTypeId,
  DbBondLockupType,
  DbAssetType,
  DbEventTypeId,
  DbTxStatus,
  DbTxTypeId,
} from '../common.js';

export type DbCursorPaginatedResult<T> = {
  limit: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  current_cursor: string | null;
  total: number;
  results: T[];
};

export interface DbTxLocation {
  tx_id: string;
  tx_index: number;
  block_height: number;
  block_hash: string;
  block_time: number;
  burn_block_height: number;
  burn_block_time: number;
  index_block_hash: string;
  parent_block_hash: string;
  parent_index_block_hash: string;
  microblock_hash: string;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
}

export interface DbTransactionSummary extends DbTxLocation {
  sender_address: string;
  nonce: number;
  sponsor_address: string | null;
  sponsor_nonce: number | null;
  fee_rate: string;
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

export type DbStxTransferDirection = 'inbound' | 'outbound';

export interface DbPrincipalStxTransfer {
  /** Null for mint events (STX credited from no sender). */
  sender: string | null;
  /** Null for burn events (STX debited to no recipient). */
  recipient: string | null;
  amount: string;
  /** `0x`-prefixed raw memo bytes, or null when the transfer carries no memo. */
  memo: string | null;
  /**
   * `0x`-prefixed Clarity-serialized print value of the paired `send-many-memo` event (a Clarity
   * buffer wrapping the memo bytes), or null when this is not a bulk-send leg. Takes precedence
   * over `memo`.
   */
  bulk_send_memo: string | null;
  tx_id: string;
  block_height: number;
  block_hash: string;
  block_time: number;
  index_block_hash: string;
  microblock_sequence: number;
  tx_index: number;
  event_index: number;
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

export interface DbTransactionEvent {
  event_index: number;
  amount: string;
  event_type_id: DbEventTypeId;
  asset_event_type_id: DbAssetEventTypeId;
  sender: string | null;
  recipient: string | null;
  asset_identifier: string | null;
  contract_identifier: string | null;
  topic: string | null;
  value: string | null;
  memo: string | null;
  unlock_height: number | null;
}

export interface DbBondSummary {
  bond_index: number;
  target_rate: number;
  stx_value_ratio: number;
  min_ustx_ratio: number;
  first_reward_cycle: number;
  bond_start_height: number;
  unlock_cycle: number;
  unlock_burn_height: number;
  btc_capacity: string;
  btc_locked: string;
  stx_locked: string;
  btc_paid_out: string;
  allowed_count: number;
  registered_count: number;
}

export interface DbBond extends DbBondSummary, DbTxLocation {
  early_unlock_bytes: string;
  early_unlock_admin: string | null;
}

export interface DbBondAllowlistEntry {
  staker: string;
  max_sats: string;
}

/**
 * One bond-scoped row from `pox5_events`: the synthetic event name plus its raw decoded payload
 * (`data`, which always carries a non-null `bond_index`) at its canonical chain position.
 */
export interface DbBondEvent {
  name: string;
  /** The event's decoded payload, verbatim from the synthetic print event. */
  data: Record<string, unknown>;
  tx_id: string;
  event_index: number;
  tx_index: number;
  block_height: number;
  block_hash: string;
  block_time: number;
  index_block_hash: string;
  microblock_sequence: number;
  burn_block_height: number;
  burn_block_time: number;
}

export interface DbBondLockupTx {
  /** Reversed (big-endian) txid as a `0x`-prefixed hex string. */
  txid: string;
  /** String-quoted unsigned integer. */
  output_index: string;
}

export interface DbBondRegistrationSummary {
  signer: string;
  staker: string;
  amount_ustx: string;
  sats_total: string;
  btc_lockup_type: DbBondLockupType;
}

export interface DbBondRegistration extends DbBondRegistrationSummary {
  tx_id: string;
  btc_lockup_txs: DbBondLockupTx[] | null;
}

export interface DbPrincipalBondPosition {
  bond_index: number;
  /** `DbPrincipalBondPositionStatus` stored as a smallint. */
  status: number;
  active: boolean;
  btc_locked: string;
  stx_locked: string;
  btc_paid_out: string;
  accrued_rewards: string;
  claimed_rewards: string;
  tx_id: string;
}

/** A principal's pox-5 STX-staking position: locked uSTX plus running sBTC reward totals. */
export interface DbPrincipalStxStaking {
  /** Current uSTX locked in pox-5 STX staking. */
  locked: string;
  accrued_rewards: string;
  claimed_rewards: string;
}

/** Aggregate of a principal's bond positions (counts + summed locks/rewards). */
export interface DbPrincipalBondStakingAggregate {
  count: number;
  btc_locked: string;
  stx_locked: string;
  accrued_rewards: string;
  claimed_rewards: string;
}

/** One-call staking overview: the STX-staking position plus the bond aggregate. */
export interface DbPrincipalStakingSummary {
  stx: DbPrincipalStxStaking;
  bonds: DbPrincipalBondStakingAggregate;
}

export interface DbTransactionCursor {
  block_height: number;
  microblock_sequence: number;
  tx_index: number;
}

export interface DbStakingRewards {
  /** Total staking rewards generated, in satoshis. */
  reward_amount: string;
  /** Total BTC burned by block commits, in satoshis. */
  burn_amount: string;
}

export interface DbStakingSigner {
  signer: string;
  /** The registered compressed secp256k1 public key as a `0x`-prefixed hex string. */
  signer_key: string;
  tx_id: string;
  block_height: number;
  burn_block_height: number;
}

/** A signer joined with the block position of its registration transaction. */
export interface DbStakingSignerDetail extends DbStakingSigner {
  block_hash: string;
  index_block_hash: string;
  block_time: number;
  tx_index: number;
  burn_block_time: number;
}

/** A live `grant-signer-key` authorization held by a signer manager. */
export interface DbSignerKeyGrant {
  /** The granted signing key as a `0x`-prefixed hex string. */
  signer_key: string;
  /** The grant's auth id as a decimal string. */
  auth_id: string;
  /** The grant event's tx id as a `0x`-prefixed hex string. */
  tx_id: string;
}

export interface DbCycleSignerManager {
  signer_manager: string;
  /** Block position of the `register-signer` event that bound this key. */
  block_height: number;
  burn_block_height: number;
  /** The registration tx id as a `0x`-prefixed hex string. */
  tx_id: string;
  /** The manager's live key grants (authorizations that may later be registered). */
  granted_keys: DbSignerKeyGrant[];
  /**
   * The manager's latest key registered after the cycle's anchor block, when it differs from the
   * cycle's signing key (i.e. a pending key rotation).
   */
  pending_signer_key: string | null;
  /** The tx of the pending key registration; set iff `pending_signer_key` is set. */
  pending_tx_id: string | null;
}

/** A reward-set signer for a PoX cycle, with its effective signer manager bindings. */
export interface DbCycleSigner {
  /** The signing key in the cycle's reward set, as a `0x`-prefixed hex string. */
  signing_key: string;
  weight: number;
  stacked_amount: string;
  weight_percent: number;
  stacked_amount_percent: number;
  signer_managers: DbCycleSignerManager[];
}

/** A staker that belongs to a signer, with the staking type(s) it participates in. */
export interface DbSignerStaker {
  staker: string;
  /** True if the staker has an active pox-5 STX stake under this signer. */
  stx: boolean;
  /** True if the staker has a bond registration under this signer. */
  bond: boolean;
}

export interface DbPrincipalFtBalance {
  /** The fungible token asset identifier (the `ft_balances.token` column). */
  token: string;
  balance: string;
}

export interface DbPrincipalFtTransfer {
  /** Null for mint events (tokens credited from no sender). */
  sender: string | null;
  /** Null for burn events (tokens debited to no recipient). */
  recipient: string | null;
  amount: string;
  tx_id: string;
  block_height: number;
  block_hash: string;
  block_time: number;
  index_block_hash: string;
  microblock_sequence: number;
  tx_index: number;
  event_index: number;
}

export interface DbNftHistoryEvent {
  /** Null for mint events. */
  sender: string | null;
  /** Null for burn events. */
  recipient: string | null;
  tx_id: string;
  block_height: number;
  block_hash: string;
  block_time: number;
  index_block_hash: string;
  microblock_sequence: number;
  tx_index: number;
  event_index: number;
}

export interface DbFtHolder {
  /** The holder's principal (the `ft_balances.address` column). */
  principal: string;
  balance: string;
}

export interface DbPrincipalNftBalance {
  asset_identifier: string;
  /** The NFT instance value (Clarity value) as a `0x`-prefixed hex string. */
  value: string;
}

/**
 * A successfully deployed smart contract, with the block position of its deployment transaction.
 * `source_code` is only selected when the caller opts into it.
 */
export interface DbSmartContractDetail {
  contract_id: string;
  /**
   * Declared by a versioned deploy, otherwise the version the node resolved from the deploy epoch
   * and reported in the contract interface. Null only when it could not be recovered from that
   * interface, i.e. a chainstate predating the point where the node began reporting it.
   */
  clarity_version: number | null;
  tx_id: string;
  block_height: number;
  block_hash: string;
  index_block_hash: string;
  block_time: number;
  tx_index: number;
  burn_block_height: number;
  burn_block_time: number;
  source_code?: string;
}
