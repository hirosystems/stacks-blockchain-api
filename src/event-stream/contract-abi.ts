import {
  ClarityValue,
  uintCV,
  intCV,
  contractPrincipalCV,
  standardPrincipalCV,
  noneCV,
  bufferCV,
  falseCV,
  trueCV,
} from '@stacks/transactions';
import { NotImplementedError } from '../errors';

type ClarityAbiTypeBuffer = { buffer: { length: number } };
type ClarityAbiTypeResponse = { response: { ok: ClarityAbiType; error: ClarityAbiType } };
type ClarityAbiTypeOptional = { optional: ClarityAbiType };
type ClarityAbiTypeTuple = { tuple: { name: string; type: ClarityAbiType }[] };
type ClarityAbiTypeList = { list: { type: ClarityAbiType; length: number } };

type ClarityAbiTypeUInt128 = 'uint128';
type ClarityAbiTypeInt128 = 'int128';
type ClarityAbiTypeBool = 'bool';
type ClarityAbiTypePrincipal = 'principal';
type ClarityAbiTypeNone = 'none';

type ClarityAbiTypePrimitive =
  | ClarityAbiTypeUInt128
  | ClarityAbiTypeInt128
  | ClarityAbiTypeBool
  | ClarityAbiTypePrincipal
  | ClarityAbiTypeNone;

type ClarityAbiType =
  | ClarityAbiTypePrimitive
  | ClarityAbiTypeBuffer
  | ClarityAbiTypeResponse
  | ClarityAbiTypeOptional
  | ClarityAbiTypeTuple
  | ClarityAbiTypeList;

enum ClarityAbiTypeId {
  ClarityAbiTypeUInt128 = 1,
  ClarityAbiTypeInt128 = 2,
  ClarityAbiTypeBool = 3,
  ClarityAbiTypePrincipal = 4,
  ClarityAbiTypeNone = 5,
  ClarityAbiTypeBuffer = 6,
  ClarityAbiTypeResponse = 7,
  ClarityAbiTypeOptional = 8,
  ClarityAbiTypeTuple = 9,
  ClarityAbiTypeList = 10,
}

const isClarityAbiPrimitive = (val: ClarityAbiType): val is ClarityAbiTypePrimitive =>
  typeof val === 'string';
const isClarityAbiBuffer = (val: ClarityAbiType): val is ClarityAbiTypeBuffer =>
  (val as ClarityAbiTypeBuffer).buffer !== undefined;
const isClarityAbiResponse = (val: ClarityAbiType): val is ClarityAbiTypeResponse =>
  (val as ClarityAbiTypeResponse).response !== undefined;
const isClarityAbiOptional = (val: ClarityAbiType): val is ClarityAbiTypeOptional =>
  (val as ClarityAbiTypeOptional).optional !== undefined;
const isClarityAbiTuple = (val: ClarityAbiType): val is ClarityAbiTypeTuple =>
  (val as ClarityAbiTypeTuple).tuple !== undefined;
const isClarityAbiList = (val: ClarityAbiType): val is ClarityAbiTypeList =>
  (val as ClarityAbiTypeList).list !== undefined;

type ClarityAbiTypeUnion =
  | { id: ClarityAbiTypeId.ClarityAbiTypeUInt128; type: ClarityAbiTypeUInt128 }
  | { id: ClarityAbiTypeId.ClarityAbiTypeInt128; type: ClarityAbiTypeInt128 }
  | { id: ClarityAbiTypeId.ClarityAbiTypeBool; type: ClarityAbiTypeBool }
  | { id: ClarityAbiTypeId.ClarityAbiTypePrincipal; type: ClarityAbiTypePrincipal }
  | { id: ClarityAbiTypeId.ClarityAbiTypeNone; type: ClarityAbiTypeNone }
  | { id: ClarityAbiTypeId.ClarityAbiTypeBuffer; type: ClarityAbiTypeBuffer }
  | { id: ClarityAbiTypeId.ClarityAbiTypeResponse; type: ClarityAbiTypeResponse }
  | { id: ClarityAbiTypeId.ClarityAbiTypeOptional; type: ClarityAbiTypeOptional }
  | { id: ClarityAbiTypeId.ClarityAbiTypeTuple; type: ClarityAbiTypeTuple }
  | { id: ClarityAbiTypeId.ClarityAbiTypeList; type: ClarityAbiTypeList };

