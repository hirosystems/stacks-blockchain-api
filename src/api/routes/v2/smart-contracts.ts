import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { SmartContractStatusParamsSchema, TransactionEventCursorParamSchema } from './schemas.js';
import { parseDbSmartContractStatusArray } from './helpers.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { SmartContractStatusListSchema } from '../../schemas/entities/smart-contracts.js';
import { SmartContractLogEventListResponseSchema } from '../../schemas/responses/responses.js';
import { CursorOffsetParam, LimitParam } from '../../schemas/params.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { NotFoundError } from '../../../errors.js';
import { SmartContractLogTransactionEvent } from '../../schemas/entities/transaction-events.js';
import codec from '@stacks/codec';

export const SmartContractRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/status',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_smart_contracts_status',
        summary: 'Get smart contracts status',
        description: `Retrieves the deployment status of multiple smart contracts.`,
        tags: ['Smart Contracts'],
        querystring: SmartContractStatusParamsSchema,
        response: {
          200: SmartContractStatusListSchema,
        },
      },
    },
    async (req, reply) => {
      const query = req.query;
      const result = await fastify.db.v2.getSmartContractStatus(query);
      const resultArray = parseDbSmartContractStatusArray(query, result);
      await reply.send(resultArray);
    }
  );

  fastify.get(
    '/:contract_id/print-events',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_smart_contract_print_events',
        summary: 'Get smart contract print events',
        description: `Retrieves print events (contract log events) for a given smart contract.`,
        tags: ['Smart Contracts'],
        params: Type.Object({
          contract_id: Type.String({
            description: 'Contract identifier formatted as `<contract_address>.<contract_name>`',
            examples: ['SP000000000000000000002Q6VF78.pox-3'],
          }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Event),
          offset: CursorOffsetParam({ resource: ResourceType.Event }),
          cursor: Type.Optional(TransactionEventCursorParamSchema),
        }),
        response: {
          200: SmartContractLogEventListResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Event, req.query.limit);
      const eventQuery = await fastify.db.v2.getSmartContractEvents({
        contractId: req.params.contract_id,
        limit,
        offset: req.query.offset,
        cursor: req.query.cursor,
      });
      if (req.query.cursor && !eventQuery.current_cursor) {
        throw new NotFoundError('Cursor not found');
      }
      const events: SmartContractLogTransactionEvent[] = eventQuery.results.map(r => {
        const parsedClarityValue = codec.decodeClarityValueToRepr(r.value);
        return {
          event_index: r.event_index,
          event_type: 'smart_contract_log' as const,
          tx_id: r.tx_id,
          contract_log: {
            contract_id: r.contract_identifier,
            topic: r.topic,
            value: {
              hex: r.value,
              repr: parsedClarityValue,
            },
          },
        };
      });
      await reply.send({
        limit: eventQuery.limit,
        offset: eventQuery.offset,
        total: eventQuery.total,
        next_cursor: eventQuery.next_cursor,
        prev_cursor: eventQuery.prev_cursor,
        cursor: eventQuery.current_cursor,
        results: events,
      });
    }
  );

  await Promise.resolve();
};
