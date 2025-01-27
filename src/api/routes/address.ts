import { BlockIdentifier } from '../../datastore/common';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { getBlockParams, parseUntilBlockQuery, validatePrincipal } from '../query-helpers';
import {
  formatMapToObject,
  getSendManyContract,
  isValidPrincipal,
  mapSeriesAsync,
} from '../../helpers';
import {
  getTxFromDataStore,
  parseDbEvent,
  parseDbMempoolTx,
  parseDbTx,
} from '../controllers/db-controller';
import { InvalidRequestError, InvalidRequestErrorType, NotFoundError } from '../../errors';
import { decodeClarityValueToRepr } from 'stacks-encoding-native-js';
import {
  handlePrincipalCache,
  handlePrincipalMempoolCache,
  handleTransactionCache,
} from '../controllers/cache-controller';
import { PgStore } from '../../datastore/pg-store';
import { logger } from '../../logger';
import { has0xPrefix } from '@hirosystems/api-toolkit';

import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import {
  LimitParam,
  OffsetParam,
  PrincipalSchema,
  UnanchoredParamSchema,
  UntilBlockSchema,
} from '../schemas/params';
import {
  AddressBalance,
  AddressBalanceSchema,
  AddressNonces,
  AddressNoncesSchema,
  AddressStxBalance,
  AddressStxBalanceSchema,
  AddressTransactionWithTransfers,
  AddressTransactionWithTransfersSchema,
  InboundStxTransfer,
} from '../schemas/entities/addresses';
import { PaginatedResponse } from '../schemas/util';
import { MempoolTransaction, MempoolTransactionSchema } from '../schemas/entities/transactions';
import { TransactionEvent, TransactionEventSchema } from '../schemas/entities/transaction-events';
import {
  AddressStxInboundListResponseSchema,
  AddressTransactionsListResponseSchema,
  AddressTransactionsWithTransfersListResponseSchema,
} from '../schemas/responses/responses';

async function getBlockHeight(
  untilBlock: number | string | undefined,
  unanchored: boolean | undefined,
  db: PgStore
): Promise<number> {
  let blockHeight = 0;
  if (typeof untilBlock === 'number') {
    blockHeight = untilBlock;
  } else if (typeof untilBlock === 'string') {
    const block = await db.getBlock({ hash: untilBlock });
    if (!block.found) {
      throw new NotFoundError(`block not found with hash`);
    }
    blockHeight = block.result.block_height;
  } else {
    const includeUnanchored = unanchored ?? false;
    const currentBlockHeight = await db.getCurrentBlockHeight();
    if (!currentBlockHeight.found) {
      throw new NotFoundError(`no current block`);
    }

    blockHeight = currentBlockHeight.result + (includeUnanchored ? 1 : 0);
  }

  return blockHeight;
}

