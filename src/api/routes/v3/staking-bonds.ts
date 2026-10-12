import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  BondCursorSchema,
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  EventPositionCursorSchema,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import {
  BondSchema,
  BondSummarySchema,
  ProjectedBondSchema,
} from '../../schemas/v3/entities/bonds.js';
import { BondEventSchema } from '../../schemas/v3/entities/bond-events.js';
import { BondAllowlistSchema } from '../../schemas/v3/entities/bond-allowlist-entries.js';
import { BondRegistrationSchema } from '../../schemas/v3/entities/bond-registrations.js';
import { BondRegistrationSummarySchema } from '../../schemas/v3/entities/bond-registration-summaries.js';
import { BondIndexSchema, PrincipalSchema } from '../../schemas/v3/entities/common.js';
import {
  getDbBondEventScheduleHeights,
  getDbBondScheduleHeights,
  getProjectedBondScheduleHeights,
  serializeDbBond,
  serializeDbBondAllowlistEntry,
  serializeDbBondEvent,
  serializeDbBondRegistration,
  serializeDbBondRegistrationSummary,
  serializeDbBondSummary,
  serializeProjectedBond,
} from '../../serializers/v3/bonds.js';
import { getBitcoinBlockTimeProjectionConfig } from '../../../datastore/bitcoin-block-time.js';
import {
  getPox5BondScheduleTerms,
  getPox5FirstBondPeriodCycle,
} from '../../../datastore/pox-constants.js';
import { NotFoundError } from '../../../errors.js';

