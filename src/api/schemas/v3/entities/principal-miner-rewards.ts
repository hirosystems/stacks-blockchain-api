import { Static, Type } from '@sinclair/typebox';
import { AmountSchema, BlockSummarySchema, PrincipalSchema } from './common.js';

const MinerRewardFeesSchema = Type.String({
  ...AmountSchema,
  description: 'Transaction fees included in the reward, in µSTX',
});

export const PrincipalMinerRewardSchema = Type.Object(
  {
    id: Type.String({
      pattern: '^0x[0-9a-fA-F]{64}:[0-9]+$',
      description:
        'Stable reward identifier: the index block hash of the block the reward matured in, ' +
        'followed by the reward position within that block. A block can mature more than one ' +
        'reward for the same recipient (its own miner reward plus its parent-miner share of ' +
        'fees).',
      examples: ['0x6b2c809627f2fd19991d8eb6ae034cb4cce1e1fc714aa77351506b9af1b2eb3b:0'],
    }),
    recipient: PrincipalSchema,
    miner: PrincipalSchema,
    block: BlockSummarySchema,
    source_block: BlockSummarySchema,
    coinbase: AmountSchema,
    fees: MinerRewardFeesSchema,
    total: AmountSchema,
  },
  { title: 'PrincipalMinerReward' }
);
export type PrincipalMinerReward = Static<typeof PrincipalMinerRewardSchema>;

export const PrincipalMiningSummarySchema = Type.Object(
  {
    rewards: Type.Object({
      count: Type.Integer({ description: 'Number of non-zero matured miner rewards received' }),
      coinbase: AmountSchema,
      fees: MinerRewardFeesSchema,
      total: AmountSchema,
    }),
  },
  { title: 'PrincipalMiningSummary' }
);
export type PrincipalMiningSummary = Static<typeof PrincipalMiningSummarySchema>;
