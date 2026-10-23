import { DbSearchHit } from '../../../datastore/v3/types.js';
import { SearchResult } from '../../schemas/v3/entities/search.js';
import { serializeDbBitcoinBlockSummary, serializeDbBlockSummary } from './blocks.js';
import { serializeDbSmartContract } from './smart-contracts.js';
import { serializeDbTransactionSummary } from './transactions.js';

/**
 * Serializes a database search hit into a search result entity.
 * @param hit - The database search hit.
 * @returns The serialized search result.
 */
export function serializeDbSearchHit(hit: DbSearchHit): SearchResult {
  switch (hit.type) {
    case 'block':
      return { type: 'block', result: serializeDbBlockSummary(hit.result) };
    case 'bitcoin_block':
      return { type: 'bitcoin_block', result: serializeDbBitcoinBlockSummary(hit.result) };
    case 'transaction':
      return { type: 'transaction', result: serializeDbTransactionSummary(hit.result) };
    case 'address':
      return { type: 'address', result: { principal: hit.result.principal } };
    case 'smart_contract':
      return { type: 'smart_contract', result: serializeDbSmartContract(hit.result) };
    case 'token': {
      // Asset identifiers are `<contract-id>::<asset-name>`; both halves are given separately so
      // callers do not have to split the identifier themselves.
      const separator = hit.result.asset_identifier.indexOf('::');
      return {
        type: 'token',
        result: {
          asset_identifier: hit.result.asset_identifier,
          asset_type: hit.result.asset_type,
          contract_id: hit.result.asset_identifier.slice(0, separator),
          asset_name: hit.result.asset_identifier.slice(separator + 2),
        },
      };
    }
  }
}
