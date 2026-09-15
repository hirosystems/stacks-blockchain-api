import { logger, timeout } from '@stacks/api-toolkit';
import type { CoreRpcClient } from '@stacks/rpc-client';
import type { ChainID } from '../helpers.js';

/**
 * The PoX cycle geometry of the network the API serves. Cycle boundaries, phases, and the
 * "current cycle" are all derived from these three values the same way the node derives them
 * (`burn-height-to-reward-cycle` and friends in the pox contracts, `PoxConstants` in stacks-core).
 *
 * The node does not deliver them through the event stream, so the writer (`default` / `writeonly`
 * API modes) establishes them once at startup with `ensurePoxConstants` and persists them on the
 * `pox_state` singleton; read-only APIs only ever read them from there (`PgStore.getPoxConstants`).
 */
export interface PoxConstants {
  /** Bitcoin height at which PoX started: the start of reward cycle 0. */
  firstBurnchainBlockHeight: number;
  /** Length of a reward cycle in Bitcoin blocks, reward phase plus prepare phase. */
  rewardCycleLength: number;
  /** Length of the prepare phase in Bitcoin blocks: the final blocks of every cycle. */
  preparePhaseBlockLength: number;
}

/** The mainnet chain id. Only this exact id gets the hardcoded constants without asking the node. */
export const MAINNET_CHAIN_ID: ChainID = 0x00000001;

/** Mainnet PoX constants (`PoxConstants::mainnet_default` in stacks-core). These never change. */
export const MAINNET_POX_CONSTANTS: Readonly<PoxConstants> = Object.freeze({
  firstBurnchainBlockHeight: 666050,
  rewardCycleLength: 2100,
  preparePhaseBlockLength: 100,
});

/** The `/v2/pox` fields the constants are read from. */
export interface NodePoxInfoConstants {
  first_burnchain_block_height: number;
  reward_cycle_length: number;
  prepare_phase_block_length: number;
}

/** Reject geometries the node would never run with. */
export function validatePoxConstants(c: PoxConstants): void {
  if (!Number.isInteger(c.firstBurnchainBlockHeight) || c.firstBurnchainBlockHeight < 0) {
    throw new Error(
      `Invalid PoX constants: first burnchain block height must be a non-negative integer, got ${c.firstBurnchainBlockHeight}`
    );
  }
  if (!Number.isInteger(c.rewardCycleLength) || c.rewardCycleLength < 2) {
    throw new Error(
      `Invalid PoX constants: reward cycle length must be an integer >= 2, got ${c.rewardCycleLength}`
    );
  }
  if (
    !Number.isInteger(c.preparePhaseBlockLength) ||
    c.preparePhaseBlockLength < 1 ||
    c.preparePhaseBlockLength >= c.rewardCycleLength
  ) {
    throw new Error(
      `Invalid PoX constants: prepare phase length must be an integer in [1, reward cycle length), ` +
        `got ${c.preparePhaseBlockLength} with reward cycle length ${c.rewardCycleLength}`
    );
  }
}

/** The constants carried by a `/v2/pox` response. Throws when they are not a valid geometry. */
export function poxConstantsFromNodeInfo(info: NodePoxInfoConstants): PoxConstants {
  const constants: PoxConstants = {
    firstBurnchainBlockHeight: info.first_burnchain_block_height,
    rewardCycleLength: info.reward_cycle_length,
    preparePhaseBlockLength: info.prepare_phase_block_length,
  };
  validatePoxConstants(constants);
  return constants;
}

/** The subset of the core RPC client the loader needs, so tests can stub it. */
export type PoxInfoClient = Pick<CoreRpcClient, 'request'>;

/** Where the constants are persisted: the `pox_state` singleton. */
export interface PoxConstantsRepository {
  getStoredPoxConstants(): Promise<PoxConstants | undefined>;
  setPoxConstants(constants: PoxConstants): Promise<void>;
}

/**
 * Establish the network's PoX constants for this database, once. Runs on the writer at startup and
 * blocks until the constants are persisted on `pox_state`:
 *
 * 1. Already persisted by a previous run: return them, no node call.
 * 2. Mainnet: the hardcoded constants are the answer; persist and return them, no node call.
 * 3. Any other chain id: fetch the node's `/v2/pox`, retrying every `retryIntervalMs` until it
 *    answers with a valid geometry, then persist and return them.
 *
 * The values never change for a network, so this is a one-time read when the database is empty.
 * `signal` stops the retry loop (tests, shutdown), in which case the call rejects.
 */
