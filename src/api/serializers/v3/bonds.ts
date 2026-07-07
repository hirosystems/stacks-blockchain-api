import {
  DbBond,
  DbBondAllowlistEntry,
  DbBondRegistration,
  DbBondRegistrationSummary,
  DbBondSummary,
  DbPrincipalBondPosition,
  DbPrincipalStakingSummary,
} from '../../../datastore/v3/types.js';
import { DbBondLockupType, DbPrincipalBondPositionStatus } from '../../../datastore/common.js';
import { Bond, BondSummary } from '../../schemas/v3/entities/bonds.js';
import { BondStatus } from '../../schemas/v3/entities/bonds.js';
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
