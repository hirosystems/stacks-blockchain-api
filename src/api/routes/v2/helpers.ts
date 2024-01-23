import { BurnBlock, NakamotoBlock, SmartContractsStatusResponse } from 'docs/generated';
import { DbBlock, DbBurnBlock, DbSmartContractStatus } from '../../../datastore/common';
import { unixEpochToIso } from '../../../helpers';
import { SmartContractStatusParams } from './schemas';
import { getTxStatusString } from '../../../api/controllers/db-controller';

export function parseDbNakamotoBlock(block: DbBlock): NakamotoBlock {
  const apiBlock: NakamotoBlock = {
    canonical: block.canonical,
    height: block.block_height,
    hash: block.block_hash,
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
  };
  return burnBlock;
}

export function parseDbSmartContractStatusArray(
  params: SmartContractStatusParams,
  status: DbSmartContractStatus[]
): SmartContractsStatusResponse {
  const ids = new Set(
    Array.isArray(params.contract_id) ? params.contract_id : [params.contract_id]
  );
  const response: SmartContractsStatusResponse = {};
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
