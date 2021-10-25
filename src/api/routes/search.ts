import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore, DbBlock, DbTx, DbMempoolTx } from '../../datastore/common';
import { isValidPrincipal, has0xPrefix } from '../../helpers';
import {
  Transaction,
  Block,
  SearchResult,
  BlockSearchResult,
  TxSearchResult,
  MempoolTxSearchResult,
  ContractSearchResult,
  AddressSearchResult,
  SearchErrorResult,
} from '@stacks/stacks-blockchain-api-types';
import { getTxTypeString } from '../controllers/db-controller';
import { address } from 'bitcoinjs-lib';

const enum SearchResultType {
  TxId = 'tx_id',
  MempoolTxId = 'mempool_tx_id',
  BlockHash = 'block_hash',
  StandardAddress = 'standard_address',
  ContractAddress = 'contract_address',
  UnknownHash = 'unknown_hash',
  InvalidTerm = 'invalid_term',
}

export function createSearchRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  const performSearch = async (term: string): Promise<SearchResult> => {
    // Check if term is a 32-byte hash, e.g.:
    //   `0x4ac9b89ec7f2a0ca3b4399888904f171d7bdf3460b1c63ea86c28a83c2feaad8`
    //   `4ac9b89ec7f2a0ca3b4399888904f171d7bdf3460b1c63ea86c28a83c2feaad8`
    let hashBuffer: Buffer | undefined;
    if (term.length === 66 && has0xPrefix(term)) {
      hashBuffer = Buffer.from(term.slice(2), 'hex');
    } else if (term.length === 64) {
      hashBuffer = Buffer.from(term, 'hex');
    }
    if (hashBuffer !== undefined && hashBuffer.length === 32) {
      const hash = '0x' + hashBuffer.toString('hex');
      const queryResult = await db.searchHash({ hash });
      if (queryResult.found) {
        if (queryResult.result.entity_type === 'block_hash') {
          const blockData = queryResult.result.entity_data as DbBlock;
          const blockResult: BlockSearchResult = {
            found: true,
            result: {
              entity_id: queryResult.result.entity_id,
              entity_type: SearchResultType.BlockHash,
              block_data: {
                canonical: blockData.canonical,
                hash: blockData.block_hash,
                parent_block_hash: blockData.parent_block_hash,
                burn_block_time: blockData.burn_block_time,
                height: blockData.block_height,
              },
            },
          };
          return blockResult;
        } else if (queryResult.result.entity_type === 'tx_id') {
          const txData = queryResult.result.entity_data as DbTx;
          const txResult: TxSearchResult = {
            found: true,
            result: {
              entity_id: queryResult.result.entity_id,
              entity_type: SearchResultType.TxId,
              tx_data: {
                canonical: txData.canonical,
                block_hash: txData.block_hash,
                burn_block_time: txData.burn_block_time,
                block_height: txData.block_height,
                tx_type: getTxTypeString(txData.type_id),
              },
            },
          };
          return txResult;
        } else if (queryResult.result.entity_type === 'mempool_tx_id') {
          const txData = queryResult.result.entity_data as DbMempoolTx;
          const txResult: MempoolTxSearchResult = {
            found: true,
            result: {
              entity_id: queryResult.result.entity_id,
              entity_type: SearchResultType.MempoolTxId,
              tx_data: {
                tx_type: getTxTypeString(txData.type_id),
              },
            },
          };
          return txResult;
        } else {
          throw new Error(
            `Unexpected entity_type from db search result: ${queryResult.result.entity_type}`
          );
        }
      } else {
        const unknownResult: SearchErrorResult = {
          found: false,
          result: {
            entity_type: SearchResultType.UnknownHash,
          },
          error: `No block or transaction found with hash "${hash}"`,
        };
        return unknownResult;
      }
    }

    // Check if term is an account or contract principal address, e.g.:
    //   `ST3DQ94YDRH07GRKTCNN5FTW962ACVADVJZD7GSK3`
    //   `ST2TJRHDHMYBQ417HFB0BDX430TQA5PXRX6495G1V.contract-name`
    const principalCheck = isValidPrincipal(term);
    if (principalCheck) {
      const principalResult = await db.searchPrincipal({ principal: term });
      const entityType =
        principalCheck.type === 'contractAddress'
          ? SearchResultType.ContractAddress
          : SearchResultType.StandardAddress;

      if (principalResult.found) {
        // Check if the contract has an associated tx
        if (entityType === SearchResultType.ContractAddress && principalResult.result.entity_data) {
          // Check if associated tx is mined (non-mempool)
          if ((principalResult.result.entity_data as DbTx).block_hash) {
            const txData = principalResult.result.entity_data as DbTx;
            const contractResult: ContractSearchResult = {
              found: true,
              result: {
                entity_id: principalResult.result.entity_id,
                entity_type: entityType,
                tx_data: {
                  canonical: txData.canonical,
                  block_hash: txData.block_hash,
                  burn_block_time: txData.burn_block_time,
                  block_height: txData.block_height,
                  tx_type: getTxTypeString(txData.type_id),
                  tx_id: txData.tx_id,
                },
              },
            };
            return contractResult;
          } else {
            // Associated tx is a mempool tx
            const txData = principalResult.result.entity_data as DbMempoolTx;
            const contractResult: ContractSearchResult = {
              found: true,
              result: {
                entity_id: principalResult.result.entity_id,
                entity_type: entityType,
                tx_data: {
                  tx_type: getTxTypeString(txData.type_id),
                  tx_id: txData.tx_id,
                },
              },
            };
            return contractResult;
          }
        } else if (entityType === SearchResultType.ContractAddress) {
          // Contract has no associated tx.
          // TODO: Can a non-materialized contract principal be an asset transfer recipient?
          const addrResult: ContractSearchResult = {
            found: true,
            result: {
              entity_id: principalResult.result.entity_id,
              entity_type: entityType,
            },
          };
          return addrResult;
        }
        const addrResult: AddressSearchResult = {
          found: true,
          result: {
            entity_id: principalResult.result.entity_id,
            entity_type: entityType,
          },
        };
        return addrResult;
      } else {
        return {
          found: false,
          result: { entity_type: entityType },
          error: `No principal found with address "${term}"`,
        };
      }
    }

    return {
      found: false,
      result: { entity_type: SearchResultType.InvalidTerm },
      error: `The term "${term}" is not a valid block hash, transaction ID, contract principal, or account address principal`,
    };
  };

  router.getAsync('/:term', async (req, res) => {
    const { term: rawTerm } = req.params;
    const term = rawTerm.trim();

    const searchResult = await performSearch(term);
    if (!searchResult.found) {
      res.status(404);
    }
    res.json(searchResult);
  });

  return router;
}
