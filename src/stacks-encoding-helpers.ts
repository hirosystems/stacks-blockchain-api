import { ClarityValue, serializeCV } from '@stacks/transactions';

export function createClarityValueArray(...input: ClarityValue[]): Buffer {
  const buffers = new Array<Buffer>(input.length);
  for (let i = 0; i < input.length; i++) {
    buffers[i] = Buffer.from(serializeCV(input[i]));
  }
  const valueCountBuffer = Buffer.alloc(4);
  valueCountBuffer.writeUInt32BE(input.length);
  buffers.unshift(valueCountBuffer);
  return Buffer.concat(buffers);
}
