import {
  ETagType,
  handleCache,
  handleChainTipCache,
  handlePrincipalCache,
  handlePrincipalMempoolCache,
  handleTransactionCache,
} from '../../../api/controllers/cache-controller';
import { AddressParamsSchema, AddressTransactionParamsSchema } from './schemas';
import { parseDbAddressTransactionTransfer, parseDbTxWithAccountTransferSummary } from './helpers';
import { InvalidRequestError, NotFoundError } from '../../../errors';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import {
  LimitParam,
  OffsetParam,
  PrincipalSchema,
  ExcludeFunctionArgsParamSchema,
} from '../../schemas/params';
import { getPagingQueryLimit, ResourceType } from '../../pagination';
import { PaginatedResponse } from '../../schemas/util';
import {
  AddressTransaction,
  AddressTransactionEvent,
  AddressTransactionEventSchema,
  AddressTransactionSchema,
  PrincipalFtBalance,
  PrincipalFtBalanceSchema,
} from '../../schemas/entities/addresses';
import { validatePrincipal } from '../../query-helpers';
import { StxBalance, StxBalanceSchema } from '../../schemas/entities/balances';

export const AddressRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/:address/transactions',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_address_transactions',
        summary: 'Get address transactions',
        description: `Retrieves a paginated list of confirmed transactions sent or received by a STX address or Smart Contract ID, alongside the total amount of STX sent or received and the number of STX, FT and NFT transfers contained within each transaction.
        
        More information on Transaction types can be found [here](https://docs.stacks.co/understand-stacks/transactions#types).`,
        tags: ['Transactions'],
        params: AddressParamsSchema,
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          offset: OffsetParam(),
          exclude_function_args: ExcludeFunctionArgsParamSchema,
        }),
        response: {
          200: PaginatedResponse(AddressTransactionSchema),
        },
      },
    },
    async (req, reply) => {
      const params = req.params;
      const query = req.query;
      const excludeFunctionArgs = req.query.exclude_function_args ?? false;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getAddressTransactions({
          ...params,
          ...query,
        });
        const transfers: AddressTransaction[] = results.map(r =>
          parseDbTxWithAccountTransferSummary(r, excludeFunctionArgs)
        );
        await reply.send({
          limit,
          offset,
          total,
          results: transfers,
        });
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    }
  );

  fastify.get(
    '/:address/transactions/:tx_id/events',
    {
      preHandler: handleTransactionCache,
      schema: {
        operationId: 'get_address_transaction_events',
        summary: 'Get events for an address transaction',
        description: `Retrieves a paginated list of all STX, FT and NFT events concerning a STX address or Smart Contract ID within a specific transaction.`,
        tags: ['Transactions'],
        params: AddressTransactionParamsSchema,
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(AddressTransactionEventSchema),
        },
      },
    },
    async (req, reply) => {
      const params = req.params;
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getAddressTransactionEvents({
          limit: getPagingQueryLimit(ResourceType.Tx, query.limit),
          offset: query.offset ?? 0,
          ...params,
        });
        const transfers: AddressTransactionEvent[] = results.map(r =>
          parseDbAddressTransactionTransfer(r)
        );
        await reply.send({
          limit,
          offset,
          total,
          results: transfers,
        });
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    }
  );

  fastify.get(
    '/:principal/balances/stx',
    {
      preHandler: (req, reply) => {
        // TODO: use `ETagType.principal` instead of chaintip cache type when it's optimized
        const etagType = req.query.include_mempool ? ETagType.principalMempool : ETagType.chainTip;
        return handleCache(etagType, req, reply);
      },
      schema: {
        operationId: 'get_principal_stx_balance',
        summary: 'Get principal STX balance',
        description: `Retrieves STX account balance information for a given Address or Contract Identifier.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          include_mempool: Type.Optional(
            Type.Boolean({
              description: 'Include pending mempool transactions in the balance calculation',
              default: false,
            })
          ),
        }),
        response: {
          200: StxBalanceSchema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);

      const result = await fastify.db.sqlTransaction(async sql => {
        const chainTip = await fastify.db.getChainTip(sql);

        // Get stx balance (sum of credits, debits, and fees) for address
        const stxBalancesResult = await fastify.db.v2.getStxHolderBalance({
          sql,
          stxAddress,
        });
        const stxBalance = stxBalancesResult.found ? stxBalancesResult.result.balance : 0n;

        // Get pox-locked info for STX token
        const stxPoxLockedResult = await fastify.db.v2.getStxPoxLockedAtBlock({
          sql,
          stxAddress,
          blockHeight: chainTip.block_height,
          burnBlockHeight: chainTip.burn_block_height,
        });

        // Get miner rewards
        const { totalMinerRewardsReceived } = await fastify.db.v2.getStxMinerRewardsAtBlock({
          sql,
          stxAddress,
          blockHeight: chainTip.block_height,
        });

        const result: StxBalance = {
          balance: stxBalance.toString(),
          total_miner_rewards_received: totalMinerRewardsReceived.toString(),
          lock_tx_id: stxPoxLockedResult.lockTxId,
          locked: stxPoxLockedResult.locked.toString(),
          lock_height: stxPoxLockedResult.lockHeight,
          burnchain_lock_height: stxPoxLockedResult.burnchainLockHeight,
          burnchain_unlock_height: stxPoxLockedResult.burnchainUnlockHeight,
        };

        if (req.query.include_mempool) {
          const mempoolResult = await fastify.db.getPrincipalMempoolStxBalanceDelta(
            sql,
            stxAddress
          );
          const mempoolBalance = stxBalance + mempoolResult.delta;
          result.estimated_balance = mempoolBalance.toString();
          result.pending_balance_inbound = mempoolResult.inbound.toString();
          result.pending_balance_outbound = mempoolResult.outbound.toString();
        }

        return result;
      });
      await reply.send(result);
    }
  );

  fastify.get(
    '/:principal/balances/ft',
    {
      preHandler: handleChainTipCache, // TODO: use handlePrincipalCache once it's optimized
      schema: {
        operationId: 'get_principal_ft_balances',
        summary: 'Get principal FT balances',
        description: `Retrieves Fungible-token account balance information for a given Address or Contract Identifier.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.FtBalance),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(PrincipalFtBalanceSchema),
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);
      const limit = getPagingQueryLimit(ResourceType.FtBalance, req.query.limit);
      const offset = req.query.offset ?? 0;
      const result = await fastify.db.sqlTransaction(async sql => {
        // Get balances for fungible tokens
        const ftBalancesResult = await fastify.db.v2.getFungibleTokenHolderBalances({
          sql,
          stxAddress,
          limit,
          offset,
        });
        const ftBalances: PrincipalFtBalance[] = ftBalancesResult.results.map(
          ({ token, balance }) => ({
            token,
            balance,
          })
        );
        const result = {
          limit,
          offset,
          total: ftBalancesResult.total,
          results: ftBalances,
        };
        return result;
      });
      await reply.send(result);
    }
  );

  fastify.get(
    '/:principal/balances/ft/:token',
    {
      preHandler: handleChainTipCache, // TODO: use handlePrincipalCache once it's optimized
      schema: {
        operationId: 'get_principal_ft_balance',
        summary: 'Get principal FT balance',
        description: `Retrieves a specific fungible-token balance for a given principal.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
          token: Type.String({
            description: 'fungible token identifier',
            examples: [
              'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
              'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc::aeUSDC',
            ],
          }),
        }),
        response: {
          200: Type.Object({
            balance: Type.String(),
          }),
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);
      const result = await fastify.db.sqlTransaction(async sql => {
        const ftBalanceResult = await fastify.db.v2.getFtHolderBalance({
          sql,
          stxAddress,
          token: req.params.token,
        });
        const balance = ftBalanceResult.found ? ftBalanceResult.result.balance : 0n;
        const result = {
          balance: balance.toString(),
        };
        return result;
      });
      await reply.send(result);
    }
  );

  await Promise.resolve();
};
