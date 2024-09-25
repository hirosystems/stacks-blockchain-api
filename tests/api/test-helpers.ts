type Disposable<T> = () =>
  | readonly [item: T, dispose: () => any | Promise<any>]
  | Promise<readonly [item: T, dispose: () => any | Promise<any>]>;

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type UnwrapDisposable<T> = T extends Disposable<infer U> ? UnwrapPromise<U> : never;

type UnwrapDisposables<T extends [...any[]]> = T extends [infer Head, ...infer Tail]
  ? [UnwrapDisposable<Head>, ...UnwrapDisposables<Tail>]
  : [];

export async function useWithCleanup<T extends [...Disposable<any>[]]>(
  ...args: [...using: T, fn: (...items: UnwrapDisposables<T>) => unknown | Promise<unknown>]
) {
  const disposables = args.slice(0, -1) as Disposable<unknown>[];
  const cb = args[args.length - 1] as (...items: unknown[]) => unknown;
  const items: unknown[] = [];
  const cleanups: (() => unknown | Promise<unknown>)[] = [];
  for (const using of disposables) {
    const run = using();
    const [item, cleanup] = run instanceof Promise ? await run : run;
    items.push(item);
    cleanups.push(cleanup);
  }
  try {
    const run = cb(...items);
    run instanceof Promise && (await run);
  } finally {
    for (const cleanup of cleanups) {
      const run = cleanup();
      run instanceof Promise && (await run);
    }
  }
}

type TestEnvVar = [EnvVarKey: string, EnvVarValue: string];

/**
 * Helper function for tests.
 * Sets local process environment variables, and returns a function that restores them to the original values.
 */
export function withEnvVars(...envVars: TestEnvVar[]) {
  const original: { exists: boolean; key: string; value: string | undefined }[] = [];
  envVars.forEach(([k, v]) => {
    original.push({
      exists: k in process.env,
      key: k,
      value: v,
    });
  });
  envVars.forEach(([k, v]) => {
    process.env[k] = v;
  });
  return () => {
    original.forEach(orig => {
      if (!orig.exists) {
        delete process.env[orig.key];
      } else {
        process.env[orig.key] = orig.value;
      }
    });
  };
}
