import { parsePagingQueryInput } from '../../../api/pagination';
import { BnsErrors } from '../../../event-stream/bns/bns-constants';
import { handleChainTipCache } from '../../../api/controllers/cache-controller';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { UnanchoredParamSchema } from '../../schemas/params';

export const BnsV2NamespaceRoutes: FastifyPluginAsync<
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
      const { results } = await fastify.db.getNamespacesV2List({ includeUnanchored });
      const response = {
        namespaces: results,
      };
      await reply.send(response);
    }
  );

  fastify.get(
    '/:tld',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_namespace_info',
        summary: 'Get Namespace Details',
        description: `Retrieves details of a given namespace.`,
        tags: ['Names'],
        params: Type.Object({
          tld: Type.String({ description: 'the namespace to fetch', examples: ['id'] }),
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Object(
            {
              namespace_id: Type.String(),
              namespace_manager: Type.Optional(Type.String()),
              manager_transferable: Type.Boolean(),
              manager_frozen: Type.Boolean(),
              namespace_import: Type.String(),
              reveal_block: Type.Integer(),
              launched_at: Type.Optional(Type.Integer()),
              launch_block: Type.Integer(),
              lifetime: Type.Integer(),
              can_update_price_function: Type.Boolean(),
              buckets: Type.String(),
              base: Type.String(),
              coeff: Type.String(),
              nonalpha_discount: Type.String(),
              no_vowel_discount: Type.String(),
              status: Type.Optional(Type.String()),
            },
            {
              title: 'BnsGetNamespaceInfoResponse',
              description: 'Get namespace details',
            }
          ),
          404: Type.Object({ error: Type.String() }, { description: 'Namespace not found' }),
        },
      },
    },
    async (req, reply) => {
      const { tld } = req.params;
      const includeUnanchored = req.query.unanchored ?? false;

      const namespaceQuery = await fastify.db.getNamespaceV2({
        namespace: tld,
        includeUnanchored,
      });

      if (!namespaceQuery.found) {
        return reply.status(404).send({ error: `cannot find namespace ${tld}` });
      }

      const result = {
        ...namespaceQuery.result,
        base: namespaceQuery.result.base.toString(),
        coeff: namespaceQuery.result.coeff.toString(),
        nonalpha_discount: namespaceQuery.result.nonalpha_discount.toString(),
        no_vowel_discount: namespaceQuery.result.no_vowel_discount.toString(),
      };

      await reply.send(result);
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
          const response = await fastify.db.getNamespaceV2({ namespace: tld, includeUnanchored });
          if (!response.found) {
            throw BnsErrors.NoSuchNamespace;
          } else {
            const { results } = await fastify.db.getNamespacesV2NamesList({
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
