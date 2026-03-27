import { BitVec } from '../../../src/helpers.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('signer bitvec decoding', () => {
  const signerBitvecString1 = '00010000000100';
  const signerBitvecPayload1 = Buffer.from(signerBitvecString1, 'hex');
  const bitVec1 = BitVec.consensusDeserialize(signerBitvecPayload1);
  assert.equal(bitVec1.bits.length, 1);
  assert.deepEqual(bitVec1.bits, [false]);
  assert.equal(bitVec1.toString(), '0');
  assert.equal(BitVec.consensusDeserializeToString(signerBitvecString1), '0');

  const signerBitvecString2 = '000100000001ff';
  const signerBitvecPayload2 = Buffer.from(signerBitvecString2, 'hex');
  const bitVec2 = BitVec.consensusDeserialize(signerBitvecPayload2);
  assert.equal(bitVec2.bits.length, 1);
  assert.deepEqual(bitVec2.bits, [true]);
  assert.equal(bitVec2.toString(), '1');
  assert.equal(BitVec.consensusDeserializeToString(signerBitvecString2), '1');

  const signerBitvecString3 = '000300000001c0';
  const signerBitvecPayload3 = Buffer.from(signerBitvecString3, 'hex');
  const bitVec3 = BitVec.consensusDeserialize(signerBitvecPayload3);
  assert.equal(bitVec3.bits.length, 3);
  assert.deepEqual(bitVec3.bits, [true, true, false]);
  assert.equal(bitVec3.toString(), '110');
  assert.equal(BitVec.consensusDeserializeToString(signerBitvecString3), '110');
});