export const AddressRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/:principal/stx',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_account_stx_balance',
        summary: 'Get account STX balance',
        description: `Retrieves STX token balance for a given Address or Contract Identifier.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
          until_block: UntilBlockSchema,
        }),
        response: {
          200: AddressStxBalanceSchema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);
      const untilBlock = parseUntilBlockQuery(req.query.until_block, req.query.unanchored);

      const result = await fastify.db.sqlTransaction(async sql => {
        const blockHeight = await getBlockHeight(untilBlock, req.query.unanchored, fastify.db);
        // Get balance info for STX token
        const stxBalanceResult = await fastify.db.getStxBalanceAtBlock(stxAddress, blockHeight);
        const tokenOfferingLocked = await fastify.db.getTokenOfferingLocked(
          stxAddress,
          blockHeight
        );
        let mempoolBalance: bigint | undefined = undefined;
        let mempoolInbound: bigint | undefined = undefined;
        let mempoolOutbound: bigint | undefined = undefined;
        if (req.query.until_block === undefined) {
          const pending = await fastify.db.getPrincipalMempoolStxBalanceDelta(sql, stxAddress);
          mempoolInbound = pending.inbound;
          mempoolOutbound = pending.outbound;
          mempoolBalance = stxBalanceResult.balance + pending.delta;
        }
        const result: AddressStxBalance = {
          balance: stxBalanceResult.balance.toString(),
          estimated_balance: mempoolBalance?.toString(),
          pending_balance_inbound: mempoolInbound?.toString(),
          pending_balance_outbound: mempoolOutbound?.toString(),
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
        if (tokenOfferingLocked.found) {
          result.token_offering_locked = tokenOfferingLocked.result;
        }
        return result;
      });
      await reply.send(result);
    }
  );

  // get balances for STX, FTs, and counts for NFTs
  fastify.get(
    '/:principal/balances',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_account_balance',
        summary: 'Get account balances',
        description: `Retrieves total account balance information for a given Address or Contract Identifier. This includes the balances of STX Tokens, Fungible Tokens and Non-Fungible Tokens for the account.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
          until_block: UntilBlockSchema,
        }),
        response: {
          200: AddressBalanceSchema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);
      const untilBlock = parseUntilBlockQuery(req.query.until_block, req.query.unanchored);

      const result = await fastify.db.sqlTransaction(async sql => {
        const blockHeight = await getBlockHeight(untilBlock, req.query.unanchored, fastify.db);

        // Get balance info for STX token
        const stxBalanceResult = await fastify.db.getStxBalanceAtBlock(stxAddress, blockHeight);
        const tokenOfferingLocked = await fastify.db.getTokenOfferingLocked(
          stxAddress,
          blockHeight
        );

        // Get balances for fungible tokens
        const ftBalancesResult = await fastify.db.getFungibleTokenBalances({
          stxAddress,
          untilBlock: blockHeight,
        });
        const ftBalances = formatMapToObject(ftBalancesResult, val => {
          return {
            balance: val.balance.toString(),
            total_sent: val.totalSent.toString(),
            total_received: val.totalReceived.toString(),
          };
        });

        // Get counts for non-fungible tokens
        const nftBalancesResult = await fastify.db.getNonFungibleTokenCounts({
          stxAddress,
          untilBlock: blockHeight,
        });
        const nftBalances = formatMapToObject(nftBalancesResult, val => {
          return {
            count: val.count.toString(),
            total_sent: val.totalSent.toString(),
            total_received: val.totalReceived.toString(),
          };
        });

        let mempoolBalance: bigint | undefined = undefined;
        let mempoolInbound: bigint | undefined = undefined;
        let mempoolOutbound: bigint | undefined = undefined;
        if (req.query.until_block === undefined) {
          const pending = await fastify.db.getPrincipalMempoolStxBalanceDelta(sql, stxAddress);
          mempoolInbound = pending.inbound;
          mempoolOutbound = pending.outbound;
          mempoolBalance = stxBalanceResult.balance + pending.delta;
        }

        const result: AddressBalance = {
          stx: {
            balance: stxBalanceResult.balance.toString(),
            estimated_balance: mempoolBalance?.toString(),
            pending_balance_inbound: mempoolInbound?.toString(),
            pending_balance_outbound: mempoolOutbound?.toString(),
            total_sent: stxBalanceResult.totalSent.toString(),
            total_received: stxBalanceResult.totalReceived.toString(),
            total_fees_sent: stxBalanceResult.totalFeesSent.toString(),
            total_miner_rewards_received: stxBalanceResult.totalMinerRewardsReceived.toString(),
            lock_tx_id: stxBalanceResult.lockTxId,
            locked: stxBalanceResult.locked.toString(),
            lock_height: stxBalanceResult.lockHeight,
            burnchain_lock_height: stxBalanceResult.burnchainLockHeight,
            burnchain_unlock_height: stxBalanceResult.burnchainUnlockHeight,
          },
          fungible_tokens: ftBalances,
          non_fungible_tokens: nftBalances,
        };

        if (tokenOfferingLocked.found) {
          result.token_offering_locked = tokenOfferingLocked.result;
        }
        return result;
      });
      await reply.send(result);
    }
  );

  /**
   * Get recent STX transactions associated with a principal (stx address or contract id,
   * sender or receiver).
   */
  fastify.get(
    '/:principal/transactions',
    {
      preHandler: handlePrincipalCache,
      schema: {
        deprecated: true,
        operationId: 'get_account_transactions',
        summary: 'Get account transactions',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get address transactions](/api/get-address-transactions).

        Retrieves a list of all Transactions for a given Address or Contract Identifier. More information on Transaction types can be found [here](https://docs.stacks.co/understand-stacks/transactions#types).

        If you need to actively monitor new transactions for an address or contract id, we highly recommend subscribing to [WebSockets or Socket.io](https://github.com/hirosystems/stacks-blockchain-api/tree/master/client) for real-time updates.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          offset: OffsetParam(),
          height: Type.Optional(
            Type.Integer({ description: 'Filter for transactions only at this given block height' })
          ),
          unanchored: UnanchoredParamSchema,
          until_block: UntilBlockSchema,
        }),
        response: {
          200: AddressTransactionsListResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const principal = req.params.principal;
      validatePrincipal(principal);
      const untilBlock = parseUntilBlockQuery(req.query.until_block, req.query.unanchored);
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = req.query.offset ?? 0;

      const response = await fastify.db.sqlTransaction(async sql => {
        const blockParams = getBlockParams(req.query.height, req.query.unanchored);
        let atSingleBlock = false;
        let blockHeight = 0;
        if (blockParams.blockHeight) {
          if (untilBlock) {
            throw new InvalidRequestError(
              `can't handle until_block and block_height in the same request`,
              InvalidRequestErrorType.invalid_param
            );
          }
          atSingleBlock = true;
          blockHeight = blockParams.blockHeight;
        } else {
          blockHeight = await getBlockHeight(untilBlock, req.query.unanchored, fastify.db);
        }

        const { results: txResults, total } = await fastify.db.getAddressTxs({
          stxAddress: principal,
          limit,
          offset,
          blockHeight,
          atSingleBlock,
        });
        const results = txResults.map(dbTx => parseDbTx(dbTx));
        const response = { limit, offset, total, results };
        return response;
      });
      await reply.send(response);
    }
  );

  /**
   * @deprecated See `/v2/addresses/:address/transactions/:tx_id`
   */
  fastify.get(
    '/:principal/:tx_id/with_transfers',
    {
      preHandler: handleTransactionCache,
      schema: {
        deprecated: true,
        operationId: 'get_single_transaction_with_transfers',
        summary: 'Get account transaction information for specific transaction',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get events for an address transaction](/api/get-address-transaction-events).

        Retrieves transaction details for a given Transaction Id \`tx_id\`, for a given account or contract Identifier.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
          tx_id: Type.String({
            description: 'Transaction ID',
            examples: ['0x34d79c7cfc2fe525438736733e501a4bf0308a5556e3e080d1e2c0858aad7448'],
          }),
        }),
        response: {
          200: AddressTransactionWithTransfersSchema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      let tx_id = req.params.tx_id;
      validatePrincipal(stxAddress);
      if (!has0xPrefix(tx_id)) {
        tx_id = '0x' + tx_id;
      }
      const result = await fastify.db.sqlTransaction(async sql => {
        const results = await fastify.db.getInformationTxsWithStxTransfers({ stxAddress, tx_id });
        if (results && results.tx) {
          const txQuery = await getTxFromDataStore(fastify.db, {
            txId: results.tx.tx_id,
            dbTx: results.tx,
            includeUnanchored: false,
          });
          if (!txQuery.found) {
            throw new Error('unexpected tx not found -- fix tx enumeration query');
          }
          const result: AddressTransactionWithTransfers = {
            tx: txQuery.result,
            stx_sent: results.stx_sent.toString(),
            stx_received: results.stx_received.toString(),
            stx_transfers: results.stx_transfers.map(transfer => ({
              amount: transfer.amount.toString(),
              sender: transfer.sender,
              recipient: transfer.recipient,
            })),
          };
          return result;
        }
      });
      if (result) {
        await reply.send(result);
      } else {
        throw new NotFoundError(`No matching transaction found`);
      }
    }
  );

  /**
   * @deprecated See `/v2/addresses/:address/transactions`
   */
  fastify.get(
    '/:principal/transactions_with_transfers',
    {
      preHandler: handlePrincipalCache,
      schema: {
        deprecated: true,
        operationId: 'get_account_transactions_with_transfers',
        summary: 'Get account transactions including STX transfers for each transaction.',
        description: `Retrieve all transactions for an account or contract identifier including STX transfers for each transaction.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          offset: OffsetParam(),
          height: Type.Optional(
            Type.Integer({ description: 'Filter for transactions only at this given block height' })
          ),
          unanchored: UnanchoredParamSchema,
          until_block: UntilBlockSchema,
        }),
        response: {
          200: AddressTransactionsWithTransfersListResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);
      const untilBlock = parseUntilBlockQuery(req.query.until_block, req.query.unanchored);

      const response = await fastify.db.sqlTransaction(async sql => {
        const blockParams = getBlockParams(req.query.height, req.query.unanchored);
        let atSingleBlock = false;
        let blockHeight = 0;
        if (blockParams.blockHeight) {
          if (untilBlock) {
            throw new InvalidRequestError(
              `can't handle until_block and block_height in the same request`,
              InvalidRequestErrorType.invalid_param
            );
          }
          atSingleBlock = true;
          blockHeight = blockParams.blockHeight;
        } else {
          blockHeight = await getBlockHeight(untilBlock, req.query.unanchored, fastify.db);
        }

        const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
        const offset = req.query.offset ?? 0;
        const { results: txResults, total } = await fastify.db.getAddressTxsWithAssetTransfers({
          stxAddress: stxAddress,
          limit,
          offset,
          blockHeight,
          atSingleBlock,
        });

        const results = await mapSeriesAsync(txResults, async entry => {
          const txQuery = await getTxFromDataStore(fastify.db, {
            txId: entry.tx.tx_id,
            dbTx: entry.tx,
            includeUnanchored: blockParams.includeUnanchored ?? false,
          });
          if (!txQuery.found) {
            throw new Error('unexpected tx not found -- fix tx enumeration query');
          }
          const result: AddressTransactionWithTransfers = {
            tx: txQuery.result,
            stx_sent: entry.stx_sent.toString(),
            stx_received: entry.stx_received.toString(),
            stx_transfers: entry.stx_transfers.map(transfer => ({
              amount: transfer.amount.toString(),
              sender: transfer.sender,
              recipient: transfer.recipient,
            })),
            ft_transfers: entry.ft_transfers.map(transfer => ({
              asset_identifier: transfer.asset_identifier,
              amount: transfer.amount.toString(),
              sender: transfer.sender,
              recipient: transfer.recipient,
            })),
            nft_transfers: entry.nft_transfers.map(transfer => {
              const parsedClarityValue = decodeClarityValueToRepr(transfer.value);
              const nftTransfer = {
                asset_identifier: transfer.asset_identifier,
                value: {
                  hex: transfer.value,
                  repr: parsedClarityValue,
                },
                sender: transfer.sender,
                recipient: transfer.recipient,
              };
              return nftTransfer;
            }),
          };
          return result;
        });

        const response = {
          limit,
          offset,
          total,
          results,
        };
        return response;
      });
      await reply.send(response);
    }
  );

  fastify.get(
    '/:principal/assets',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_account_assets',
        summary: 'Get account assets',
        description: `Retrieves a list of all assets events associated with an account or a Contract Identifier. This includes Transfers, Mints.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Event),
          offset: OffsetParam(),
          unanchored: UnanchoredParamSchema,
          until_block: UntilBlockSchema,
        }),
        response: {
          200: PaginatedResponse(TransactionEventSchema, { title: 'AddressAssetsListResponse' }),
        },
      },
    },
    async (req, reply) => {
      // get recent asset event associated with address
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);
      const untilBlock = parseUntilBlockQuery(req.query.until_block, req.query.unanchored);

      const limit = getPagingQueryLimit(ResourceType.Event, req.query.limit);
      const offset = req.query.offset ?? 0;

      const response = await fastify.db.sqlTransaction(async sql => {
        const blockHeight = await getBlockHeight(untilBlock, req.query.unanchored, fastify.db);
        const { results: assetEvents, total } = await fastify.db.getAddressAssetEvents({
          stxAddress,
          limit,
          offset,
          blockHeight,
        });
        const results: TransactionEvent[] = assetEvents.map(event => parseDbEvent(event));
        const response = { limit, offset, total, results };
        return response;
      });
      await reply.send(response);
    }
  );

  fastify.get(
    '/:principal/stx_inbound',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_account_inbound',
        summary: 'Get inbound STX transfers',
        description: `Retrieves a list of STX transfers with memos to the given principal. This includes regular transfers from a stx-transfer transaction type,
        and transfers from contract-call transactions a the \`send-many-memo\` bulk sending contract.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          offset: OffsetParam(),
          height: Type.Optional(
            Type.Integer({ description: 'Filter for transactions only at this given block height' })
          ),
          unanchored: UnanchoredParamSchema,
          until_block: UntilBlockSchema,
        }),
        response: {
          200: AddressStxInboundListResponseSchema,
        },
      },
    },
    async (req, reply) => {
      // get recent inbound STX transfers with memos
      const stxAddress = req.params.principal;
      try {
        const sendManyContractId = getSendManyContract(fastify.chainId);
        if (!sendManyContractId || !isValidPrincipal(sendManyContractId)) {
          logger.error('Send many contract ID not properly configured');
          throw new Error('Send many contract ID not properly configured');
        }
        validatePrincipal(stxAddress);

        const response = await fastify.db.sqlTransaction(async sql => {
          let atSingleBlock = false;
          const untilBlock = parseUntilBlockQuery(req.query.until_block, req.query.unanchored);
          const blockParams = getBlockParams(req.query.height, req.query.unanchored);
          let blockHeight = 0;
          if (blockParams.blockHeight) {
            if (untilBlock) {
              throw new InvalidRequestError(
                `can't handle until_block and block_height in the same request`,
                InvalidRequestErrorType.invalid_param
              );
            }
            atSingleBlock = true;
            blockHeight = blockParams.blockHeight;
          } else {
            blockHeight = await getBlockHeight(untilBlock, req.query.unanchored, fastify.db);
          }

          const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
          const offset = parsePagingQueryInput(req.query.offset ?? 0);
          const { results, total } = await fastify.db.getInboundTransfers({
            stxAddress,
            limit,
            offset,
            sendManyContractId,
            blockHeight,
            atSingleBlock,
          });
          const transfers: InboundStxTransfer[] = results.map(r => ({
            sender: r.sender,
            amount: r.amount.toString(),
            memo: r.memo,
            block_height: r.block_height,
            tx_id: r.tx_id,
            transfer_type: r.transfer_type as InboundStxTransfer['transfer_type'],
            tx_index: r.tx_index,
          }));
          const response = {
            results: transfers,
            total: total,
            limit,
            offset,
          };
          return response;
        });
        await reply.send(response);
      } catch (error) {
        logger.error(error, `Unable to get inbound transfers for ${stxAddress}`);
        throw error;
      }
    }
  );

  fastify.get(
    '/:principal/mempool',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_address_mempool_transactions',
        summary: 'Transactions for address',
        description: `Retrieves all transactions for a given address that are currently in mempool`,
        tags: ['Transactions'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          offset: OffsetParam(),
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: PaginatedResponse(MempoolTransactionSchema, {
            description: 'List of mempool transactions',
          }),
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = req.query.offset ?? 0;
      const address = req.params.principal;
      if (!isValidPrincipal(address)) {
        throw new InvalidRequestError(
          `Invalid query parameter, not a valid principal`,
          InvalidRequestErrorType.invalid_param
        );
      }
      const includeUnanchored = req.query.unanchored ?? false;
      const { results: txResults, total } = await fastify.db.getMempoolTxList({
        offset,
        limit,
        address,
        includeUnanchored,
      });
      const results: MempoolTransaction[] = txResults.map(tx => parseDbMempoolTx(tx));
      const response = { limit, offset, total, results };
      await reply.send(response);
    }
  );

  fastify.get(
    '/:principal/nonces',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_account_nonces',
        summary: 'Get the latest nonce used by an account',
        description: `Retrieves the latest nonce values used by an account by inspecting the mempool, microblock transactions, and anchored transactions.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          block_height: Type.Optional(
            Type.Integer({
              description: 'Optionally get the nonce at a given block height.',
              minimum: 1,
              examples: [66119],
            })
          ),
          block_hash: Type.Optional(
            Type.String({
              description:
                'Optionally get the nonce at a given block hash. Note - Use either of the query parameters but not both at a time.',
              examples: ['0x72d53f3cba39e149dcd42708e535bdae03d73e60d2fe853aaf61c0b392f521e9'],
            })
          ),
        }),
        response: {
          200: AddressNoncesSchema,
        },
      },
    },
    async (req, reply) => {
      // get recent asset event associated with address
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);
      let blockIdentifier: BlockIdentifier | undefined;
      const blockHeightQuery = req.query['block_height'];
      const blockHashQuery = req.query['block_hash'];
      if (blockHeightQuery && blockHashQuery) {
        throw new InvalidRequestError(
          `Multiple block query parameters specified`,
          InvalidRequestErrorType.invalid_query
        );
      }
      if (blockHeightQuery) {
        blockIdentifier = { height: blockHeightQuery };
      } else if (blockHashQuery) {
        if (!has0xPrefix(blockHashQuery)) {
          throw new InvalidRequestError(
            `Query parameter 'block_hash' is not a valid block hash hex string`,
            InvalidRequestErrorType.invalid_param
          );
        }
        blockIdentifier = { hash: blockHashQuery };
      }
      if (blockIdentifier) {
        const nonceQuery = await fastify.db.getAddressNonceAtBlock({ stxAddress, blockIdentifier });
        if (!nonceQuery.found) {
          throw new NotFoundError(`No block found for ${JSON.stringify(blockIdentifier)}`);
        }
        const results: AddressNonces = {
          last_executed_tx_nonce: nonceQuery.result.lastExecutedTxNonce,
          possible_next_nonce: nonceQuery.result.possibleNextNonce,
          last_mempool_tx_nonce: null,
          detected_missing_nonces: [],
          detected_mempool_nonces: [],
        };
        await reply.send(results);
      } else {
        const nonces = await fastify.db.getAddressNonces({ stxAddress });
        const results: AddressNonces = {
          last_executed_tx_nonce: nonces.lastExecutedTxNonce,
          last_mempool_tx_nonce: nonces.lastMempoolTxNonce,
          possible_next_nonce: nonces.possibleNextNonce,
          detected_missing_nonces: nonces.detectedMissingNonces,
          detected_mempool_nonces: nonces.detectedMempoolNonces,
        };
        await reply.send(results);
      }
    }
  );

  await Promise.resolve();
};
