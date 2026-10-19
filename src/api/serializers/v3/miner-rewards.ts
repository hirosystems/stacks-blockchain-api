import { serializeDbBlockSummary } from './blocks.js';
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
    block: serializeDbBlockSummary({
      block_height: reward.mature_block_height,
      block_hash: reward.mature_block_hash,
      index_block_hash: reward.mature_index_block_hash,
      block_time: reward.mature_block_time,
      tenure_height: reward.mature_tenure_height,
      signer_bitvec: reward.mature_signer_bitvec,
      tx_count: reward.mature_tx_count,
      burn_block_height: reward.mature_burn_block_height,
      burn_block_hash: reward.mature_burn_block_hash,
    }),
    source_block: serializeDbBlockSummary({
      block_height: reward.source_block_height,
      block_hash: reward.source_block_hash,
      index_block_hash: reward.source_index_block_hash,
      block_time: reward.source_block_time,
      tenure_height: reward.source_tenure_height,
      signer_bitvec: reward.source_signer_bitvec,
      tx_count: reward.source_tx_count,
      burn_block_height: reward.source_burn_block_height,
      burn_block_hash: reward.source_burn_block_hash,
    }),
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
