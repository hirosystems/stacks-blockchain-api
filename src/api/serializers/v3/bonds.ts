import {
  DbBond,
  DbBondAllowlistEntry,
  DbBondEvent,
  DbBondRegistration,
  DbBondRegistrationSummary,
  DbBondSummary,
  DbPrincipalBondPosition,
  DbPrincipalStakingSummary,
} from '../../../datastore/v3/types.js';
import {
  bondLockupTypeFromString,
  DbBondLockupType,
  DbPrincipalBondPositionStatus,
} from '../../../datastore/common.js';
import {
  Pox5EventAddToAllowlist,
  Pox5EventAnnounceL1EarlyExit,
  Pox5EventBondDistribution,
  Pox5EventClaimStakerRewardsForSigner,
  Pox5EventName,
  Pox5EventRegisterForBond,
  Pox5EventSetupBond,
  Pox5EventUnstakeSbtc,
  Pox5EventUpdateBondRegistration,
} from '@stacks/codec';
import { Bond, BondSummary } from '../../schemas/v3/entities/bonds.js';
import { BondStatus } from '../../schemas/v3/entities/bonds.js';
import { BondEvent } from '../../schemas/v3/entities/bond-events.js';
import { BondAllowlist } from '../../schemas/v3/entities/bond-allowlist-entries.js';
import { BondRegistration } from '../../schemas/v3/entities/bond-registrations.js';
import { BondRegistrationSummary } from '../../schemas/v3/entities/bond-registration-summaries.js';
import {
  BtcRewards,
  PrincipalBondPosition,
  PrincipalBondPositionStatus,
  PrincipalStakingSummary,
} from '../../schemas/v3/entities/principal-bond-positions.js';

/** Build the `{ accrued, claimed, claimable }` sBTC reward triple from running totals. */
function serializeBtcRewards(accrued: string, claimed: string): BtcRewards {
  return {
    accrued,
    claimed,
    claimable: (BigInt(accrued) - BigInt(claimed)).toString(),
  };
}

function serializeBondStatus(summary: DbBondSummary, currentBurnBlockHeight: number): BondStatus {
  if (currentBurnBlockHeight < summary.bond_start_height) {
    return 'upcoming';
  }
  if (currentBurnBlockHeight < summary.unlock_burn_height) {
    return 'active';
  }
  return 'unlocked';
}

/**
 * Serializes a database bond summary to a API bond summary.
 * @param summary - The database bond summary to serialize.
 * @returns The API bond summary.
 */
export function serializeDbBondSummary(
  summary: DbBondSummary,
  currentBurnBlockHeight: number
): BondSummary {
  return {
    index: summary.bond_index,
    pox_version: 'pox5',
    status: serializeBondStatus(summary, currentBurnBlockHeight),
    parameters: {
      target_rate_bps: summary.target_rate,
      stx_value_ratio: summary.stx_value_ratio,
      minimum_stx_ratio: summary.min_ustx_ratio,
      btc_capacity: summary.btc_capacity,
    },
    registrations: {
      allowed_count: summary.allowed_count,
      registered_count: summary.registered_count,
    },
    schedule: {
      activation: {
        bitcoin_height: summary.bond_start_height,
        pox_cycle: summary.first_reward_cycle,
      },
      unlock: {
        bitcoin_height: summary.unlock_burn_height,
        pox_cycle: summary.unlock_cycle,
      },
    },
    balances: {
      locked: {
        btc: summary.btc_locked,
        stx: summary.stx_locked,
      },
      paid_out: {
        btc: summary.btc_paid_out,
      },
    },
  };
}

/**
 * Serializes a database bond to a API bond.
 * @param bond - The database bond to serialize.
 * @returns The API bond.
 */
export function serializeDbBond(bond: DbBond, currentBurnBlockHeight: number): Bond {
  return {
    ...serializeDbBondSummary(bond, currentBurnBlockHeight),
    transaction: {
      tx_id: bond.tx_id,
      block: {
        height: bond.block_height,
        hash: bond.block_hash,
        index_hash: bond.index_block_hash,
        time: bond.block_time,
        tx_index: bond.tx_index,
      },
      bitcoin_block: {
        height: bond.burn_block_height,
        time: bond.burn_block_time,
      },
    },
  };
}