function getTypeUnion(val: ClarityAbiType): ClarityAbiTypeUnion {
  if (isClarityAbiPrimitive(val)) {
    if (val === 'uint128') {
      return { id: ClarityAbiTypeId.ClarityAbiTypeUInt128, type: val };
    } else if (val === 'int128') {
      return { id: ClarityAbiTypeId.ClarityAbiTypeInt128, type: val };
    } else if (val === 'bool') {
      return { id: ClarityAbiTypeId.ClarityAbiTypeBool, type: val };
    } else if (val === 'principal') {
      return { id: ClarityAbiTypeId.ClarityAbiTypePrincipal, type: val };
    } else if (val === 'none') {
      return { id: ClarityAbiTypeId.ClarityAbiTypeNone, type: val };
    } else {
      throw new Error(`Unexpected Clarity ABI type primitive: ${JSON.stringify(val)}`);
    }
  } else if (isClarityAbiBuffer(val)) {
    return { id: ClarityAbiTypeId.ClarityAbiTypeBuffer, type: val };
  } else if (isClarityAbiResponse(val)) {
    return { id: ClarityAbiTypeId.ClarityAbiTypeResponse, type: val };
  } else if (isClarityAbiOptional(val)) {
    return { id: ClarityAbiTypeId.ClarityAbiTypeOptional, type: val };
  } else if (isClarityAbiTuple(val)) {
    return { id: ClarityAbiTypeId.ClarityAbiTypeTuple, type: val };
  } else if (isClarityAbiList(val)) {
    return { id: ClarityAbiTypeId.ClarityAbiTypeList, type: val };
  } else {
    throw new Error(`Unexpected Clarity ABI type: ${JSON.stringify(val)}`);
  }
}

function encodeClarityValue(type: ClarityAbiType, val: string): ClarityValue;
function encodeClarityValue(type: ClarityAbiTypeUnion, val: string): ClarityValue;
function encodeClarityValue(
  input: ClarityAbiTypeUnion | ClarityAbiType,
  val: string
): ClarityValue {
  let union: ClarityAbiTypeUnion;
  if ((input as ClarityAbiTypeUnion).id !== undefined) {
    union = input as ClarityAbiTypeUnion;
  } else {
    union = getTypeUnion(input as ClarityAbiType);
  }
  switch (union.id) {
    case ClarityAbiTypeId.ClarityAbiTypeUInt128:
      return uintCV(val);
    case ClarityAbiTypeId.ClarityAbiTypeInt128:
      return intCV(val);
    case ClarityAbiTypeId.ClarityAbiTypeBool:
      if (val === 'false' || val === '0') return falseCV();
      else if (val === 'true' || val === '1') return trueCV();
      else throw new Error(`Unexpected Clarity bool value: ${JSON.stringify(val)}`);
    case ClarityAbiTypeId.ClarityAbiTypePrincipal:
      if (val.includes('.')) {
        const [addr, name] = val.split('.');
        return contractPrincipalCV(addr, name);
      } else {
        return standardPrincipalCV(val);
      }
    case ClarityAbiTypeId.ClarityAbiTypeNone:
      return noneCV();
    case ClarityAbiTypeId.ClarityAbiTypeBuffer:
      return bufferCV(Buffer.from(val, 'utf8'));
    case ClarityAbiTypeId.ClarityAbiTypeResponse:
      throw new NotImplementedError(`Unsupported encoding for Clarity type: ${union.id}`);
    case ClarityAbiTypeId.ClarityAbiTypeOptional:
      throw new NotImplementedError(`Unsupported encoding for Clarity type: ${union.id}`);
    case ClarityAbiTypeId.ClarityAbiTypeTuple:
      throw new NotImplementedError(`Unsupported encoding for Clarity type: ${union.id}`);
    case ClarityAbiTypeId.ClarityAbiTypeList:
      throw new NotImplementedError(`Unsupported encoding for Clarity type: ${union.id}`);
    default:
      throw new Error(`Unexpected Clarity type ID: ${JSON.stringify(union)}`);
  }
}
export { encodeClarityValue };

export function getTypeString(val: ClarityAbiType): string {
  if (isClarityAbiPrimitive(val)) {
    return val;
  } else if (isClarityAbiBuffer(val)) {
    return `buffer(${val.buffer.length})`;
  } else if (isClarityAbiResponse(val)) {
    return `response(${getTypeString(val.response.ok)},${getTypeString(val.response.error)})`;
  } else if (isClarityAbiOptional(val)) {
    return `optional(${getTypeString(val.optional)})`;
  } else if (isClarityAbiTuple(val)) {
    return `tuple(${val.tuple
      .map(t => JSON.stringify(t.name) + ':' + getTypeString(t.type))
      .join(',')})`;
  } else if (isClarityAbiList(val)) {
    return `list(${getTypeString(val.list.type)},${val.list.length})`;
  } else {
    throw new Error(`Type string unsupported for Clarity type: ${JSON.stringify(val)}`);
  }
}

interface ClarityAbiFunction {
  name: string;
  access: 'private' | 'public' | 'read_only';
  args: {
    name: string;
    type: ClarityAbiType;
  }[];
  outputs: {
    type: ClarityAbiType;
  };
}

interface ClarityAbiVariable {
  name: string;
  access: 'variable' | 'constant';
  type: ClarityAbiType;
}

interface ClarityAbiMap {
  name: string;
  key: {
    name: string;
    type: ClarityAbiType;
  }[];
  value: {
    name: string;
    type: ClarityAbiType;
  }[];
}

interface ClarityAbiTypeFungibleToken {
  name: string;
}

interface ClarityAbiTypeNonFungibleToken {
  name: string;
  type: ClarityAbiType;
}

export interface ClarityAbi {
  functions: ClarityAbiFunction[];
  variables: ClarityAbiVariable[];
  maps: ClarityAbiMap[];
  fungible_tokens: ClarityAbiTypeFungibleToken[];
  non_fungible_tokens: ClarityAbiTypeNonFungibleToken[];
}
