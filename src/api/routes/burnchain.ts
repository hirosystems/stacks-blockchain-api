import { isValidBitcoinAddress, tryConvertC32ToBtc } from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import { getPagingQueryLimit, ResourceType } from '../pagination';

import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam } from '../schemas/params';
import { PaginatedResponse } from '../schemas/util';
import {
  BurnchainReward,
  BurnchainRewardSchema,
  BurnchainRewardSlotHolder,
  BurnchainRewardSlotHolderSchema,
  BurnchainRewardsTotal,
  BurnchainRewardsTotalSchema,
} from '../schemas/entities/burnchain-rewards';
import {
  BurnchainRewardListResponseSchema,
  BurnchainRewardSlotHolderListResponseSchema,
} from '../schemas/responses/responses';

export const BurnchainRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/reward_slot_holders',
    {
      schema: {
        operationId: 'get_burnchain_reward_slot_holders',
        summary: 'Get recent reward slot holders',
        description: `Retrieves a list of the Bitcoin addresses that would validly receive Proof-of-Transfer commitments.`,
        tags: ['Stacking Rewards'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Burnchain, 'Limit', 'max number of items to fetch'),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(BurnchainRewardSlotHolderSchema, {
            title: 'List of burnchain reward recipients and amounts',
          }),
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = req.query.offset ?? 0;

      const queryResults = await fastify.db.getBurnchainRewardSlotHolders({ offset, limit });
      const results = queryResults.slotHolders.map(r => {
        const slotHolder: BurnchainRewardSlotHolder = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          address: r.address,
          slot_index: r.slot_index,
        };
        return slotHolder;
      });
      await reply.send({
        limit,
        offset,
        total: queryResults.total,
        results: results,
      });
    }
  );

  fastify.get(
    '/reward_slot_holders/:address',
    {
      schema: {
        operationId: 'get_burnchain_reward_slot_holders_by_address',
        summary: 'Get recent reward slot holder entries for the given address',
        description: `Retrieves a list of the Bitcoin addresses that would validly receive Proof-of-Transfer commitments for a given reward slot holder recipient address.`,
        tags: ['Stacking Rewards'],
        params: Type.Object({
          address: Type.String({
            description: `Reward slot holder recipient address. Should either be in the native burnchain's format (e.g. B58 for Bitcoin), or if a STX principal address is provided it will be encoded as into the equivalent burnchain format`,
            examples: ['36hQtSEXBMevo5chpxhfAGiCTSC34QKgda'],
          }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Burnchain),
          offset: OffsetParam(),
        }),
        response: {
          200: BurnchainRewardSlotHolderListResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = req.query.offset ?? 0;
      const { address } = req.params;

      let burnchainAddress: string | undefined = undefined;
      const queryAddr = address.trim();
      if (isValidBitcoinAddress(queryAddr)) {
        burnchainAddress = queryAddr;
      } else {
        const convertedAddr = tryConvertC32ToBtc(queryAddr);
        if (convertedAddr) {
          burnchainAddress = convertedAddr;
        }
      }
      if (!burnchainAddress) {
        throw new InvalidRequestError(
          `Address ${queryAddr} is not a valid Bitcoin or STX address.`,
          InvalidRequestErrorType.invalid_address
        );
      }

      const queryResults = await fastify.db.getBurnchainRewardSlotHolders({
        offset,
        limit,
        burnchainAddress,
      });
      const results = queryResults.slotHolders.map(r => {
        const slotHolder: BurnchainRewardSlotHolder = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          address: r.address,
          slot_index: r.slot_index,
        };
        return slotHolder;
      });
      await reply.send({
        limit,
        offset,
        total: queryResults.total,
        results: results,
      });
    }
  );

  fastify.get(
    '/rewards',
    {
      schema: {
        operationId: 'get_burnchain_reward_list',
        summary: 'Get recent burnchain reward recipients',
        description: `Retrieves a list of recent burnchain (e.g. Bitcoin) reward recipients with the associated amounts and block info`,
        tags: ['Stacking Rewards'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Burnchain),
          offset: OffsetParam(),
        }),
        response: {
          200: BurnchainRewardListResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = req.query.offset ?? 0;

      const queryResults = await fastify.db.getBurnchainRewards({ offset, limit });
      const results = queryResults.map(r => {
        const reward: BurnchainReward = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          burn_amount: r.burn_amount.toString(),
          reward_recipient: r.reward_recipient,
          reward_amount: r.reward_amount.toString(),
          reward_index: r.reward_index,
        };
        return reward;
      });
      await reply.send({ limit, offset, results });
    }
  );

  fastify.get(
    '/rewards/:address',
    {
      schema: {
        operationId: 'get_burnchain_reward_list_by_address',
        summary: 'Get recent burnchain reward for the given recipient',
        description: `Retrieves a list of recent burnchain (e.g. Bitcoin) rewards for the given recipient with the associated amounts and block info`,
        tags: ['Stacking Rewards'],
        params: Type.Object({
          address: Type.String({
            description: `Reward recipient address. Should either be in the native burnchain's format (e.g. B58 for Bitcoin), or if a STX principal address is provided it will be encoded as into the equivalent burnchain format`,
            examples: ['36hQtSEXBMevo5chpxhfAGiCTSC34QKgda'],
          }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Burnchain),
          offset: OffsetParam(),
        }),
        response: {
          200: Type.Object(
            {
              limit: Type.Integer(),
              offset: Type.Integer(),
              results: Type.Array(BurnchainRewardSchema),
            },
            {
              description: 'List of burnchain reward recipients and amounts',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = req.query.offset ?? 0;
      const { address } = req.params;

      let burnchainAddress: string | undefined = undefined;
      const queryAddr = address.trim();
      if (isValidBitcoinAddress(queryAddr)) {
        burnchainAddress = queryAddr;
      } else {
        const convertedAddr = tryConvertC32ToBtc(queryAddr);
        if (convertedAddr) {
          burnchainAddress = convertedAddr;
        }
      }
      if (!burnchainAddress) {
        throw new InvalidRequestError(
          `Address is not a valid Bitcoin or STX address.`,
          InvalidRequestErrorType.invalid_address
        );
      }

      const queryResults = await fastify.db.getBurnchainRewards({
        burnchainRecipient: burnchainAddress,
        offset,
        limit,
      });
      const results = queryResults.map(r => {
        const reward: BurnchainReward = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          burn_amount: r.burn_amount.toString(),
          reward_recipient: r.reward_recipient,
          reward_amount: r.reward_amount.toString(),
          reward_index: r.reward_index,
        };
        return reward;
      });
      await reply.send({ limit, offset, results });
    }
  );

  fastify.get(
    '/rewards/:address/total',
    {
      schema: {
        operationId: 'get_burnchain_rewards_total_by_address',
        summary: 'Get total burnchain rewards for the given recipient',
        description: `Retrieves the total burnchain (e.g. Bitcoin) rewards for a given recipient \`address\``,
        tags: ['Stacking Rewards'],
        params: Type.Object({
          address: Type.String({
            description: `Reward recipient address. Should either be in the native burnchain's format (e.g. B58 for Bitcoin), or if a STX principal address is provided it will be encoded as into the equivalent burnchain format`,
            examples: ['36hQtSEXBMevo5chpxhfAGiCTSC34QKgda'],
          }),
        }),
        response: {
          200: BurnchainRewardsTotalSchema,
        },
      },
    },
    async (req, reply) => {
      const { address } = req.params;

      let burnchainAddress: string | undefined = undefined;
      const queryAddr = address.trim();
      if (isValidBitcoinAddress(queryAddr)) {
        burnchainAddress = queryAddr;
      } else {
        const convertedAddr = tryConvertC32ToBtc(queryAddr);
        if (convertedAddr) {
          burnchainAddress = convertedAddr;
        }
      }
      if (!burnchainAddress) {
        throw new InvalidRequestError(
          `Address ${queryAddr} is not a valid Bitcoin or STX address.`,
          InvalidRequestErrorType.invalid_address
        );
      }

      const queryResults = await fastify.db.getBurnchainRewardsTotal(burnchainAddress);
      const response: BurnchainRewardsTotal = {
        reward_recipient: queryResults.reward_recipient,
        reward_amount: queryResults.reward_amount.toString(),
      };
      await reply.send(response);
    }
  );

  await Promise.resolve();
};
