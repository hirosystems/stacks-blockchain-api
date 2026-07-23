import { eventErrorResponse } from '../../../src/event-stream/event-server.ts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('eventErrorResponse', () => {
  test('surfaces the message of a plain Error (not an empty object)', () => {
    const body = eventErrorResponse(new Error('insert into blocks failed'));
    assert.deepEqual(body, { error: 'insert into blocks failed' });
    // Regression: a raw Error serializes to `{}`, which is what the node used to log.
    assert.notDeepEqual(JSON.parse(JSON.stringify(body)), { error: {} });
  });

  test('unwinds the cause chain so the underlying reason is included', () => {
    const error = new Error('handleBlockMessage failed', {
      cause: new Error('duplicate key value violates unique constraint', {
        cause: new Error('conn reset'),
      }),
    });
    assert.deepEqual(eventErrorResponse(error), {
      error:
        'handleBlockMessage failed: duplicate key value violates unique constraint: conn reset',
    });
  });

  test('stringifies non-Error values', () => {
    assert.deepEqual(eventErrorResponse('boom'), { error: 'boom' });
    assert.deepEqual(eventErrorResponse(42), { error: '42' });
    assert.deepEqual(eventErrorResponse(undefined), { error: 'undefined' });
  });

  test('ignores a non-Error cause and keeps the outer message', () => {
    const error = new Error('outer', { cause: 'just a string cause' });
    assert.deepEqual(eventErrorResponse(error), { error: 'outer' });
  });
});
