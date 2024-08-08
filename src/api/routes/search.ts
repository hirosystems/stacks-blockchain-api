import {
  DbBlock,
  DbTx,
  DbMempoolTx,
  DbSearchResult,
  DbSearchResultWithMetadata,
} from '../../datastore/common';
import { isValidPrincipal, FoundOrNot } from '../../helpers';
import {
  getTxTypeString,
  parseDbMempoolTx,
  parseDbTx,
  searchHashWithMetadata,
} from '../controllers/db-controller';
import { has0xPrefix } from '@hirosystems/api-toolkit';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { AddressStxBalance } from '../schemas/entities/addresses';
import { Block } from '../schemas/entities/block';
import {
  AddressSearchResult,
  BlockSearchResult,
  ContractSearchResult,
  MempoolTxSearchResult,
  SearchResult,
  SearchResultSchema,
  TxSearchResult,
} from '../schemas/entities/search';

enum SearchResultType {
  TxId = 'tx_id',
  MempoolTxId = 'mempool_tx_id',
  BlockHash = 'block_hash',
  StandardAddress = 'standard_address',
  ContractAddress = 'contract_address',
  UnknownHash = 'unknown_hash',
  InvalidTerm = 'invalid_term',
}

export const SearchRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const performSearch = async (
    term: string,
    includeMetadata: boolean
  ): Promise<
    | { found: true; result: SearchResult }
    | { found: false; result: { entity_type: SearchResultType }; error: string }
  > => {
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
      let queryResult: FoundOrNot<DbSearchResult> | FoundOrNot<DbSearchResultWithMetadata> = {
        found: false,
      };
      if (!includeMetadata) {
        queryResult = await fastify.db.searchHash({ hash });
      } else {
        queryResult = await searchHashWithMetadata(hash, fastify.db);
      }
      if (queryResult.found) {
        if (queryResult.result.entity_type === 'block_hash' && queryResult.result.entity_data) {
          if (includeMetadata) {
            const blockData = queryResult.result.entity_data as Block;
            const blockResult: BlockSearchResult = {
              entity_id: queryResult.result.entity_id,
              entity_type: SearchResultType.BlockHash,
              block_data: {
                canonical: blockData.canonical,
                hash: blockData.hash,
                parent_block_hash: blockData.parent_block_hash,
                burn_block_time: blockData.burn_block_time,
                height: blockData.height,
              },
              metadata: blockData,
            };
            return { found: true, result: blockResult };
          }
          const blockData = queryResult.result.entity_data as DbBlock;
          const blockResult: BlockSearchResult = {
            entity_id: queryResult.result.entity_id,
            entity_type: SearchResultType.BlockHash,
            block_data: {
              canonical: blockData.canonical,
              hash: blockData.block_hash,
              parent_block_hash: blockData.parent_block_hash,
              burn_block_time: blockData.burn_block_time,
              height: blockData.block_height,
            },
          };
          return { found: true, result: blockResult };
        } else if (queryResult.result.entity_type === 'tx_id') {
          const txData = queryResult.result.entity_data as DbTx;
          const txResult: TxSearchResult = {
            entity_id: queryResult.result.entity_id,
            entity_type: SearchResultType.TxId,
            tx_data: {
              canonical: txData.canonical,
              block_hash: txData.block_hash,
              burn_block_time: txData.burn_block_time,
              block_height: txData.block_height,
              tx_type: getTxTypeString(txData.type_id),
            },
          };
          if (includeMetadata) {
            txResult.metadata = parseDbTx(txData);
          }
          return { found: true, result: txResult };
        } else if (queryResult.result.entity_type === 'mempool_tx_id') {
          const txData = queryResult.result.entity_data as DbMempoolTx;
          const txResult: MempoolTxSearchResult = {
            entity_id: queryResult.result.entity_id,
            entity_type: SearchResultType.MempoolTxId,
            tx_data: {
              tx_type: getTxTypeString(txData.type_id),
            },
          };
          if (includeMetadata) {
            txResult.metadata = parseDbMempoolTx(txData);
          }
          return { found: true, result: txResult };
        } else {
          throw new Error(
            `Unexpected entity_type from db search result: ${queryResult.result.entity_type}`
          );
        }
      } else {
        return {
          found: false,
          result: {
            entity_type: SearchResultType.UnknownHash,
          },
          error: `No block or transaction found with hash "${hash}"`,
        };
      }
    }

    // Check if term is an account or contract principal address, e.g.:
    //   `ST3DQ94YDRH07GRKTCNN5FTW962ACVADVJZD7GSK3`
    //   `ST2TJRHDHMYBQ417HFB0BDX430TQA5PXRX6495G1V.contract-name`
    const principalCheck = isValidPrincipal(term);
    if (principalCheck) {
      const principalResult = await fastify.db.searchPrincipal({ principal: term });
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
            };
            if (includeMetadata) {
              contractResult.metadata = parseDbTx(txData);
            }
            return { found: true, result: contractResult };
          } else {
            // Associated tx is a mempool tx
            const txData = principalResult.result.entity_data as DbMempoolTx;
            const contractResult: ContractSearchResult = {
              entity_id: principalResult.result.entity_id,
              entity_type: entityType,
              tx_data: {
                tx_type: getTxTypeString(txData.type_id),
                tx_id: txData.tx_id,
              },
            };
            if (includeMetadata) {
              contractResult.metadata = parseDbMempoolTx(txData);
            }
            return { found: true, result: contractResult };
          }
        } else if (entityType === SearchResultType.ContractAddress) {
          // Contract has no associated tx.
          // TODO: Can a non-materialized contract principal be an asset transfer recipient?
          const addrResult: ContractSearchResult = {
            entity_id: principalResult.result.entity_id,
            entity_type: entityType,
          };
          return { found: true, result: addrResult };
        }
        const addrResult: AddressSearchResult = {
          entity_id: principalResult.result.entity_id,
          entity_type: entityType,
        };
        if (includeMetadata) {
          const currentBlockHeight = await fastify.db.getCurrentBlockHeight();
          if (!currentBlockHeight.found) {
            throw new Error('No current block');
          }

          const blockHeight = currentBlockHeight.result + 1;

          const stxBalanceResult = await fastify.db.getStxBalanceAtBlock(
            principalResult.result.entity_id,
            blockHeight
          );
          const result: AddressStxBalance = {
            balance: stxBalanceResult.balance.toString(),
            total_sent: stxBalanceResult.totalSent.toString(),
            total_received: stxBalanceResult.totalReceived.toString(),
            total_fees_sent: stxBalanceResult.totalFeesSent.toString(),
            total_miner_rewards_received: stxBalanceResult.totalMinerRewardsReceived.toString(),
            lock_tx_id: stxBalanceResult.lockTxId,
            locked: stxBalanceResult.locked.toString(),
            lock_height: stxBalanceResult.lockHeight,
            burnchain_lock_height: stxBalanceResult.burnchainLockHeight,
            burnchain_unlock_height: stxBalanceResult.burnchainUnlockHeight,
          };
          addrResult.metadata = result;
        }
        return { found: true, result: addrResult };
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

  fastify.get(
    '/:id',
    {
      schema: {
        operationId: 'search_by_id',
        summary: 'Search',
        description: `Search blocks, transactions, contracts, or accounts by hash/ID`,
        tags: ['Search'],
        params: Type.Object({
          id: Type.String({
            description:
              'The hex hash string for a block or transaction, account address, or contract address',
            examples: ['0xcf8b233f19f6c07d2dc1963302d2436efd36e9afac127bf6582824a13961c06d'],
          }),
        }),
        querystring: Type.Object({
          include_metadata: Type.Optional(
            Type.Boolean({
              description: 'This includes the detailed data for purticular hash in the response',
              default: false,
            })
          ),
        }),
        response: {
          200: Type.Object({
            found: Type.Literal(true),
            result: SearchResultSchema,
          }),
          404: Type.Object({
            found: Type.Literal(false),
            result: Type.Object({
              entity_type: Type.Enum(SearchResultType),
            }),
            error: Type.String(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id: rawTerm } = req.params;
      const includeMetadata = req.query.include_metadata ?? false;
      const term = rawTerm.trim();
      const searchResult = await fastify.db.sqlTransaction(async sql => {
        return await performSearch(term, includeMetadata);
      });
      if (searchResult.found) {
        await reply.send(searchResult);
      } else {
        await reply.status(404).send(searchResult);
      }
    }
  );

  await Promise.resolve();
};
