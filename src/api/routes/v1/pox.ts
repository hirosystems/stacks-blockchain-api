import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../../pagination.js';
import { parsePox4SyntheticEvent } from '../../controllers/db-controller.js';
import { getBlockParams, validatePrincipal, validateRequestHexInput } from '../../query-helpers.js';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import {
  LimitParam,
  OffsetParam,
  PrincipalSchema,
  UnanchoredParamSchema,
} from '../../schemas/v1/params.js';
import { NotFoundError } from '../../../errors.js';
import { PaginatedResponse } from '../../schemas/v1/util.js';
import { PoolDelegation, PoolDelegationSchema } from '../../schemas/v1/entities/pox.js';

/**
 * Shared opening line for the deprecation notices below: every route in this file reads the
 * `pox2_events` / `pox3_events` / `pox4_events` tables and has no pox-5 counterpart. What follows
 * it differs per route — two have a partial pox-5 equivalent, two have none, so the rest of each
 * message is written inline at the route.
 *
 * These strings reach consumers in the `Warning` header, and in the `410 Gone` body once
 * `ENABLE_DEPRECATED_ENDPOINTS` is turned off, so they are plain text rather than markdown.
 */
const HISTORICAL = 'Historical pox-4 and earlier data only.';

export const PoxEventRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get('/*', { schema: { hide: true } }, async (req, reply) => {
    // Redirect old pox routes, e.g. /poxX_events to /poxX/events
    const redirectUrl = req.url.replace(/\/(pox4)_events(\/|$)/, (_, p1, p2) =>
      p2 === '/' ? `/${p1}${p2}` : `/${p1}/events`
    );
    return reply.redirect(redirectUrl);
  });
  await Promise.resolve();
};

