import { parsePagingQueryInput } from '../../../api/pagination';
import { bnsBlockchain, BnsErrors } from '../../../event-stream/bns/bns-constants';
import { handleChainTipCache } from '../../../api/controllers/cache-controller';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { UnanchoredParamSchema } from '../../schemas/params';

class NameRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = this.constructor.name;
  }
}

export const BnsV2NameRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_all_names',
        summary: 'Get All Names',
        description: `Retrieves a list of all names known to the node.`,
        tags: ['Names'],
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
          page: Type.Optional(
            Type.Integer({
              minimum: 0,
              default: 0,
              description:
                "names are defaulted to page 1 with 100 results. You can query specific page results by using the 'page' query parameter.",
            })
          ),
        }),
        response: {
          200: Type.Array(Type.String(), {
            title: 'BnsGetAllNamesResponse',
            description: 'Fetch a list of all names known to the node.',
            examples: [
              'aldenquimby.id',
              'aldeoryn.id',
              'alderete.id',
              'aldert.id',
              'aldi.id',
              'aldighieri.id',
            ],
          }),
          '4xx': Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const page = parsePagingQueryInput(req.query.page ?? 0);
      const includeUnanchored = req.query.unanchored ?? false;
      const { results } = await fastify.db.getNamesV2List({ page, includeUnanchored });
      if (results.length === 0 && req.query.page) {
        await reply.status(400).send(BnsErrors.InvalidPageNumber);
      } else {
        await reply.send(results);
      }
    }
  );

  fastify.get(
    '/:name',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_name_info',
        summary: 'Get Name Details',
        description: `Retrieves all details of a given name from the BNS V2 system.`,
        tags: ['Names'],
        params: Type.Object({
          name: Type.String({ description: 'fully-qualified name', examples: ['muneeb.id'] }),
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Object(
            {
              id: Type.Optional(Type.Integer()),
              fullName: Type.String(),
              name: Type.String(),
              namespace_id: Type.String(),
              registered_at: Type.Optional(Type.Integer()),
              imported_at: Type.Optional(Type.Integer()),
              hashed_salted_fqn_preorder: Type.Optional(Type.String()),
              preordered_by: Type.Optional(Type.String()),
              renewal_height: Type.Integer(),
              stx_burn: Type.Integer(),
              owner: Type.String(),
            },
            {
              title: 'BnsGetNameInfoResponseV2',
              description: 'Get name details for BNS V2',
            }
          ),
          404: Type.Object({ error: Type.String() }, { description: 'Name not found' }),
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params;
      const includeUnanchored = req.query.unanchored ?? false;

      const nameQuery = await fastify.db.getNameV2({
        name,
        includeUnanchored,
      });
      if (!nameQuery.found) {
        return reply.status(404).send({ error: `cannot find name ${name}` });
      }

      const { result } = nameQuery;
      const nameInfoResponse = {
        ...result,
        blockchain: bnsBlockchain,
      };

      await reply.send(nameInfoResponse);
    }
  );

  await Promise.resolve();
};
