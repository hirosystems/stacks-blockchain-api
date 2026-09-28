import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isValidPrincipal } from '../../../src/helpers.ts';

describe('isValidPrincipal', () => {
  const addr = 'SP000000000000000000002Q6VF78';

  test('accepts standard and contract principals', () => {
    assert.deepEqual(isValidPrincipal(addr), { type: 'standardAddress' });
    assert.deepEqual(isValidPrincipal(`${addr}.pox-4`), { type: 'contractAddress' });
  });

  test('rejects extra segments after the contract name', () => {
    assert.equal(isValidPrincipal(`${addr}.pox-4.`), false);
    assert.equal(isValidPrincipal(`${addr}.pox-4.foo`), false);
    assert.equal(isValidPrincipal(`${addr}.pox-4..`), false);
  });

  test('rejects empty address or contract name', () => {
    assert.equal(isValidPrincipal(`${addr}.`), false);
    assert.equal(isValidPrincipal(`${addr}..pox-4`), false);
    assert.equal(isValidPrincipal('.pox-4'), false);
    assert.equal(isValidPrincipal(''), false);
  });
});
