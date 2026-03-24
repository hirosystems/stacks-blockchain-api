import {
  parsePagingQueryInput,
  getPagingQueryLimit,
  ResourceType,
} from '../../../src/api/pagination.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('parsePagingQueryInput()', () => {
  test('it returns same input when passed number', () => {
    assert.equal(parsePagingQueryInput(8021991), 8021991);
  });

  test('error is thrown when non-string value passed', () => {
    assert.throws(() => parsePagingQueryInput(true));
  });

  test('error is thrown on nonsense non-numerial input', () => {
    assert.throws(() => parsePagingQueryInput('onehundredand2'));
  });

  test('string parsing works', () => {
    assert.equal(parsePagingQueryInput('123'), 123);
  });
});

describe('getPagingQueryLimit()', () => {
  test('If a limit is not provided, the default limit is used for the specified route', () => {
    assert.equal(getPagingQueryLimit(ResourceType.Block), 20);
  });
  test('Error is thrown when value is larger than input', () => {
    assert.throws(() => getPagingQueryLimit(ResourceType.Block, 31));
  });
  test('Error is NOT thrown when value is larger than input but a maxLimitOverride has been provided', () => {
    assert.doesNotThrow(() => getPagingQueryLimit(ResourceType.Tx, 100, 200));
  });
});