export const PoxRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const poxTables = {
    pox2: 'pox2_events',
    pox3: 'pox3_events',
    pox4: 'pox4_events',
  } as const;

  fastify.get(
    '/events',
    {
      preHandler: handleChainTipCache,
      schema: {
        // operationId: '',
        deprecated: true,
        deprecatedMessage: `${HISTORICAL} No pox-5 replacement; there is no global pox-5 event feed.`,
        summary: 'Get latest PoX events',
        description: `Retrieves the most recent PoX events. **Deprecated:** ${HISTORICAL} No pox-5 replacement; there is no global pox-5 event feed.`,
        tags: ['Stacking'],
        params: Type.Object({
          pox: Type.Enum({ pox2: 'pox2', pox3: 'pox3', pox4: 'pox4' }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Pox2Event),
          offset: OffsetParam(),
        }),
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Pox2Event, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const poxTable = poxTables[req.params.pox];

      const queryResults = await fastify.db.getPoxSyntheticEvents({
        offset,
        limit,
        poxTable,
      });
      const parsedResult = queryResults.map(r => parsePox4SyntheticEvent(r));
      const response = {
        limit,
        offset,
        results: parsedResult,
      };
      await reply.send(response);
    }
  );

  fastify.get(
    '/tx/:tx_id',
    {
      preHandler: handleChainTipCache,
      schema: {
        // operationId: '',
        deprecated: true,
        deprecatedMessage: `${HISTORICAL} No pox-5 replacement; v3 transaction events do not carry decoded pox operations.`,
        summary: 'Get PoX events for a transaction',
        description: `Retrieves the PoX events produced by a given transaction. **Deprecated:** ${HISTORICAL} No pox-5 replacement; v3 transaction events do not carry decoded pox operations.`,
        tags: ['Stacking'],
        params: Type.Object({
          pox: Type.Enum({ pox2: 'pox2', pox3: 'pox3', pox4: 'pox4' }),
          tx_id: Type.String(),
        }),
      },
    },
    async (req, reply) => {
      const { tx_id } = req.params;
      const poxTable = poxTables[req.params.pox];
      validateRequestHexInput(tx_id);
      const queryResults = await fastify.db.getPoxSyntheticEventsForTx({
        txId: tx_id,
        poxTable,
      });
      if (!queryResults.found) {
        throw new NotFoundError(`could not find transaction by ID`);
      }
      const parsedResult = queryResults.result.map(r => parsePox4SyntheticEvent(r));
      const response = {
        results: parsedResult,
      };
      await reply.send(response);
    }
  );

  fastify.get(
    '/stacker/:principal',
    {
      preHandler: handleChainTipCache,
      schema: {
        // operationId: '',
        deprecated: true,
        deprecatedMessage: `${HISTORICAL} For a principal's current pox-5 position see /extended/v3/principals/{principal}/staking; there is no pox-5 event history equivalent.`,
        summary: 'Get events for a stacking address',
        description: `Retrieves the PoX events for a given stacker principal. **Deprecated:** ${HISTORICAL} For a principal's current pox-5 position see /extended/v3/principals/{principal}/staking; there is no pox-5 event history equivalent.`,
        tags: ['Stacking'],
        params: Type.Object({
          pox: Type.Enum({ pox2: 'pox2', pox3: 'pox3', pox4: 'pox4' }),
          principal: PrincipalSchema,
        }),
      },
    },
    async (req, reply) => {
      const { principal } = req.params;
      const poxTable = poxTables[req.params.pox];
      validatePrincipal(principal);
      const queryResults = await fastify.db.getPoxSyntheticEventsForStacker({
        principal,
        poxTable,
      });
      if (!queryResults.found) {
        throw new NotFoundError(`could not find principal`);
      }
      const parsedResult = queryResults.result.map(r => parsePox4SyntheticEvent(r));
      const response = {
        results: parsedResult,
      };
      await reply.send(response);
    }
  );

  fastify.get(
    '/:pool_principal/delegations',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_pool_delegations',
        deprecated: true,
        deprecatedMessage: `${HISTORICAL} See /extended/v3/staking/signers/{principal}/stakers for the pox-5 equivalent.`,
        summary: 'Stacking pool members',
        description: `Retrieves the list of stacking pool members for a given delegator principal. **Deprecated:** ${HISTORICAL} See /extended/v3/staking/signers/{principal}/stakers for the pox-5 equivalent.`,
        tags: ['Stacking'],
        params: Type.Object({
          pox: Type.Enum({ pox2: 'pox2', pox3: 'pox3', pox4: 'pox4' }),
          pool_principal: Type.String({
            description: 'Address principal of the stacking pool delegator',
            examples: ['SPSCWDV3RKV5ZRN1FQD84YE1NQFEDJ9R1F4DYQ11'],
          }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Stacker),
          offset: OffsetParam(),
          after_block: Type.Optional(
            Type.Integer({
              minimum: 1,
              description:
                'If specified, only delegation events after the given block will be included',
            })
          ),
          height: Type.Optional(Type.Integer({ minimum: 1 })),
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: PaginatedResponse(PoolDelegationSchema),
        },
      },
    },
    async (req, reply) => {
      // get recent asset event associated with address
      const poolPrincipal = req.params.pool_principal;
      validatePrincipal(poolPrincipal);

      const poxTable = poxTables[req.params.pox];

      const limit = getPagingQueryLimit(ResourceType.Stacker, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const afterBlock = req.query.after_block ?? 0;

      const response = await fastify.db.sqlTransaction(async sql => {
        const blockParams = getBlockParams(req.query.height, req.query.unanchored);
        let blockHeight: number;
        if (blockParams.blockHeight !== undefined) {
          blockHeight = blockParams.blockHeight;
        } else {
          blockHeight = await fastify.db.getMaxBlockHeight(sql, {
            includeUnanchored: blockParams.includeUnanchored ?? false,
          });
        }

        const dbBlock = await fastify.db.getBlockByHeightInternal(sql, blockHeight);
        if (!dbBlock.found) {
          throw new NotFoundError(`no block at height: ${blockHeight}`);
        }
        const burnBlockHeight = dbBlock.result.burn_block_height;

        const stackersQuery = await fastify.db.getPoxPoolDelegations({
          delegator: poolPrincipal,
          blockHeight,
          burnBlockHeight,
          afterBlockHeight: afterBlock,
          limit,
          offset,
          poxTable,
        });
        if (!stackersQuery.found) {
          throw new NotFoundError(`no stackers found`);
        }
        const results: PoolDelegation[] = stackersQuery.result.stackers;
        return {
          limit,
          offset,
          total: stackersQuery.result.total,
          results,
        };
      });

      await reply.send(response);
    }
  );

  await Promise.resolve();
};
