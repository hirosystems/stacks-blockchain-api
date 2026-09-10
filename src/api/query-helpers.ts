import { isValidPrincipal } from './../helpers.js';
import { InvalidRequestError, InvalidRequestErrorType } from '../errors.js';
import { has0xPrefix, hexToBuffer } from '@stacks/api-toolkit';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

/**
 * Determines if the query parameters of a request are intended to include data for a specific block
 * height. If no block height parameter is given, the request is for the current chain tip.
 */
export function getBlockParams(height: number | undefined): { blockHeight?: number } {
  return height !== undefined ? { blockHeight: height } : {};
}

/**
 * Determine if until_block query parameter exists or is an integer or string or if it is a valid height
 * if it is a string with "0x" prefix consider it a block_hash if it is integer consider it block_height
 * If type is not string or block_height is not valid a 400 bad requst is send and function throws.
 * @returns `undefined` if param does not exist || block_height if number || block_hash if string || never if error
 */
export function parseUntilBlockQuery(untilBlock: string | undefined): undefined | number | string {
  if (!untilBlock) return;
  if (typeof untilBlock === 'string') {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/**
 * Builds a `preValidation` hook that normalizes an array-typed querystring parameter accepted in
 * two forms: repeated (`?tx_id=A&tx_id=B`) and comma-separated (`?tx_id=A,B`).
 *
 * Fastify's `qs` parser already yields an array for the repeated form, so only the comma-separated
 * form needs splitting and only before validation runs, since the schema declares the parameter as
 * an array and would otherwise reject the single string.
 * @param param - Name of the querystring parameter to normalize.
 * @returns A `preValidation` hook that splits the parameter when it arrives as a string.
 */
export function splitCommaSeparatedQueryParam(param: string) {
  return (req: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) => {
    const query = req.query as Record<string, unknown>;
    const value = query[param];
    if (typeof value === 'string') {
      query[param] = value.split(',');
    }
    done();
  };
}
