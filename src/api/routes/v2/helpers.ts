import {
  DbAddressTransactionEvent,
  DbBlock,
  DbBurnBlock,
  DbEventTypeId,
  DbPoxCycle,
  DbPoxCycleSigner,
  DbPoxCycleSignerStacker,
  DbSmartContractStatus,
  DbTxWithAddressTransfers,
} from '../../../datastore/common';
import { unixEpochToIso } from '../../../helpers';
import { SmartContractStatusParams } from './schemas';
import {
  getAssetEventTypeString,
  getTxStatusString,
  parseDbTx,
} from '../../../api/controllers/db-controller';
import { decodeClarityValueToRepr } from 'stacks-encoding-native-js';
import { TransactionVersion, getAddressFromPublicKey } from '@stacks/transactions';
import { SmartContractStatusList } from '../../schemas/entities/smart-contracts';
import { AddressTransaction, AddressTransactionEvent } from '../../schemas/entities/addresses';
import { NakamotoBlock } from '../../schemas/entities/block';
import { BurnBlock } from '../../schemas/entities/burn-blocks';
import { PoxCycle, PoxSigner, PoxStacker } from '../../schemas/entities/pox';

export function parseDbNakamotoBlock(block: DbBlock): NakamotoBlock {
  const apiBlock: NakamotoBlock = {
    canonical: block.canonical,
    height: block.block_height,
    hash: block.block_hash,
    block_time: block.block_time,
    block_time_iso: unixEpochToIso(block.block_time),
    // If `tenure_height` is not available, but `signer_bitvec` is set we can safely assume it's same as `block_height` (epoch2.x rules)
    tenure_height: block.tenure_height ?? (block.signer_bitvec ? -1 : block.block_height),
    index_block_hash: block.index_block_hash,
    parent_block_hash: block.parent_block_hash,
    parent_index_block_hash: block.parent_index_block_hash,
    burn_block_time: block.burn_block_time,
    burn_block_time_iso: unixEpochToIso(block.burn_block_time),
    burn_block_hash: block.burn_block_hash,
    burn_block_height: block.burn_block_height,
    miner_txid: block.miner_txid,
    tx_count: block.tx_count,
    execution_cost_read_count: block.execution_cost_read_count,
    execution_cost_read_length: block.execution_cost_read_length,
    execution_cost_runtime: block.execution_cost_runtime,
    execution_cost_write_count: block.execution_cost_write_count,
    execution_cost_write_length: block.execution_cost_write_length,
  };
  return apiBlock;
}

export function parseDbBurnBlock(block: DbBurnBlock): BurnBlock {
  const burnBlock: BurnBlock = {
    burn_block_time: block.burn_block_time,
    burn_block_time_iso: unixEpochToIso(block.burn_block_time),
    burn_block_hash: block.burn_block_hash,
    burn_block_height: block.burn_block_height,
    stacks_blocks: block.stacks_blocks,
    avg_block_time: parseFloat(parseFloat(block.avg_block_time ?? '0').toFixed(2)),
    total_tx_count: parseInt(block.total_tx_count),
  };
  return burnBlock;
}

export function parseDbSmartContractStatusArray(
  params: SmartContractStatusParams,
  status: DbSmartContractStatus[]
): SmartContractStatusList {
  const ids = new Set(
    Array.isArray(params.contract_id) ? params.contract_id : [params.contract_id]
  );
  const response: SmartContractStatusList = {};
  for (const s of status) {
    ids.delete(s.smart_contract_contract_id);
    response[s.smart_contract_contract_id] = {
      found: true,
      result: {
        contract_id: s.smart_contract_contract_id,
        block_height: s.block_height,
        status: getTxStatusString(s.status),
        tx_id: s.tx_id,
      },
    };
  }
  for (const missingId of ids) response[missingId] = { found: false };
  return response;
}

export function parseDbTxWithAccountTransferSummary(
  tx: DbTxWithAddressTransfers
): AddressTransaction {
  return {
    tx: parseDbTx(tx),
    stx_sent: tx.stx_sent.toString(),
    stx_received: tx.stx_received.toString(),
    events: {
      stx: {
        transfer: tx.stx_transfer,
        mint: tx.stx_mint,
        burn: tx.stx_burn,
      },
      ft: {
        transfer: tx.ft_transfer,
        mint: tx.ft_mint,
        burn: tx.ft_burn,
      },
      nft: {
        transfer: tx.nft_transfer,
        mint: tx.nft_mint,
        burn: tx.nft_burn,
      },
    },
  };
}

export function parseDbAddressTransactionTransfer(
  transfer: DbAddressTransactionEvent
): AddressTransactionEvent {
  switch (transfer.event_type_id) {
    case DbEventTypeId.FungibleTokenAsset:
      return {
        type: 'ft',
        event_index: transfer.event_index,
        data: {
          type: getAssetEventTypeString(transfer.asset_event_type_id),
          amount: transfer.amount,
          asset_identifier: transfer.asset_identifier ?? '',
          sender: transfer.sender ?? undefined,
          recipient: transfer.recipient ?? undefined,
        },
      };
    case DbEventTypeId.NonFungibleTokenAsset:
      return {
        type: 'nft',
        event_index: transfer.event_index,
        data: {
          type: getAssetEventTypeString(transfer.asset_event_type_id),
          asset_identifier: transfer.asset_identifier ?? '',
          value: {
            hex: transfer.value ?? '',
            repr: decodeClarityValueToRepr(transfer.value ?? ''),
          },
          sender: transfer.sender ?? undefined,
          recipient: transfer.recipient ?? undefined,
        },
      };
    case DbEventTypeId.StxAsset:
      return {
        type: 'stx',
        event_index: transfer.event_index,
        data: {
          type: getAssetEventTypeString(transfer.asset_event_type_id),
          amount: transfer.amount,
          sender: transfer.sender ?? undefined,
          recipient: transfer.recipient ?? undefined,
        },
      };
  }
  throw Error('Invalid address transaction transfer');
}

export function parseDbPoxCycle(cycle: DbPoxCycle): PoxCycle {
  const result: PoxCycle = {
    block_height: cycle.block_height,
    index_block_hash: cycle.index_block_hash,
    cycle_number: cycle.cycle_number,
    total_weight: cycle.total_weight,
    total_stacked_amount: cycle.total_stacked_amount,
    total_signers: cycle.total_signers,
  };
  return result;
}

export function parseDbPoxSigner(signer: DbPoxCycleSigner, isMainnet: boolean): PoxSigner {
  const signerAddress = getAddressFromPublicKey(
    Buffer.from(signer.signing_key.slice(2), 'hex'),
    isMainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
  );
  const result: PoxSigner = {
    signing_key: signer.signing_key,
    signer_address: signerAddress,
    weight: signer.weight,
    stacked_amount: signer.stacked_amount,
    weight_percent: signer.weight_percent,
    stacked_amount_percent: signer.stacked_amount_percent,
    pooled_stacker_count: signer.pooled_stacker_count,
    solo_stacker_count: signer.solo_stacker_count,
  };
  return result;
}

export function parseDbPoxSignerStacker(stacker: DbPoxCycleSignerStacker): PoxStacker {
  const result: PoxStacker = {
    stacker_address: stacker.stacker,
    stacked_amount: stacker.locked,
    pox_address: stacker.pox_addr,
    stacker_type: stacker.stacker_type,
  };
  // Special handling for pool operator stackers
  if (
    stacker.name === 'stack-aggregation-commit-indexed' ||
    stacker.name === 'stack-aggregation-commit'
  ) {
    result.stacked_amount = stacker.amount_ustx;
  }
  return result;
}
