import { parsePagingQueryInput } from '../../../api/pagination';
import { BnsErrors } from '../../../event-stream/bns/bns-constants';
import { handleChainTipCache } from '../../../api/controllers/cache-controller';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { UnanchoredParamSchema } from '../../schemas/params';

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
        summary: 'Get All Namespaces',
        description: `Retrieves a list of all namespaces known to the node.`,
        tags: ['Names'],
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
        }),
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
    async (req, reply) => {
      const includeUnanchored = req.query.unanchored ?? false;
      const { results } = await fastify.db.getNamespaceList({ includeUnanchored });
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
        summary: 'Get Namespace Names',
        description: `Retrieves a list of names within a given namespace.`,
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
          unanchored: UnanchoredParamSchema,
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
        },
      },
    },
    async (req, reply) => {
      const { tld } = req.params;
      const page = parsePagingQueryInput(req.query.page ?? 0);
      const includeUnanchored = req.query.unanchored ?? false;
      await fastify.db
        .sqlTransaction(async sql => {
          const response = await fastify.db.getNamespace({ namespace: tld, includeUnanchored });
          if (!response.found) {
            throw BnsErrors.NoSuchNamespace;
          } else {
            const { results } = await fastify.db.getNamespaceNamesList({
              namespace: tld,
              page,
              includeUnanchored,
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