/**
 * Serializes a bond-scoped `pox5_events` row to an API bond event. Payloads are curated into the
 * same vocabulary as the bond, allowlist, and registration entities (grouped `{ btc, stx }` string
 * amounts, integer heights and cycles) instead of passing the raw synthetic event fields through,
 * and carry only what the event uniquely records — details available on a resource endpoint (e.g.
 * a registration's proven L1 lockup outputs) are not repeated here.
 */
export function serializeDbBondEvent(event: DbBondEvent): BondEvent {
  const base = {
    bond_index: parseInt((event.data as { bond_index: string }).bond_index),
    transaction: {
      tx_id: event.tx_id,
      event_index: event.event_index,
    },
    block: {
      height: event.block_height,
      hash: event.block_hash,
      index_hash: event.index_block_hash,
      time: event.block_time,
      tx_index: event.tx_index,
    },
    bitcoin_block: {
      height: event.burn_block_height,
      time: event.burn_block_time,
    },
  };
  switch (event.name) {
    case Pox5EventName.SetupBond: {
      const data = event.data as unknown as Pox5EventSetupBond['data'];
      return {
        ...base,
        name: Pox5EventName.SetupBond,
        data: {
          parameters: {
            target_rate_bps: parseInt(data.target_rate),
            stx_value_ratio: parseInt(data.stx_value_ratio),
            minimum_stx_ratio: parseInt(data.min_ustx_ratio),
          },
          early_unlock_bytes: data.early_unlock_bytes,
          schedule: {
            activation: {
              bitcoin_height: parseInt(data.bond_start_height),
              pox_cycle: parseInt(data.first_reward_cycle),
            },
            unlock: {
              bitcoin_height: parseInt(data.unlock_burn_height),
              pox_cycle: parseInt(data.unlock_cycle),
            },
          },
        },
      };
    }
    case Pox5EventName.AddToAllowlist: {
      const data = event.data as unknown as Pox5EventAddToAllowlist['data'];
      return {
        ...base,
        name: Pox5EventName.AddToAllowlist,
        data: {
          staker: data.staker,
          max_sats: data.max_sats,
        },
      };
    }
    case Pox5EventName.RegisterForBond: {
      const data = event.data as unknown as Pox5EventRegisterForBond['data'];
      return {
        ...base,
        name: Pox5EventName.RegisterForBond,
        data: {
          staker: data.staker,
          signer: data.signer,
          type: serializeBondLockupType(bondLockupTypeFromString(data.btc_lockup.type)),
          balances: {
            btc: data.sats_total,
            stx: data.amount_ustx,
          },
        },
      };
    }
    case Pox5EventName.UpdateBondRegistration: {
      const data = event.data as unknown as Pox5EventUpdateBondRegistration['data'];
      return {
        ...base,
        name: Pox5EventName.UpdateBondRegistration,
        data: {
          staker: data.staker,
          signer: data.signer,
          old_signer: data.old_signer,
          type: data.is_l1_lock ? 'l1' : 'l2',
          balances: {
            btc: data.amount_sats,
            stx: data.amount_ustx,
          },
        },
      };
    }
    case Pox5EventName.AnnounceL1EarlyExit: {
      const data = event.data as unknown as Pox5EventAnnounceL1EarlyExit['data'];
      return {
        ...base,
        name: Pox5EventName.AnnounceL1EarlyExit,
        data: {
          staker: data.staker,
          signer: data.signer,
          released: { btc: data.amount_sats_released },
        },
      };
    }
    case Pox5EventName.UnstakeSbtc: {
      const data = event.data as unknown as Pox5EventUnstakeSbtc['data'];
      return {
        ...base,
        name: Pox5EventName.UnstakeSbtc,
        data: {
          staker: data.staker,
          signer: data.signer,
          withdrawn: { btc: data.amount_withdrawn_sats },
          remaining: { btc: data.new_amount_sats },
        },
      };
    }
    case Pox5EventName.BondDistribution: {
      const data = event.data as unknown as Pox5EventBondDistribution['data'];
      return {
        ...base,
        name: Pox5EventName.BondDistribution,
        data: {
          target_yield: data.target_yield,
          rewards: { btc: data.bond_rewards },
          staked: { btc: data.bond_staked_sats },
          accrued_rewards_per_sat: data.accrued_rewards_per_sat,
          cumulative_rewards_per_sat: data.cumulative_rewards_per_sat,
        },
      };
    }
    case Pox5EventName.ClaimStakerRewardsForSigner: {
      const data = event.data as unknown as Pox5EventClaimStakerRewardsForSigner['data'];
      return {
        ...base,
        name: Pox5EventName.ClaimStakerRewardsForSigner,
        data: {
          signer_manager: data.signer_manager,
          staker: data.staker,
          reward_cycle: parseInt(data.reward_cycle),
          // The bond events query filters to non-null bond_index rows, so this is
          // always a bond reward claim (never an STX-only claim).
          claimed: { btc: data.rewards_claimed },
        },
      };
    }
    default:
      // The query filter only matches events carrying a bond_index, which is
      // exactly the set handled above for the deployed pox-5 contract.
      throw new Error(`Unhandled pox-5 bond event: ${event.name}`);
  }
}

