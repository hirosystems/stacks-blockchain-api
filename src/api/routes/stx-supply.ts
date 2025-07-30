import BigNumber from 'bignumber.js';
import { microStxToStx, STACKS_DECIMAL_PLACES, TOTAL_STACKS_YEAR_2050 } from '../../helpers';
import { handleChainTipCache } from '../controllers/cache-controller';

import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { UnanchoredParamSchema } from '../schemas/params';

export const StxSupplyRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  async function getStxSupplyInfo(
    args:
      | {
          blockHeight: number;
        }
      | {
          includeUnanchored: boolean;
        }
  ): Promise<{
    unlockedPercent: string;
    totalStx: string;
    totalStxYear2050: string;
    unlockedStx: string;
    blockHeight: number;
  }> {
    const { stx: unlockedSupply, blockHeight } = await fastify.db.getUnlockedStxSupply(args);
    const totalMicroStx = unlockedSupply;
    const totalMicroStxYear2050 = new BigNumber(TOTAL_STACKS_YEAR_2050).shiftedBy(
      STACKS_DECIMAL_PLACES
    );
    const unlockedPercent = new BigNumber(unlockedSupply.toString())
      .div(new BigNumber(totalMicroStx.toString()))
      .times(100)
      .toFixed(2);
    return {
      unlockedPercent,
      totalStx: microStxToStx(totalMicroStx),
      totalStxYear2050: microStxToStx(totalMicroStxYear2050),
      unlockedStx: microStxToStx(unlockedSupply),
      blockHeight: blockHeight,
    };
  }

  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_stx_supply',
        summary: 'Get total and unlocked STX supply',
        description: `Retrieves the total and unlocked STX supply. More information on Stacking can be found [here] (https://docs.stacks.co/understand-stacks/stacking).`,
        tags: ['Info'],
        querystring: Type.Object({
          height: Type.Optional(
            Type.Integer({
              minimum: 0,
              title: 'Block height',
              description:
                'Supply details are queried from specified block height. If the block height is not specified, the latest block height is taken as default value. Note that the `block height` is referred to the stacks blockchain.',
              examples: [777678],
            })
          ),
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Object(
            {
              unlocked_percent: Type.String({
                description:
                  'String quoted decimal number of the percentage of STX that have unlocked',
              }),
              total_stx: Type.String({
                description:
                  'String quoted decimal number of the total circulating number of STX (at the input block height if provided, otherwise the current block height)',
              }),
              total_stx_year_2050: Type.String({
                description:
                  'String quoted decimal number of total circulating STX supply in year 2050. STX supply grows approx 0.3% annually thereafter in perpetuity.',
              }),
              unlocked_stx: Type.String({
                description:
                  'String quoted decimal number of the STX that have been mined or unlocked',
              }),
              block_height: Type.Integer({
                description: 'The block height at which this information was queried',
              }),
            },
            {
              title: 'GetStxSupplyResponse',
              description: 'GET request that returns network target block times',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const blockHeight = req.query.height;
      const supply = await getStxSupplyInfo(
        blockHeight !== undefined
          ? { blockHeight }
          : { includeUnanchored: req.query.unanchored ?? false }
      );
      await reply.send({
        unlocked_percent: supply.unlockedPercent,
        total_stx: supply.totalStx,
        total_stx_year_2050: supply.totalStxYear2050,
        unlocked_stx: supply.unlockedStx,
        block_height: supply.blockHeight,
      });
    }
  );

  fastify.get(
    '/total/plain',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_stx_supply_total_supply_plain',
        summary: 'Get total STX supply in plain text format',
        description: `Retrieves the total circulating STX token supply as plain text.`,
        tags: ['Info'],
        response: {
          200: {
            content: {
              'text/plain': {
                type: 'string',
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const supply = await getStxSupplyInfo({ includeUnanchored: false });
      await reply.type('text/plain').send(supply.totalStx);
    }
  );

  fastify.get(
    '/circulating/plain',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_stx_supply_circulating_plain',
        summary: 'Get circulating STX supply in plain text format',
        description: `Retrieves the STX tokens currently in circulation that have been unlocked as plain text.`,
        tags: ['Info'],
        response: {
          200: {
            content: {
              'text/plain': {
                type: 'string',
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const supply = await getStxSupplyInfo({ includeUnanchored: false });
      await reply.type('text/plain').send(supply.unlockedStx);
    }
  );

  fastify.get(
    '/legacy_format',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_total_stx_supply_legacy_format',
        summary:
          'Get total and unlocked STX supply (results formatted the same as the legacy 1.0 API)',
        description: `Retrieves total supply of STX tokens including those currently in circulation that have been unlocked.`,
        tags: ['Info'],
        querystring: Type.Object({
          height: Type.Optional(
            Type.Integer({
              minimum: 0,
              title: 'Block height',
              description:
                'Supply details are queried from specified block height. If the block height is not specified, the latest block height is taken as default value. Note that the `block height` is referred to the stacks blockchain.',
              examples: [777678],
            })
          ),
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Object(
            {
              unlockedPercent: Type.String({
                description:
                  'String quoted decimal number of the percentage of STX that have unlocked',
              }),
              totalStacks: Type.String({
                description:
                  'String quoted decimal number of the total circulating number of STX (at the input block height if provided, otherwise the current block height)',
              }),
              totalStacksFormatted: Type.String({
                description: 'Same as `totalStacks` but formatted with comma thousands separators',
              }),
              totalStacksYear2050: Type.String({
                description:
                  'String quoted decimal number of total circulating STX supply in year 2050. STX supply grows approx 0.3% annually thereafter in perpetuity.',
              }),
              totalStacksYear2050Formatted: Type.String({
                description:
                  'Same as `totalStacksYear2050` but formatted with comma thousands separators',
              }),
              unlockedSupply: Type.String({
                description:
                  'String quoted decimal number of the STX that have been mined or unlocked',
              }),
              unlockedSupplyFormatted: Type.String({
                description:
                  'Same as `unlockedSupply` but formatted with comma thousands separators',
              }),
              blockHeight: Type.String({
                description: 'The block height at which this information was queried',
              }),
            },
            {
              title: 'GetStxSupplyLegacyFormatResponse',
              description: 'GET request that returns network target block times',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const blockHeight = req.query.height;
      const supply = await getStxSupplyInfo(
        blockHeight !== undefined
          ? { blockHeight }
          : { includeUnanchored: req.query.unanchored ?? false }
      );
      await reply.send({
        unlockedPercent: supply.unlockedPercent,
        totalStacks: supply.totalStx,
        totalStacksFormatted: new BigNumber(supply.totalStx).toFormat(STACKS_DECIMAL_PLACES, 8),
        totalStacksYear2050: supply.totalStxYear2050,
        totalStacksYear2050Formatted: new BigNumber(supply.totalStxYear2050).toFormat(
          STACKS_DECIMAL_PLACES,
          8
        ),
        unlockedSupply: supply.unlockedStx,
        unlockedSupplyFormatted: new BigNumber(supply.unlockedStx).toFormat(
          STACKS_DECIMAL_PLACES,
          8
        ),
        blockHeight: supply.blockHeight.toString(),
      });
    }
  );

  await Promise.resolve();
};
