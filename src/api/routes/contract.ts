import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { parseDbEvent } from '../controllers/db-controller';
import { handleChainTipCache } from '../controllers/cache-controller';

import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam } from '../schemas/params';
import { InvalidRequestError, InvalidRequestErrorType, NotFoundError } from '../../errors';
import { ClarityAbi } from '@stacks/transactions';
import { SmartContractSchema } from '../schemas/entities/smart-contracts';
import { TransactionEventSchema } from '../schemas/entities/transaction-events';

export const ContractRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/by_trait',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_contracts_by_trait',
        summary: 'Get contracts by trait',
        description: `Retrieves a list of contracts based on the following traits listed in JSON format -  functions, variables, maps, fungible tokens and non-fungible tokens`,
        tags: ['Smart Contracts'],
        querystring: Type.Object({
          trait_abi: Type.String({
            description: 'JSON abi of the trait.',
          }),
          limit: LimitParam(ResourceType.Contract, 'Limit', 'max number of contracts fetch'),
          offset: OffsetParam('Offset', 'index of first contract event to fetch'),
        }),
        response: {
          200: Type.Object(
            {
              limit: Type.Integer({ examples: [20] }),
              offset: Type.Integer({ examples: [0] }),
              results: Type.Array(SmartContractSchema),
            },
            {
              title: 'ContractListResponse',
              description: 'GET list of contracts',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const trait_abi: ClarityAbi = JSON.parse(req.query.trait_abi);
      if (!('functions' in trait_abi)) {
        throw new InvalidRequestError(`Invalid 'trait_abi'`, InvalidRequestErrorType.invalid_param);
      }
      const limit = getPagingQueryLimit(ResourceType.Contract, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const smartContracts = await fastify.db.getSmartContractByTrait({
        trait: trait_abi,
        limit,
        offset,
      });
      if (!smartContracts.found) {
        throw new NotFoundError(`cannot find contract for this trait`);
      }
      await reply.send({ limit, offset, results: smartContracts.result });
    }
  );

  fastify.get(
    '/:contract_id',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_contract_by_id',
        summary: 'Get contract info',
        description: 'Retrieves details of a contract with a given `contract_id`',
        tags: ['Smart Contracts'],
        params: Type.Object({
          contract_id: Type.String({
            description: 'Contract identifier formatted as `<contract_address>.<contract_name>`',
            examples: ['SP6P4EJF0VG8V0RB3TQQKJBHDQKEF6NVRD1KZE3C.satoshibles'],
          }),
        }),
        response: {
          200: SmartContractSchema,
        },
      },
    },
    async (req, reply) => {
      const { contract_id } = req.params;
      const contractQuery = await fastify.db.getSmartContract(contract_id);
      if (!contractQuery.found) {
        throw new NotFoundError(`cannot find contract by ID`);
      }
      await reply.send(contractQuery.result);
    }
  );

  fastify.get(
    '/:contract_id/events',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_contract_events_by_id',
        summary: 'Get contract events',
        description: 'Retrieves a list of events that have been triggered by a given `contract_id`',
        tags: ['Smart Contracts'],
        params: Type.Object({
          contract_id: Type.String({
            description: 'Contract identifier formatted as `<contract_address>.<contract_name>`',
            examples: ['SP6P4EJF0VG8V0RB3TQQKJBHDQKEF6NVRD1KZE3C.satoshibles'],
          }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Contract, 'Limit', 'max number of events to fetch'),
          offset: OffsetParam(),
        }),
        response: {
          200: Type.Object(
            {
              limit: Type.Integer(),
              offset: Type.Integer(),
              results: Type.Array(TransactionEventSchema),
            },
            { description: 'List of events' }
          ),
        },
      },
    },
    async (req, reply) => {
      const { contract_id } = req.params;
      const limit = getPagingQueryLimit(ResourceType.Contract, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const eventsQuery = await fastify.db.getSmartContractEvents({
        contractId: contract_id,
        limit,
        offset,
      });
      if (!eventsQuery.found) {
        throw new NotFoundError(`cannot find events for contract by ID}`);
      }
      const parsedEvents = eventsQuery.result.map(event => parseDbEvent(event));
      await reply.send({ limit, offset, results: parsedEvents });
    }
  );

  await Promise.resolve();
};
