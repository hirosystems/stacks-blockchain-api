import { DbCycleSigner, DbStakingCycle } from '../../../datastore/v3/types.js';
import { CycleSigner, StakingCycle } from '../../schemas/v3/entities/staking-cycles.js';

export function serializeDbCycleSigner(signer: DbCycleSigner, cycleNumber: number): CycleSigner {
  return {
    signing_key: signer.signing_key,
    weight: {
      amount: signer.weight,
      percent: signer.weight_percent,
    },
    staked_stx: {
      amount: signer.stacked_amount,
      percent: signer.stacked_amount_percent,
    },
    signer_managers: signer.signer_managers.map(m => ({
      signer_manager: m.signer_manager,
      registered_at: {
        block_height: m.block_height,
        bitcoin_block_height: m.burn_block_height,
        tx_id: m.tx_id,
      },
      granted_keys: m.granted_keys,
      // The registration stays bound even if its grant is revoked; this flag surfaces whether the
      // bound key's authorization is still live.
      grant_active: m.granted_keys.some(g => g.signer_key === signer.signing_key),
      // Keys registered after the cycle's anchor block take effect next cycle.
      pending_key_update:
        m.pending_signer_key && m.pending_tx_id
          ? {
              signer_key: m.pending_signer_key,
              effective_cycle: cycleNumber + 1,
              tx_id: m.pending_tx_id,
            }
          : null,
    })),
  };
}

export function serializeDbStakingCycle(cycle: DbStakingCycle): StakingCycle {
  return {
    number: cycle.number,
    status: cycle.status,
    schedule: {
      start: { bitcoin_height: cycle.schedule.startBitcoinHeight },
      prepare_phase_start: { bitcoin_height: cycle.schedule.preparePhaseStartBitcoinHeight },
      end: { bitcoin_height: cycle.schedule.endBitcoinHeight },
    },
    locked: {
      stx: {
        stx_only: cycle.locked.stx_only,
        bonds: cycle.locked.bond_stx,
        total: (BigInt(cycle.locked.stx_only) + BigInt(cycle.locked.bond_stx)).toString(),
      },
      btc: {
        total: cycle.locked.btc,
        native: cycle.locked.btc_native,
        sbtc: cycle.locked.btc_sbtc,
      },
    },
    participants: {
      stakers: {
        stx_only: cycle.participants.stx_only_stakers,
        bonds: cycle.participants.bond_stakers,
      },
      signers: cycle.participants.signers,
    },
    bonds: { total: cycle.bonds.length, indexes: cycle.bonds },
    rewards: {
      btc: {
        total: cycle.rewards.total,
        waterfall: {
          bonds: cycle.rewards.bonds,
          stx_only: cycle.rewards.stx_only,
          reserve_deposit: cycle.rewards.reserve_deposit,
        },
        claimed: cycle.rewards.claimed,
      },
    },
  };
}
