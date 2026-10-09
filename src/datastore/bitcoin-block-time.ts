import type { ChainID } from '../helpers.js';
import { ENV } from '../env.js';
import { MAINNET_CHAIN_ID } from './pox-constants.js';

/** Bitcoin retargets its difficulty every 2016 blocks, at heights that are multiples of it. */
export const BITCOIN_DIFFICULTY_PERIOD = 2016;

/** The latest time a JavaScript `Date` (and so an ISO 8601 rendering) can represent. */
const MAX_DATE_UNIX_SECONDS = 8_640_000_000_000;

/** How future Bitcoin block times are extrapolated. */
export interface BitcoinBlockTimeProjectionConfig {
  /** How many trailing Bitcoin blocks the current pace is measured over. */
  paceWindowBlocks: number;
  /** The interval assumed when no pace can be measured, and past the next retarget on mainnet. */
  targetBlockTimeSeconds: number;
  /**
   * Whether blocks past the next difficulty retarget revert to the target interval. True on
   * mainnet, where the retarget pulls the pace back toward 10 minutes; other networks (regtest,
   * test chains mined on a schedule) follow their measured pace throughout.
   */
  revertToTargetAfterRetarget: boolean;
}

export function getBitcoinBlockTimeProjectionConfig(
  chainId: ChainID
): BitcoinBlockTimeProjectionConfig {
  return {
    paceWindowBlocks: ENV.BITCOIN_BLOCK_TIME_PROJECTION_WINDOW,
    targetBlockTimeSeconds: ENV.BITCOIN_BLOCK_TIME_TARGET_SECONDS,
    revertToTargetAfterRetarget: chainId === MAINNET_CHAIN_ID,
  };
}

/** A Bitcoin block the API knows the header time of. */
export interface BitcoinBlockTimeSample {
  height: number;
  /** Unix seconds. */
  time: number;
}

/**
 * What the times of a set of Bitcoin heights resolve against (see
 * `PgStoreV3.getBitcoinBlockTimes`).
 */
export interface BitcoinBlockTimes {
  /** Header times of the requested heights that a canonical Stacks block anchored to. */
  confirmed: ReadonlyMap<number, number>;
  /** The Bitcoin block of the Stacks chain tip's burn view; `null` before any block. */
  tip: BitcoinBlockTimeSample | null;
  /**
   * The newest known Bitcoin block at least `paceWindowBlocks` behind the tip (or the oldest
   * known one on a younger chain): the start of the window the pace is measured over.
   */
  paceWindowStart: BitcoinBlockTimeSample | null;
}

/** The measured seconds per Bitcoin block over the pace window, or the target if unmeasurable. */
export function getBitcoinBlockPace(
  times: BitcoinBlockTimes,
  config: BitcoinBlockTimeProjectionConfig
): number {
  const { tip, paceWindowStart: start } = times;
  if (!tip || !start || tip.height <= start.height) {
    return config.targetBlockTimeSeconds;
  }
  const pace = (tip.time - start.time) / (tip.height - start.height);
  // Header times are miner-set and not strictly increasing; a window that measures nothing
  // useful falls back to the target.
  return pace > 0 ? pace : config.targetBlockTimeSeconds;
}

/**
 * Extrapolates when a future Bitcoin block will be mined: from the tip's header time at the
 * measured pace, and on mainnet at the target interval once past the next difficulty retarget
 * (the first block of the next difficulty period is the first mined at the new difficulty).
 * Anchored on the tip rather than the wall clock, so it only changes when the chain does.
 * @returns Unix seconds, or `null` for a height at or below the tip (or with no tip), and for one
 * so far out its projection passes the latest representable date (e.g. a far-future cycle number).
 */
export function projectBitcoinBlockTime(
  times: BitcoinBlockTimes,
  config: BitcoinBlockTimeProjectionConfig,
  height: number
): number | null {
  const tip = times.tip;
  if (!tip || height <= tip.height) {
    return null;
  }
  const pace = getBitcoinBlockPace(times, config);
  let projection: number;
  if (config.revertToTargetAfterRetarget) {
    const nextRetarget =
      (Math.floor(tip.height / BITCOIN_DIFFICULTY_PERIOD) + 1) * BITCOIN_DIFFICULTY_PERIOD;
    const blocksAtPace = Math.min(height, nextRetarget - 1) - tip.height;
    const blocksAtTarget = Math.max(0, height - (nextRetarget - 1));
    projection = tip.time + blocksAtPace * pace + blocksAtTarget * config.targetBlockTimeSeconds;
  } else {
    projection = tip.time + (height - tip.height) * pace;
  }
  projection = Math.round(projection);
  return projection <= MAX_DATE_UNIX_SECONDS ? projection : null;
}
