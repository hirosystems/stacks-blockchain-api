export interface FullTxApiResponse {
  block_hash: string;
  block_height: number;

  tx_id: string;
  tx_index: number;
  tx_status: 'success' | 'pending' | 'failed';
  tx_type: 'token_transfer' | 'smart_contract' | 'contract_call' | 'poison_microblock' | 'coinbase';

  // TODO: store as array of conditions and success status
  /** Hex encoded portion of the post-conditions in the raw tx. */
  post_conditions?: string;

  /** Integer string (64-bit unsigned integer).  */
  fee_rate: string;
  sender_address: string;
  sponsored: boolean;

  /** Only valid for `token_transfer` tx types. */
  token_transfer?: {
    recipient_address: string;
    /** Integer string (64-bit unsigned integer).  */
    amount: string;
    /** Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string). */
    memo: string;
  };

  /** Only valid for `contract_call` tx types. */
  contract_call?: {
    contract_id: string;
    function_name: string;
    /** Hex encoded Clarity values. */
    function_args: string[];
  };

  /** Only valid for `smart_contract` tx types. */
  smart_contract?: {
    contract_id: string;
    source_code: string;
  };

  /** Only valid for `coinbase` tx types. */
  coinbase_payload?: {
    /** Hex encoded 32-bytes. */
    data: string;
  };

  /** Only valid for `smart_contract` and `contract_call` tx types. */
  events?: {
    event_index: number;
    event_type: 'smart_contract_log' | 'stx_asset' | 'fungible_token_asset' | 'non_fungible_token_asset';
    /** Not valid for `smart_contract_log` event types.  */
    asset?: {
      asset_event_type: 'transfer' | 'mint' | 'burn';
      /** Fully qualified asset identifier. Only valid for fungible and non-fungible token events. */
      asset_id?: string;
      /** Only valid for asset transfer and burn events. */
      sender?: string;
      /** Only valid for asset transfer and mint events. */
      recipient?: string;
      /** Integer string (128-bit unsigned integer). Only valid for stx and fungible token events. */
      amount?: string;
      /** Hex string. Only valid for non-fungible token events. */
      value?: string;
    };
    /** Only valid for `smart_contract_log` event types. */
    contract_log?: {
      contract_id: string;
      topic: string;
      /** Hex encoded Clarity value. */
      value: string;
    };
  }[];
}
