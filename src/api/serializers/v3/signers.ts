import {
  DbSignerStaker,
  DbStakingSigner,
  DbStakingSignerDetail,
} from '../../../datastore/v3/types.js';
import {
  SignerStaker,
  StakingSigner,
  StakingSignerDetail,
} from '../../schemas/v3/entities/staking-signers.js';

export function serializeDbStakingSigner(signer: DbStakingSigner): StakingSigner {
  return {
    signer: signer.signer,
    signer_key: signer.signer_key,
  };
}

export function serializeDbSignerStaker(staker: DbSignerStaker): SignerStaker {
  const staking_types: ('stx' | 'bond')[] = [];
  if (staker.stx) staking_types.push('stx');
  if (staker.bond) staking_types.push('bond');
  return {
    staker: staker.staker,
    staking_types,
  };
}

export function serializeDbStakingSignerDetail(signer: DbStakingSignerDetail): StakingSignerDetail {
  return {
    ...serializeDbStakingSigner(signer),
    transaction: {
      tx_id: signer.tx_id,
      block: {
        height: signer.block_height,
        hash: signer.block_hash,
        index_hash: signer.index_block_hash,
        time: signer.block_time,
        tx_index: signer.tx_index,
      },
      bitcoin_block: {
        height: signer.burn_block_height,
        time: signer.burn_block_time,
      },
    },
  };
}
