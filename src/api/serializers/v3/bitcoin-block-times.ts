import {
  BitcoinBlockTimeProjectionConfig,
  BitcoinBlockTimes,
  projectBitcoinBlockTime,
} from '../../../datastore/bitcoin-block-time.js';
import { unixEpochToIso } from '../../../helpers.js';
import { SchedulePointTimes } from '../../schemas/v3/entities/common.js';

/** What schedule point times are resolved from: the looked-up times and how to project them. */
export interface ScheduleTimes {
  times: BitcoinBlockTimes;
  config: BitcoinBlockTimeProjectionConfig;
}

/** The confirmed and projected times of a schedule point at a Bitcoin height. */
export function serializeSchedulePointTimes(
  scheduleTimes: ScheduleTimes,
  bitcoinHeight: number
): SchedulePointTimes {
  const time = scheduleTimes.times.confirmed.get(bitcoinHeight) ?? null;
  const projectedTime = projectBitcoinBlockTime(
    scheduleTimes.times,
    scheduleTimes.config,
    bitcoinHeight
  );
  return {
    time,
    time_iso: time !== null ? unixEpochToIso(time) : null,
    projected_time: projectedTime,
    projected_time_iso: projectedTime !== null ? unixEpochToIso(projectedTime) : null,
  };
}