export async function ensurePoxConstants(opts: {
  db: PoxConstantsRepository;
  client: PoxInfoClient;
  chainId: ChainID;
  retryIntervalMs?: number;
  endpoint?: string;
  signal?: AbortSignal;
}): Promise<PoxConstants> {
  const { signal } = opts;
  const persisted = await opts.db.getStoredPoxConstants();
  if (persisted) {
    logger.debug({ ...persisted }, 'PoX constants loaded from pox_state');
    return persisted;
  }
  if (opts.chainId === MAINNET_CHAIN_ID) {
    const constants = { ...MAINNET_POX_CONSTANTS };
    await opts.db.setPoxConstants(constants);
    logger.info({ ...constants }, 'PoX constants: mainnet, persisted the hardcoded constants');
    return constants;
  }
  const retryIntervalMs = opts.retryIntervalMs ?? 5000;
  const endpoint = opts.endpoint ? ` at ${opts.endpoint}` : '';
  // Warn on the first failure and then about once a minute at the default interval; the rest stays
  // at debug so an unavailable node does not flood the logs.
  const warnEvery = Math.max(1, Math.round(60_000 / retryIntervalMs));
  let attempt = 0;
  let constants: PoxConstants | undefined;
  while (constants === undefined) {
    throwIfAborted(signal);
    attempt++;
    try {
      // Fetch + validate only; a DB failure below must not read as a node failure or refetch.
      const info = await abortable(opts.client.request('GET', '/v2/pox'), signal);
      constants = poxConstantsFromNodeInfo(info);
    } catch (error) {
      throwIfAborted(signal);
      const message = `Unable to load PoX constants from the Stacks node${endpoint} (attempt ${attempt}), retrying`;
      if (attempt === 1 || attempt % warnEvery === 0) {
        logger.warn(error, message);
      } else {
        logger.debug(error, message);
      }
      await abortable(timeout(retryIntervalMs), signal);
    }
  }
  // The node may have answered while an abort was requested; never persist past an abort.
  throwIfAborted(signal);
  // A persistence failure surfaces as such (and fails the writer's startup), not as a node retry.
  await opts.db.setPoxConstants(constants);
  logger.info({ ...constants }, 'PoX constants loaded from the Stacks node and persisted');
  return constants;
}

class PoxConstantsLoadAbortedError extends Error {
  constructor() {
    super('PoX constants load aborted before the node answered');
    this.name = 'PoxConstantsLoadAbortedError';
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PoxConstantsLoadAbortedError();
  }
}

/** Resolve with `promise`, or reject as soon as `signal` aborts even if `promise` never settles. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new PoxConstantsLoadAbortedError());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * The reward cycle a Bitcoin height belongs to (`burn-height-to-reward-cycle`). The prepare phase
 * at the end of a cycle belongs to that cycle by this arithmetic, even though it selects the next
 * cycle's reward set.
 */
export function burnHeightToRewardCycle(c: PoxConstants, burnHeight: number): number {
  if (burnHeight < c.firstBurnchainBlockHeight) {
    throw new Error(
      `Bitcoin height ${burnHeight} precedes the first PoX burnchain block ${c.firstBurnchainBlockHeight}`
    );
  }
  return Math.floor((burnHeight - c.firstBurnchainBlockHeight) / c.rewardCycleLength);
}

/** The Bitcoin height at which a reward cycle starts (`reward-cycle-to-burn-height`). */
export function rewardCycleToBurnHeight(c: PoxConstants, cycle: number): number {
  return c.firstBurnchainBlockHeight + cycle * c.rewardCycleLength;
}

/** The Bitcoin heights that delimit a reward cycle. All inclusive; the end is the last block. */
export interface PoxCycleSchedule {
  startBitcoinHeight: number;
  preparePhaseStartBitcoinHeight: number;
  endBitcoinHeight: number;
}

export function getPoxCycleSchedule(c: PoxConstants, cycle: number): PoxCycleSchedule {
  const start = rewardCycleToBurnHeight(c, cycle);
  return {
    startBitcoinHeight: start,
    preparePhaseStartBitcoinHeight: start + c.rewardCycleLength - c.preparePhaseBlockLength,
    endBitcoinHeight: start + c.rewardCycleLength - 1,
  };
}

/**
 * Where a reward cycle stands relative to the burn tip. `prepare_phase` is the cycle's final
 * `preparePhaseBlockLength` blocks, during which the next cycle's reward set is selected and the
 * pox contract rejects stacking operations.
 */
export type PoxCyclePhase = 'upcoming' | 'reward_phase' | 'prepare_phase' | 'finished';

export function getPoxCyclePhase(c: PoxConstants, cycle: number, burnTip: number): PoxCyclePhase {
  const s = getPoxCycleSchedule(c, cycle);
  if (burnTip < s.startBitcoinHeight) return 'upcoming';
  if (burnTip > s.endBitcoinHeight) return 'finished';
  if (burnTip >= s.preparePhaseStartBitcoinHeight) return 'prepare_phase';
  return 'reward_phase';
}

/** A cycle selector: a cycle number, or an alias relative to the cycle containing the burn tip. */
export type PoxCycleSelector = number | 'current' | 'previous' | 'next';

/**
 * Resolve a cycle selector against the burn tip. Returns `undefined` when the tip precedes the
 * first PoX burn block (no cycle exists yet) or the selector points before cycle 0.
 */
export function resolvePoxCycleSelector(
  c: PoxConstants,
  selector: PoxCycleSelector,
  burnTip: number
): number | undefined {
  if (typeof selector === 'number') {
    return Number.isInteger(selector) && selector >= 0 ? selector : undefined;
  }
  if (burnTip < c.firstBurnchainBlockHeight) return undefined;
  const current = burnHeightToRewardCycle(c, burnTip);
  switch (selector) {
    case 'current':
      return current;
    case 'next':
      return current + 1;
    case 'previous':
      return current > 0 ? current - 1 : undefined;
  }
}
