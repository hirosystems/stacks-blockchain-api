import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';

export const isDevEnv = process.env.NODE_ENV === 'development';
export const isTestEnv = process.env.NODE_ENV === 'test';

export const PROJECT_DIR = path.dirname(__dirname);

function createEnumChecker<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue }
): (value: number) => value is TEnumValue {
  // Create a set of valid enum number values.
  const enumValues = Object.values<number>(enumVariable).filter(v => typeof v === 'number');
  const enumValueSet = new Set<number>(enumValues);
  return (value: number): value is TEnumValue => enumValueSet.has(value);
}

const enumCheckFunctions = new Map<object, (value: number) => boolean>();

/**
 * Type guard to check if a given value is a valid enum value.
 * @param enumVariable - Literal `enum` type.
 * @param value - A value to check against the enum's values.
 * @example
 * ```ts
 * enum Color {
 *   Purple = 3,
 *   Orange = 5
 * }
 * const val: number = 3;
 * if (isEnum(Color, val)) {
 *   // `val` is known as enum type `Color`, e.g.:
 *   const colorVal: Color = val;
 * }
 * ```
 */
export function isEnum<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue },
  value: number
): value is TEnumValue {
  const checker = enumCheckFunctions.get(enumVariable);
  if (checker !== undefined) {
    return checker(value);
  }
  const newChecker = createEnumChecker(enumVariable);
  enumCheckFunctions.set(enumVariable, newChecker);
  return isEnum(enumVariable, value);
}

const enumMaps = new Map<object, Map<unknown, unknown>>();

export function getEnumDescription<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue },
  value: number
): string {
  const enumMap = enumMaps.get(enumVariable);
  if (enumMap !== undefined) {
    const enumKey = enumMap.get(value);
    if (enumKey !== undefined) {
      return `${value} '${enumKey}'`;
    } else {
      return `${value}`;
    }
  }

  // Create a map of `[enumValue: number]: enumNameString`
  const enumValues = Object.entries(enumVariable)
    .filter(([, v]) => typeof v === 'number')
    .map<[number, string]>(([k, v]) => [v as number, k]);
  const newEnumMap = new Map(enumValues);
  enumMaps.set(enumVariable, newEnumMap);
  return getEnumDescription(enumVariable, value);
}

let didLoadDotEnv = false;

export function loadDotEnv(): void {
  if (didLoadDotEnv) {
    return;
  }
  const dotenvConfig = dotenv.config();
  if (dotenvConfig.error) {
    console.error(`Error loading .env file: ${dotenvConfig.error}`);
    console.error(dotenvConfig.error);
    throw dotenvConfig.error;
  }
  didLoadDotEnv = true;
}

export function parsePort(portVal: string | undefined): number | undefined {
  if (portVal === undefined) {
    return undefined;
  }
  if (/^[-+]?(\d+|Infinity)$/.test(portVal)) {
    const port = Number(portVal);
    if (port < 1 || port > 65535) {
      throw new Error(`Port ${port} is invalid`);
    }
    return port;
  } else {
    throw new Error(`Port ${portVal} is invalid`);
  }
}

export function getCurrentGitTag(): string {
  if (!isDevEnv && !isTestEnv) {
    const tagEnvVar = (process.env.GIT_TAG || '').trim();
    if (!tagEnvVar) {
      const error =
        'Production requires the GIT_TAG env var to be set. Set `NODE_ENV=development` to use the current git tag';
      console.error(error);
      throw new Error(error);
    }
    return tagEnvVar;
  }

  try {
    const gitTag = (execSync('git tag --points-at HEAD', { encoding: 'utf8' }) ?? '').trim();
    const gitCommit = (execSync('git rev-parse --short HEAD', { encoding: 'utf8' }) ?? '').trim();
    const result = gitTag || gitCommit;
    if (!result) {
      throw new Error('no git tag or commit hash available');
    }
    return result;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/** JSON.stringify with support for bigint types. */
export function jsonStringify(obj: object): string {
  const stringified = JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'bigint') {
      return '0x' + value.toString(16);
    }
    return value;
  });
  return stringified;
}

/** Encodes a buffer as a `0x` prefixed lower-case hex string. */
export function bufferToHexPrefixString(buff: Buffer): string {
  return '0x' + buff.toString('hex');
}

/**
 * Decodes a `0x` prefixed hex string to a buffer.
 * @param hex - A hex string with a `0x` prefix.
 */
export function hexToBuffer(hex: string): Buffer {
  if (!hex.startsWith('0x')) {
    throw new Error(`Hex string is missing the "0x" prefix: "${hex}"`);
  }
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string is an odd number of digits: ${hex}`);
  }
  return Buffer.from(hex.substring(2), 'hex');
}
