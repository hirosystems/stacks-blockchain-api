import {
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
import { LimitParam, OffsetParam, PrincipalSchema } from '../../schemas/params';
import { getPagingQueryLimit, ResourceType } from '../../pagination';
import { PaginatedResponse } from '../../schemas/util';
import {
  AddressBalance,
  AddressBalanceSchema,
  AddressBalanceV2,
  AddressBalanceV2Schema,
  AddressTransaction,
  AddressTransactionEvent,
  AddressTransactionEventSchema,
  AddressTransactionSchema,
} from '../../schemas/entities/addresses';
import { formatMapToObject } from '../../../helpers';
import { validatePrincipal } from '../../query-helpers';

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
        }),
        response: {
          200: PaginatedResponse(AddressTransactionSchema),
        },
      },
    },
    async (req, reply) => {
      const params = req.params;
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getAddressTransactions({
          ...params,
          ...query,
        });
        const transfers: AddressTransaction[] = results.map(r =>
          parseDbTxWithAccountTransferSummary(r)
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

  // get balances for STX, FTs, and counts for NFTs
  fastify.get(
    '/:principal/balances',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_account_balance_v2',
        summary: 'Get account balances',
        description: `Retrieves total account balance information for a given Address or Contract Identifier. This includes the balances of STX Tokens, Fungible Tokens and Non-Fungible Tokens for the account.`,
        tags: ['Accounts'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
        response: {
          200: AddressBalanceV2Schema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      validatePrincipal(stxAddress);

      const result = await fastify.db.sqlTransaction(async sql => {
        const chainTip = await fastify.db.getChainTip(sql);

        // Get balances for fungible tokens
        const ftBalancesResult = await fastify.db.v2.getFungibleTokenHolderBalances({
          sql,
          stxAddress,
        });
        const ftBalances: Record<string, string> = {};
        for (const { token, balance } of ftBalancesResult) {
          if (token !== 'stx') {
            ftBalances[token] = balance;
          }
        }

        // Get stx balance (sum of credits, debits, and fees) for address
        const stxBalanceResult = ftBalancesResult.find(entry => entry.token === 'stx');
        let stxBalance = BigInt(stxBalanceResult?.balance ?? '0');

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
        stxBalance += totalMinerRewardsReceived;

        const mempoolResult = await fastify.db.getPrincipalMempoolStxBalanceDelta(sql, stxAddress);
        const mempoolBalance: bigint = stxBalance + mempoolResult.delta;

        const result: AddressBalanceV2 = {
          stx: {
            balance: stxBalance.toString(),
            estimated_balance: mempoolBalance.toString(),
            pending_balance_inbound: mempoolResult.inbound.toString(),
            pending_balance_outbound: mempoolResult.outbound.toString(),
            total_miner_rewards_received: totalMinerRewardsReceived.toString(),
            lock_tx_id: stxPoxLockedResult.lockTxId,
            locked: stxPoxLockedResult.locked.toString(),
            lock_height: stxPoxLockedResult.lockHeight,
            burnchain_lock_height: stxPoxLockedResult.burnchainLockHeight,
            burnchain_unlock_height: stxPoxLockedResult.burnchainUnlockHeight,
          },
          fungible_tokens: ftBalances,
        };
        return result;
      });
      await reply.send(result);
    }
  );

  await Promise.resolve();
};
