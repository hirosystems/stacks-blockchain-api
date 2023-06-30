interface TimeTracker {
    track<T = void>(name: string, fn: () => Promise<T>): Promise<T>;
    trackSync<T = void>(name: string, fn: () => T): T;
    getDurations: (
        roundDecimals?: number
    ) => {
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
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        duration!.totalTime += process.hrtime.bigint() - start;
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
}

function* chunks<T>(arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

const splitIntoChunks = async (data: object[], chunk_size: number) => {
  return [...chunks(data, chunk_size)];
};

export { TimeTracker, createTimeTracker, splitIntoChunks };
