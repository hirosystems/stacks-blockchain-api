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
  const types: ('stx' | 'btc')[] = [];
  if (staker.stx) types.push('stx');
  // `bond` (bond_registrations, BTC/sBTC-backed) is surfaced as `btc` in the API.
  if (staker.bond) types.push('btc');
  return {
    staker: staker.staker,
    types,
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
