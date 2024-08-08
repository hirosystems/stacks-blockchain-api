import * as fs from 'fs';

import { logger } from '../../logger';
import { DatasetStore } from './dataset/store';

interface TimeTracker {
  track<T = void>(name: string, fn: () => Promise<T>): Promise<T>;
  trackSync<T = void>(name: string, fn: () => T): T;
  getDurations: (roundDecimals?: number) => {
    name: string;
    seconds: string;
  }[];
}

const createTimeTracker = (): TimeTracker => {
  const durations = new Map<string, { totalTime: bigint }>();
  return {
    track<T = void>(name: string, fn: () => Promise<T>) {
      let duration = durations.get(name);
      if (duration === undefined) {
        duration = { totalTime: 0n };
        durations.set(name, duration);
      }
      const start = process.hrtime.bigint();
      return fn().finally(() => {
        duration.totalTime += process.hrtime.bigint() - start;
      });
    },
    trackSync<T = void>(name: string, fn: () => T) {
      let duration = durations.get(name);
      if (duration === undefined) {
        duration = { totalTime: 0n };
        durations.set(name, duration);
      }
      const start = process.hrtime.bigint();
      try {
        return fn();
      } finally {
        duration.totalTime += process.hrtime.bigint() - start;
      }
    },
    getDurations: (roundDecimals?: number) => {
      return [...durations.entries()]
        .sort((a, b) => Number(b[1].totalTime - a[1].totalTime))
        .map(entry => {
          const seconds = Number(entry[1].totalTime) / 1e9;
          return {
            name: entry[0],
            seconds: roundDecimals ? seconds.toFixed(roundDecimals) : seconds.toString(),
          };
        });
    },
  };
};

function* chunks<T>(arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

const splitIntoChunks = (data: number[], chunk_size: number) => {
  return [...chunks(data, chunk_size)];
};

const genIdsFiles = async (dataset: DatasetStore) => {
  const args = process.argv.slice(2);

  let workers: number = 1;
  if (args.length > 1) {
    workers = Number(args[1].split('=')[1]);
  }

  logger.info({ component: 'event-replay' }, `Generating ID files for ${workers} workers`);

  const dir = `${process.env.STACKS_EVENTS_DIR}/new_block`;

  const ids: number[] = await dataset.newBlockEventsIds();
  const batchSize = Math.ceil(ids.length / workers);
  const chunks = splitIntoChunks(ids, batchSize);

  const files = fs.readdirSync(dir).filter(f => f.endsWith('txt'));

  // delete previous files
  files.map(file => {
    try {
      fs.unlinkSync(`${dir}/${file}`);
    } catch (err) {
      throw err;
    }
  });

  // create id files
  chunks.forEach((chunk, idx) => {
    const filename = `${dir}/ids_${idx + 1}.txt`;
    chunk.forEach(id => {
      fs.writeFileSync(filename, id.toString() + '\n', { flag: 'a' });
    });
  });

  return fs.readdirSync(dir).filter(f => f.endsWith('txt'));
};

export { createTimeTracker, splitIntoChunks, genIdsFiles };