export const StakingBondsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const projectionConfig = getBitcoinBlockTimeProjectionConfig(fastify.chainId);
  fastify.get(
    '/staking/bonds',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bonds',
        summary: 'Get bonds',
        description: 'Get bonds',
        tags: ['Staking'],
        querystring: CursorPaginationQuerystring(BondCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(BondSummarySchema, BondCursorSchema, ResourceType.Tx),
        },
      },
    },
    async (req, reply) => {
      const response = await fastify.db.sqlTransaction(async _sql => {
        const results = await fastify.db.v3.getBondSummaries({
          limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
          cursor: req.query.cursor,
        });
        const poxConstants = await fastify.db.getPoxConstants();
        const scheduleTimes = {
          times: await fastify.db.v3.getBitcoinBlockTimes(
            results.results.flatMap(r => getDbBondScheduleHeights(poxConstants, r)),
            projectionConfig.paceWindowBlocks
          ),
          config: projectionConfig,
        };
        return {
          limit: results.limit,
          total: results.total,
          cursor: {
            next: results.next_cursor,
            previous: results.prev_cursor,
            current: results.current_cursor,
          },
          results: results.results.map(r =>
            serializeDbBondSummary(r, results.burn_block_height, poxConstants, scheduleTimes)
          ),
        };
      });
      await reply.send(response);
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond',
        summary: 'Get bond',
        description:
          'Get a bond. A bond that has not been set up yet but still can be (its activation ' +
          'height is ahead of the chain tip) is returned with a `projected` status and only the ' +
          'schedule pox-5 will assign it, which follows from its index.',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: BondIndexSchema,
        }),
        response: {
          200: Type.Union([BondSchema, ProjectedBondSchema]),
        },
      },
    },
    async (req, reply) => {
      const response = await fastify.db.sqlTransaction(async _sql => {
        const bondIndex = req.params.bond_index;
        const bond = await fastify.db.v3.getBond({ bondIndex });
        const poxConstants = await fastify.db.getPoxConstants();
        if (!bond) {
          // Project the bond from its index, anchored on any set-up bond. Past its activation
          // height `setup-bond` can no longer create it, so it will never exist; neither can a
          // negative index, as pox-5 bond indexes are unsigned.
          if (bondIndex < 0) {
            throw new NotFoundError('Bond not found');
          }
          const anchor = await fastify.db.v3.getBondPeriodAnchor();
          if (!anchor) {
            throw new NotFoundError('Bond not found');
          }
          const terms = getPox5BondScheduleTerms(
            poxConstants,
            getPox5FirstBondPeriodCycle({
              bondIndex: anchor.bond_index,
              firstRewardCycle: anchor.first_reward_cycle,
            }),
            bondIndex
          );
          if (
            terms.bondStartHeight <= anchor.burn_block_height ||
            !Number.isSafeInteger(terms.unlockBurnHeight)
          ) {
            throw new NotFoundError('Bond not found');
          }
          const scheduleTimes = {
            times: await fastify.db.v3.getBitcoinBlockTimes(
              getProjectedBondScheduleHeights(poxConstants, terms),
              projectionConfig.paceWindowBlocks
            ),
            config: projectionConfig,
          };
          return serializeProjectedBond(bondIndex, poxConstants, scheduleTimes, terms);
        }
        const scheduleTimes = {
          times: await fastify.db.v3.getBitcoinBlockTimes(
            getDbBondScheduleHeights(poxConstants, bond),
            projectionConfig.paceWindowBlocks
          ),
          config: projectionConfig,
        };
        return serializeDbBond(bond, bond.burn_block_height, poxConstants, scheduleTimes);
      });
      await reply.send(response);
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/events',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond_events',
        summary: 'Get bond events',
        description:
          "A bond's pox-5 event log, newest first: setup, allowlist additions, registrations " +
          'and registration updates, early exits (`announce-l1-early-exit`, and `unstake-sbtc` ' +
          'with a `new_amount_sats` of 0), partial sBTC unstakes, reward distributions, and ' +
          'staker reward claims.',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: BondIndexSchema,
        }),
        querystring: CursorPaginationQuerystring(EventPositionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(BondEventSchema, EventPositionCursorSchema, ResourceType.Tx),
        },
      },
    },
    async (req, reply) => {
      const response = await fastify.db.sqlTransaction(async _sql => {
        const results = await fastify.db.v3.getBondEvents({
          bondIndex: req.params.bond_index,
          limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
          cursor: req.query.cursor,
        });
        const poxConstants = await fastify.db.getPoxConstants();
        const scheduleTimes = {
          times: await fastify.db.v3.getBitcoinBlockTimes(
            results.results.flatMap(r => getDbBondEventScheduleHeights(poxConstants, r)),
            projectionConfig.paceWindowBlocks
          ),
          config: projectionConfig,
        };
        return {
          limit: results.limit,
          total: results.total,
          cursor: {
            next: results.next_cursor,
            previous: results.prev_cursor,
            current: results.current_cursor,
          },
          results: results.results.map(r => serializeDbBondEvent(r, poxConstants, scheduleTimes)),
        };
      });
      await reply.send(response);
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/allowlist',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond_allowlist_entries',
        summary: 'Get bond allowlist entries',
        description: 'Get bond allowlist entries',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: BondIndexSchema,
        }),
        querystring: CursorPaginationQuerystring(TransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            BondAllowlistSchema,
            TransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getBondAllowlistEntries({
        bondIndex: req.params.bond_index,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializeDbBondAllowlistEntry(r)),
      });
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/allowlist/:principal',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond_allowlist_entry',
        summary: 'Get bond allowlist entry',
        description: 'Get bond allowlist entry',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: BondIndexSchema,
          principal: PrincipalSchema,
        }),
        response: {
          200: BondAllowlistSchema,
        },
      },
    },
    async (req, reply) => {
      const entry = await fastify.db.v3.getBondAllowlistEntry({
        bondIndex: req.params.bond_index,
        principal: req.params.principal,
      });
      if (!entry) {
        throw new NotFoundError('Bond allowlist entry not found');
      }
      await reply.send(serializeDbBondAllowlistEntry(entry));
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/registrations',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond_registrations',
        summary: 'Get bond registrations',
        description: 'Get bond registrations',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: BondIndexSchema,
        }),
        querystring: CursorPaginationQuerystring(TransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            BondRegistrationSummarySchema,
            TransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getBondRegistrationSummaries({
        bondIndex: req.params.bond_index,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializeDbBondRegistrationSummary(r)),
      });
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/registrations/:principal',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond_registration',
        summary: 'Get bond registration',
        description: 'Get bond registration',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: BondIndexSchema,
          principal: PrincipalSchema,
        }),
        response: {
          200: BondRegistrationSchema,
        },
      },
    },
    async (req, reply) => {
      const registration = await fastify.db.v3.getBondRegistration({
        bondIndex: req.params.bond_index,
        principal: req.params.principal,
      });
      if (!registration) {
        throw new NotFoundError('Bond registration not found');
      }
      await reply.send(serializeDbBondRegistration(registration));
    }
  );

  await Promise.resolve();
};
