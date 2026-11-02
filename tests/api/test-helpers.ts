import assert from 'node:assert/strict';
import { PgStore } from '../../src/datastore/pg-store.ts';

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

export function assertObjectContaining(actual: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== 'object') {
    assert.deepEqual(actual, expected);
    return;
  }
  if (Array.isArray(expected)) {
    assert.deepEqual(actual, expected);
    return;
  }
  assert.ok(actual !== null && typeof actual === 'object');
  for (const [key, value] of Object.entries(expected)) {
    assertObjectContaining((actual as Record<string, unknown>)[key], value);
  }
}

export function assertMatchesObject(actual: any, expected: any): void {
  if (expected === Number) {
    assert.equal(typeof actual, 'number');
    return;
  }
  if (expected === String) {
    assert.equal(typeof actual, 'string');
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual));
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
      assertMatchesObject(actual[i], expected[i]);
    }
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    assert.notEqual(actual, null);
    assert.equal(typeof actual, 'object');
    for (const [key, value] of Object.entries(expected)) {
      assertMatchesObject(actual[key], value);
    }
    return;
  }
  assert.deepEqual(actual, expected);
}

export function hex(value: number): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

/** Returns the STX balance of `address` at the current chain tip. */
export async function getCurrentStxBalance(db: PgStore, address: string) {
  const chainTip = await db.getChainTip(db.sql);
  return db.getStxBalanceAtBlock(address, chainTip.block_height);
}

/**
 * Asserts that the materialized `tx_type_counts` match a fresh count of canonical txs per type. Run
 * after re-orgs, which apply delta updates. Not compared against `chain_tip.tx_count`, which
 * leaves out the genesis boot txs.
 */
export async function assertTxTypeCountsConsistent(db: PgStore) {
  const expected = await db.sql<{ type_id: number; count: number }[]>`
    SELECT type_id, COUNT(*)::int AS count
    FROM txs
    WHERE canonical = true AND microblock_canonical = true
    GROUP BY type_id
    ORDER BY type_id
  `;
  // Types whose txs were all orphaned keep a zero row.
  const actual = await db.sql<{ type_id: number; count: number }[]>`
    SELECT type_id, count FROM tx_type_counts WHERE count != 0 ORDER BY type_id
  `;
  assert.deepEqual(
    actual.map(r => ({ ...r })),
    expected.map(r => ({ ...r }))
  );
}
