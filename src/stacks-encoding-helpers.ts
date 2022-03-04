import {
  ClarityValue as ClarityValue_old,
  serializeCV as serializeCV_old,
  deserializeCV as deserializeCV_old,
  cvToString as cvToString_old,
  BufferReader,
} from '@stacks/transactions';

import {
  readTransactionPostConditions as readTransactionPostConditions_old,
  TransactionPostCondition as TransactionPostCondition_old,
} from './p2p/tx';

import * as sen from 'stacks-encoding-native-js';
import { FunctionParam } from 'node-pg-migrate';

export function serializeCV(value: ClarityValue_old): Buffer {
  return serializeCV_old(value);
}

// TODO: temporarily run the value through both the stacks.js fn and the native fn for debugging
export function deserializeCV<T extends sen.ParsedClarityValue = sen.ParsedClarityValue>(
  input: BufferReader | Buffer | string
): T {
  const original = deserializeCV_old(input);
  console.log('original CV:', original);
  const buffer =
    input instanceof BufferReader ? input.internalBuffer.slice(input.readOffset) : input;
  const deserialized = sen.decodeClarityValue(buffer);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return deserialized as T;
}

// TODO: temporarily run the value through both the stacks.js fn and the native fn for debugging
export function readClarityValueArray(
  input: BufferReader | Buffer | string
): ReturnType<typeof sen.decodeClarityValueList> {
  const buffer =
    input instanceof BufferReader ? input.internalBuffer.slice(input.readOffset) : input;
  const deserialized = sen.decodeClarityValueList(buffer);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return deserialized;
}

export function readTransactionPostConditions(
  reader: BufferReader
): TransactionPostCondition_old[] {
  return readTransactionPostConditions_old(reader);
}

export function cvToString(
  val: ClarityValue_old,
  encoding?: 'tryAscii' | 'hex' | undefined
): string {
  return cvToString_old(val, encoding);
}
