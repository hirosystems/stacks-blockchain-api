import { unixEpochToIso } from '../../../helpers.js';
import {
  PrincipalMinerReward,
  PrincipalMiningSummary,
} from '../../schemas/v3/entities/principal-miner-rewards.js';
import { DbPrincipalMinerReward, DbPrincipalMiningSummary } from '../../../datastore/v3/types.js';

type RewardAmounts = Pick<DbPrincipalMinerReward, 'coinbase_amount' | 'fees_amount'>;

function serializeRewardAmounts(amounts: RewardAmounts) {
  return {
    coinbase: amounts.coinbase_amount,
    fees: amounts.fees_amount,
    total: (BigInt(amounts.coinbase_amount) + BigInt(amounts.fees_amount)).toString(),
  };
}

/**
 * Serializes a database matured miner reward into a miner reward response entity.
 * @param reward - The database miner reward.
 * @returns The serialized miner reward.
 */
export function serializePrincipalMinerReward(
  reward: DbPrincipalMinerReward
): PrincipalMinerReward {
  return {
    id: `${reward.mature_index_block_hash}:${reward.reward_index}`,
    recipient: reward.recipient,
    miner: reward.miner_address,
    block: {
      height: reward.mature_block_height,
      hash: reward.mature_block_hash,
      index_hash: reward.mature_index_block_hash,
      time: reward.mature_block_time,
      time_iso: unixEpochToIso(reward.mature_block_time),
    },
    source_block: {
      height: reward.source_block_height,
      hash: reward.source_block_hash,
      index_hash: reward.source_index_block_hash,
      time: reward.source_block_time,
      time_iso: unixEpochToIso(reward.source_block_time),
    },
    ...serializeRewardAmounts(reward),
  };
}

/**
 * Serializes a principal's lifetime matured miner rewards into a mining summary.
 * @param summary - The database mining summary.
 * @returns The serialized mining summary.
 */
export function serializePrincipalMiningSummary(
  summary: DbPrincipalMiningSummary
): PrincipalMiningSummary {
  return {
    rewards: {
      count: summary.reward_count,
      ...serializeRewardAmounts(summary),
    },
  };
}
