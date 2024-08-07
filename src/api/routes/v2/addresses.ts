import { handleChainTipCache } from '../../../api/controllers/cache-controller';
import { AddressParamsSchema, AddressTransactionParamsSchema } from './schemas';
import { parseDbAddressTransactionTransfer, parseDbTxWithAccountTransferSummary } from './helpers';
import { InvalidRequestError, NotFoundError } from '../../../errors';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam } from '../../schemas/params';
import { getPagingQueryLimit, ResourceType } from '../../pagination';
import { PaginatedResponse } from '../../schemas/util';
import {
  AddressTransaction,
  AddressTransactionEvent,
  AddressTransactionEventSchema,
  AddressTransactionSchema,
} from '../../schemas/entities/addresses';

export const AddressRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/:address/transactions',
    {
      preHandler: handleChainTipCache,
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
      preHandler: handleChainTipCache,
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

  await Promise.resolve();
};
