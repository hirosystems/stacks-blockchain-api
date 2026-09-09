import { parsePagingQueryInput } from '../../../pagination.js';
import { BnsErrors } from '../../../../event-stream/bns/bns-constants.js';
import { handleChainTipCache } from '../../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { BNS_DEPRECATION_MESSAGE, BNS_DEPRECATION_NOTE } from './deprecation.js';

export const BnsNamespaceRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_all_namespaces',
        deprecated: true,
        deprecatedMessage: BNS_DEPRECATION_MESSAGE,
        summary: 'Get All Namespaces',
        description: `Retrieves a list of all namespaces known to the node. ${BNS_DEPRECATION_NOTE}`,
        tags: ['Names'],
        querystring: Type.Object({}),
        response: {
          200: Type.Object({
            namespaces: Type.Array(Type.String(), {
              title: 'BnsGetAllNamespacesResponse',
              description: 'Fetch a list of all namespaces known to the node.',
            }),
          }),
        },
      },
    },
    async (_req, reply) => {
      const { results } = await fastify.db.getNamespaceList();
      const response = {
        namespaces: results,
      };
      await reply.send(response);
    }
  );

  fastify.get(
    '/:tld/names',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_namespace_names',
        deprecated: true,
        deprecatedMessage: BNS_DEPRECATION_MESSAGE,
        summary: 'Get Namespace Names',
        description: `Retrieves a list of names within a given namespace. ${BNS_DEPRECATION_NOTE}`,
        tags: ['Names'],
        params: Type.Object({
          tld: Type.String({ description: 'the namespace to fetch names from.', examples: ['id'] }),
        }),
        querystring: Type.Object({
          page: Type.Optional(
            Type.Number({
              description:
                "namespace values are defaulted to page 1 with 100 results. You can query specific page results by using the 'page' query parameter.",
              examples: [22],
            })
          ),
        }),
        response: {
          200: Type.Array(Type.String(), {
            title: 'BnsGetAllNamespacesNamesResponse',
            description: 'Fetch a list of names from the namespace.',
            examples: [
              [
                'aldenquimby.id',
                'aldeoryn.id',
                'alderete.id',
                'aldert.id',
                'aldi.id',
                'aldighieri.id',
              ],
            ],
          }),
          '4xx': Type.Record(Type.String(), Type.String()),
        },
      },
    },
    async (req, reply) => {
      const { tld } = req.params;
      const page = parsePagingQueryInput(req.query.page ?? 0);
      await fastify.db
        .sqlTransaction(async _sql => {
          const response = await fastify.db.getNamespace({ namespace: tld });
          if (!response.found) {
            throw BnsErrors.NoSuchNamespace;
          } else {
            const { results } = await fastify.db.getNamespaceNamesList({
              namespace: tld,
              page,
            });
            if (results.length === 0 && req.query.page) {
              throw BnsErrors.InvalidPageNumber;
            } else {
              return results;
            }
          }
        })
        .then(async results => {
          await reply.send(results);
        })
        .catch(async error => {
          await reply.status(400).send(error);
        });
    }
  );

  await Promise.resolve();
};
