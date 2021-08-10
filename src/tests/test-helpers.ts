// Hack to avoid jest outputting 'Your test suite must contain at least one test.'
// https://stackoverflow.com/a/59864054/794962
test.skip('test-ignore-kludge', () => 1);

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
