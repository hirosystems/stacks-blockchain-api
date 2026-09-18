import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipWithBurnchainTipCache } from '../../controllers/cache-controller.js';
import { splitCommaSeparatedQueryParam } from '../../query-helpers.js';
import {
  SearchEntityType,
  SearchEntityTypeSchema,
  SearchResultSchema,
} from '../../schemas/v3/entities/search.js';
import { serializeDbSearchHit } from '../../serializers/v3/search.js';
import {
  SEARCH_MIN_ADDRESS_LENGTH,
  SEARCH_MIN_HASH_LENGTH,
  SEARCH_MIN_NAME_LENGTH,
  SEARCH_RESULT_LIMIT,
  classifySearchTerm,
} from '../../search-term.js';
import { InvalidRequestError, InvalidRequestErrorType } from '../../../errors.js';

const ALL_SEARCH_ENTITY_TYPES: SearchEntityType[] = [
  'block',
  'bitcoin_block',
  'transaction',
  'address',
  'smart_contract',
  'token',
];

export const SearchRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/search',
    {
      preHandler: handleChainTipWithBurnchainTipCache,
      preValidation: splitCommaSeparatedQueryParam('type'),
      schema: {
        operationId: 'search',
        summary: 'Search',
        description:
          'Searches for the blocks, transactions, addresses, smart contracts, and token assets ' +
          'that a term refers to. The term can be a complete identifier or the beginning of one: ' +
          'a block or transaction hash, a Stacks or Bitcoin block height, an address, a contract ' +
          'id, or an asset identifier. Contract and asset names are matched anywhere in the name, ' +
          'so a term like `arkadiko` finds the contracts and tokens named after it. Names must ' +
          `contain the term; misspellings are not matched. At most ${SEARCH_RESULT_LIMIT} ` +
          'results are returned, best ' +
          'match first; there is no pagination, so narrow the term to see something that did not ' +
          'surface. A term that matches nothing returns an empty list rather than an error. Only ' +
          'canonical, mined entities are searched.',
        tags: ['Search'],
        querystring: Type.Object({
          q: Type.String({
            description:
              'The term to search for. Hex terms need at least ' +
              `${SEARCH_MIN_HASH_LENGTH} characters, addresses at least ` +
              `${SEARCH_MIN_ADDRESS_LENGTH}, and contract or asset names at least ` +
              `${SEARCH_MIN_NAME_LENGTH}; block heights have no minimum.`,
            examples: ['0xcf8b233f19f6c07d2dc1963302d2436efd36e9af', 'arkadiko', '213377'],
          }),
          type: Type.Optional(
            Type.Array(SearchEntityTypeSchema, {
              uniqueItems: true,
              description:
                'Restricts results to these entity types. Provide them as repeated querystring ' +
                'values (`?type=block&type=transaction`) or as a single comma-separated value ' +
                '(`?type=block,transaction`). Defaults to every type the term could match.',
            })
          ),
        }),
        response: {
          200: Type.Object(
            {
              results: Type.Array(SearchResultSchema),
            },
            { title: 'SearchResponse' }
          ),
        },
      },
    },
    async (req, reply) => {
      const term = classifySearchTerm(req.query.q);
      if (!term) {
        throw new InvalidRequestError(
          `The term is not a block or transaction hash, a block height, an address, a contract ` +
            `id, or an asset identifier. Hex terms need at least ${SEARCH_MIN_HASH_LENGTH} ` +
            `characters, addresses at least ${SEARCH_MIN_ADDRESS_LENGTH}, and contract or asset ` +
            `names at least ${SEARCH_MIN_NAME_LENGTH}.`,
          InvalidRequestErrorType.invalid_query
        );
      }
      const results = await fastify.db.v3.search({
        term,
        types: req.query.type ?? ALL_SEARCH_ENTITY_TYPES,
      });
      await reply.send({ results: results.map(hit => serializeDbSearchHit(hit)) });
    }
  );

  await Promise.resolve();
};