export function serializeDbBondAllowlistEntry(entry: DbBondAllowlistEntry): BondAllowlist {
  return {
    staker: entry.staker,
    max_sats: entry.max_sats,
  };
}

function serializePrincipalBondPositionStatus(
  status: DbPrincipalBondPositionStatus
): PrincipalBondPositionStatus {
  switch (status) {
    case DbPrincipalBondPositionStatus.Enrolled:
      return 'enrolled';
    case DbPrincipalBondPositionStatus.Running:
      return 'running';
    case DbPrincipalBondPositionStatus.Unlocked:
      return 'unlocked';
    case DbPrincipalBondPositionStatus.EarlyExit:
      return 'early_exit';
  }
}

function serializeBondLockupType(type: DbBondLockupType): 'l1' | 'l2' {
  switch (type) {
    case DbBondLockupType.L1:
      return 'l1';
    case DbBondLockupType.L2:
      return 'l2';
  }
}

export function serializeDbPrincipalBondPosition(
  position: DbPrincipalBondPosition
): PrincipalBondPosition {
  return {
    bond_index: position.bond_index,
    status: serializePrincipalBondPositionStatus(position.status),
    active: position.active,
    enrollment: {
      tx_id: position.tx_id,
      btc_lockup: {
        amount: position.btc_locked,
      },
    },
    locked: {
      btc: position.btc_locked,
      stx: position.stx_locked,
    },
    rewards: {
      btc: serializeBtcRewards(position.accrued_rewards, position.claimed_rewards),
    },
  };
}

export function serializeDbPrincipalStakingSummary(
  summary: DbPrincipalStakingSummary
): PrincipalStakingSummary {
  return {
    stx: {
      locked: summary.stx.locked,
      rewards: {
        btc: serializeBtcRewards(summary.stx.accrued_rewards, summary.stx.claimed_rewards),
      },
    },
    bonds: {
      count: summary.bonds.count,
      locked: {
        btc: summary.bonds.btc_locked,
        stx: summary.bonds.stx_locked,
      },
      rewards: {
        btc: serializeBtcRewards(summary.bonds.accrued_rewards, summary.bonds.claimed_rewards),
      },
    },
  };
}

export function serializeDbBondRegistrationSummary(
  entry: DbBondRegistrationSummary
): BondRegistrationSummary {
  return {
    signer: entry.signer,
    staker: entry.staker,
    type: serializeBondLockupType(entry.btc_lockup_type),
    balances: {
      btc: entry.sats_total,
      stx: entry.amount_ustx,
    },
  };
}

export function serializeDbBondRegistration(entry: DbBondRegistration): BondRegistration {
  const summary = serializeDbBondRegistrationSummary(entry);
  switch (summary.type) {
    case 'l1':
      return {
        ...summary,
        l1_lockup: {
          transactions:
            entry.btc_lockup_txs?.map(tx => ({
              tx_id: tx.txid,
              output_index: parseInt(tx.output_index),
            })) ?? [],
        },
      };
    case 'l2':
      return {
        ...summary,
        l2_lockup: {
          tx_id: entry.tx_id,
        },
      };
  }
}
