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

export const BnsNameRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/:name/zonefile/:zoneFileHash',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_historical_zone_file',
        summary: 'Get Historical Zone File',
        description: `Retrieves the historical zonefile specified by the username and zone hash.`,
        tags: ['Names'],
        params: Type.Object({
          name: Type.String({ description: 'fully-qualified name', examples: ['muneeb.id'] }),
          zoneFileHash: Type.String({
            description: 'zone file hash',
            examples: ['b100a68235244b012854a95f9114695679002af9'],
          }),
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Object(
            {
              zonefile: Type.String(),
            },
            {
              title: 'BnsFetchHistoricalZoneFileResponse',
              description:
                'Fetches the historical zonefile specified by the username and zone hash.',
            }
          ),
          '4xx': Type.Object({ error: Type.String() }, { title: 'BnsError', description: 'Error' }),
        },
      },
    },
    async (req, reply) => {
      const { name, zoneFileHash } = req.params;
      const includeUnanchored = req.query.unanchored ?? false;
      const zonefile = await fastify.db.getHistoricalZoneFile({
        name: name,
        zoneFileHash: zoneFileHash,
        includeUnanchored,
        chainId: fastify.chainId,
      });
      if (zonefile.found) {
        await reply.send(zonefile.result);
      } else {
        await reply.status(404).send({ error: 'No such name or zonefile' });
      }
    }
  );

  fastify.get(
    '/:name/subdomains',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'fetch_subdomains_list_for_name',
        summary: 'Get Name Subdomains',
        description: `Retrieves the list of subdomains for a specific name`,
        tags: ['Names'],
        params: Type.Object({
          name: Type.String({ description: 'fully-qualified name', examples: ['id.blockstack'] }),
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Array(Type.String(), {
            title: 'GetAllSubdomainsInName',
            description: 'Fetch a list of subdomains in a name.',
            examples: [
              [
                'address_test.id.blockstack',
                'previous_subdomain.id.blockstack',
                'subdomain.id.blockstack',
                'zonefile_test.id.blockstack',
                'zone_test.id.blockstack',
              ],
            ],
          }),
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params;
      const includeUnanchored = req.query.unanchored ?? false;
      const subdomainsList = await fastify.db.getSubdomainsListInName({
        name,
        includeUnanchored,
        chainId: fastify.chainId,
      });
      await reply.send(subdomainsList.results);
    }
  );

  fastify.get(
    '/:name/zonefile',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'fetch_zone_file',
        summary: 'Get Zone File',
        description: `Retrieves a user's raw zone file. This only works for RFC-compliant zone files. This method returns an error for names that have non-standard zone files.`,
        tags: ['Names'],
        params: Type.Object({
          name: Type.String({ description: 'fully-qualified name', examples: ['bar.test'] }),
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Object(
            {
              zonefile: Type.String({
                examples: [
                  '$ORIGIN bar.test\n$TTL 3600\n_https._tcp URI 10 1 "https://gaia.blockstack.org/hub/17Zijx61Sp7SbVfRTdETo7PhizJHYEUxbY/profile.json"\n',
                ],
              }),
            },
            {
              title: 'BnsFetchFileZoneResponse',
              description:
                "Fetch a user's raw zone file. This only works for RFC-compliant zone files. This method returns an error for names that have non-standard zone files.",
            }
          ),
          '4xx': Type.Object(
            {
              error: Type.String({
                examples: ['Invalid name or subdomain', 'No zone file for name'],
              }),
            },
            {
              title: 'BnsError',
              description: 'Error',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params;
      const includeUnanchored = req.query.unanchored ?? false;
      const zonefile = await fastify.db.getLatestZoneFile({ name: name, includeUnanchored });
      if (zonefile.found) {
        await reply.send(zonefile.result);
      } else {
        await reply.status(404).send({ error: 'No such name or zonefile does not exist' });
      }
    }
  );

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
      const { results } = await fastify.db.getNamesList({ page, includeUnanchored });
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
        description: `Retrieves details of a given name including the \`address\`, \`status\` and last transaction id - \`last_txid\`.`,
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
              address: Type.String(),
              blockchain: Type.String({ examples: ['stacks'] }),
              expire_block: Type.Optional(Type.Integer({ minimum: 0 })),
              grace_period: Type.Optional(Type.Integer({ minimum: 0 })),
              last_txid: Type.String(),
              resolver: Type.Optional(Type.String()),
              status: Type.String(),
              zonefile: Type.Optional(Type.String()),
              zonefile_hash: Type.String(),
            },
            {
              title: 'BnsGetNameInfoResponse',
              description: 'Get name details',
              examples: [
                {
                  address: '1J3PUxY5uDShUnHRrMyU6yKtoHEUPhKULs',
                  blockchain: 'stacks',
                  expire_block: 599266,
                  grace_period: false,
                  last_txid: '1edfa419f7b83f33e00830bc9409210da6c6d1db60f99eda10c835aa339cad6b',
                  renewal_deadline: 604266,
                  resolver: null,
                  status: 'registered',
                  zonefile:
                    '$ORIGIN muneeb.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://gaia.blockstack.org/hub/1J3PUxY5uDShUnHRrMyU6yKtoHEUPhKULs/0/profile.json"\n',
                  zonefile_hash: '37aecf837c6ae9bdc9dbd98a268f263dacd00361',
                },
              ],
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params;
      const includeUnanchored = req.query.unanchored ?? false;

      await fastify.db
        .sqlTransaction(async sql => {
          // Subdomain case
          if (name.split('.').length == 3) {
            const subdomainQuery = await fastify.db.getSubdomain({
              subdomain: name,
              includeUnanchored,
              chainId: fastify.chainId,
            });
            if (!subdomainQuery.found) {
              const namePart = name.split('.').slice(1).join('.');
              const resolverResult = await fastify.db.getSubdomainResolver({ name: namePart });
              if (resolverResult.found) {
                if (resolverResult.result === '') {
                  throw { error: `missing resolver from a malformed zonefile` };
                }
                throw new NameRedirectError(`${resolverResult.result}${req.url}`);
              }
              throw { error: `cannot find subdomain ${name}` };
            }
            const { result } = subdomainQuery;

            const nameInfoResponse = {
              address: result.owner,
              blockchain: bnsBlockchain,
              last_txid: result.tx_id,
              resolver: result.resolver,
              status: 'registered_subdomain',
              zonefile: result.zonefile,
              zonefile_hash: result.zonefile_hash,
            };
            const response = Object.fromEntries(
              Object.entries(nameInfoResponse).filter(([_, v]) => v != null)
            ) as typeof nameInfoResponse;
            await reply.send(response);
          } else {
            const nameQuery = await fastify.db.getName({
              name,
              includeUnanchored: includeUnanchored,
            });
            if (!nameQuery.found) {
              throw { error: `cannot find name ${name}` };
            }
            const { result } = nameQuery;
            const nameInfoResponse = {
              address: result.address,
              blockchain: bnsBlockchain,
              expire_block: result.expire_block,
              grace_period: result.grace_period,
              last_txid: result.tx_id ? result.tx_id : '',
              resolver: result.resolver,
              status: result.status ? result.status : '',
              zonefile: result.zonefile,
              zonefile_hash: result.zonefile_hash,
            };
            const response = Object.fromEntries(
              Object.entries(nameInfoResponse).filter(([_, v]) => v != null)
            ) as typeof nameInfoResponse;
            await reply.send(response);
          }
        })
        .catch(async error => {
          if (error instanceof NameRedirectError) {
            await reply.redirect(error.message);
          } else {
            await reply.status(404).send(error);
          }
        });
    }
  );

  await Promise.resolve();
};
