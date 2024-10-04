import { isValidPrincipal } from './../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../errors';
import { has0xPrefix, hexToBuffer } from '@hirosystems/api-toolkit';

/**
 * Determines if the query parameters of a request are intended to include data for a specific block height,
 * or if the request intended to include unanchored tx data. If neither a block height parameter or an unanchored
 * parameter are given, then we assume the request is not intended for a specific block, and that it's not intended
 * to include unanchored tx data.
 * If an error is encountered while parsing the params then a 400 response with an error message is sent and the function throws.
 */
export function getBlockParams(
  height: number | undefined,
  unanchored: boolean | undefined
):
  | {
      blockHeight: number;
      includeUnanchored?: boolean;
    }
  | {
      includeUnanchored: boolean;
      blockHeight?: number;
    }
  | never {
  if (height !== undefined) {
    return { blockHeight: height };
  } else {
    return { includeUnanchored: unanchored ?? false };
  }
}

/**
 * Determine if until_block query parameter exists or is an integer or string or if it is a valid height
 * if it is a string with "0x" prefix consider it a block_hash if it is integer consider it block_height
 * If type is not string or block_height is not valid or it also has mutually exclusive "unanchored" property a 400 bad requst is send and function throws.
 * @returns `undefined` if param does not exist || block_height if number || block_hash if string || never if error
 */
export function parseUntilBlockQuery(
  untilBlock: string | undefined,
  unanchored: boolean | undefined
): undefined | number | string {
  if (!untilBlock) return;
  if (typeof untilBlock === 'string') {
    if (unanchored) {
      // if mutually exclusive unachored is also specified, throw bad request error
      throw new InvalidRequestError(
        `can't handle both 'unanchored=true' and 'until_block' in the same request`,
        InvalidRequestErrorType.bad_request
      );
    }
    if (has0xPrefix(untilBlock)) {
      //case for block_hash
      return untilBlock;
    } else {
      //parse int to check if it is a block_height
      const block_height = Number.parseInt(untilBlock, 10);
      if (isNaN(block_height) || block_height < 1) {
        throw new InvalidRequestError(
          `Unexpected integer value for block height path parameter`,
          InvalidRequestErrorType.bad_request
        );
      }
      return block_height;
    }
  }
}

export function validateRequestHexInput(hash: string) {
  try {
    const buffer = hexToBuffer(hash);
    if (buffer.toString('hex') !== hash.substring(2).toLowerCase()) {
      throw new Error('Invalid hash characters');
    }
  } catch (error: any) {
    throw new InvalidRequestError(error.message, InvalidRequestErrorType.invalid_hash);
  }
}

export function validatePrincipal(stxAddress: string) {
  if (!isValidPrincipal(stxAddress)) {
    throw new InvalidRequestError(
      `invalid STX address "${stxAddress}"`,
      InvalidRequestErrorType.invalid_address
    );
  }
}

export function isValidTxId(tx_id: string) {
  try {
    validateRequestHexInput(tx_id);
    return true;
  } catch {
    return false;
  }
}
