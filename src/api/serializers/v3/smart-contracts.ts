import { DbSmartContractDetail } from '../../../datastore/v3/types.js';
import { SmartContract } from '../../schemas/v3/entities/smart-contracts.js';

/**
 * Serializes a database smart contract into a smart contract response entity. `source_code` is
 * only present on the database row when the caller opted into it, so its presence here mirrors
 * the requested `include` fields.
 * @param contract - The database smart contract.
 * @returns The serialized smart contract.
 */
export function serializeDbSmartContract(contract: DbSmartContractDetail): SmartContract {
  const result: SmartContract = {
    contract_id: contract.contract_id,
    clarity_version: contract.clarity_version ?? 0,
    tx_id: contract.tx_id,
    block: {
      height: contract.block_height,
      hash: contract.block_hash,
      index_hash: contract.index_block_hash,
      time: contract.block_time,
      tx_index: contract.tx_index,
    },
    bitcoin_block: {
      height: contract.burn_block_height,
      time: contract.burn_block_time,
    },
  };
  if (contract.source_code !== undefined) {
    result.source_code = contract.source_code;
  }
  return result;
}
