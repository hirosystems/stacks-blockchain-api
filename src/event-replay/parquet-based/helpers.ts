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

export interface Stopwatch {
  /** Milliseconds since stopwatch was created. */
  getElapsed: () => number;
  /** Seconds since stopwatch was created. */
  getElapsedSeconds: (roundDecimals?: number) => number;
  getElapsedAndRestart: () => number;
  restart(): void;
}

export function stopwatch(): Stopwatch {
  let start = process.hrtime.bigint();
  const result: Stopwatch = {
    getElapsedSeconds: (roundDecimals?: number) => {
      const elapsedMs = result.getElapsed();
      const seconds = elapsedMs / 1000;
      return roundDecimals === undefined ? seconds : +seconds.toFixed(roundDecimals);
    },
    getElapsed: () => {
      const end = process.hrtime.bigint();
      return Number((end - start) / 1_000_000n);
    },
    getElapsedAndRestart: () => {
      const end = process.hrtime.bigint();
      const result = Number((end - start) / 1_000_000n);
      start = process.hrtime.bigint();
      return result;
    },
    restart: () => {
      start = process.hrtime.bigint();
    },
  };
  return result;
}

export { TimeTracker, createTimeTracker };
