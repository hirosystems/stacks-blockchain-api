import { CoreRpcError } from '@stacks/rpc-client';
import { isPgConnectionError } from '@stacks/api-toolkit';

// Low-level socket error codes thrown when a backing node (bitcoind RPC or the Stacks core node
// RPC) that a faucet depends on is down or unreachable.
const NODE_CONNECTION_ERROR_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
];

/**
 * Detects whether an error was caused by an unreachable backing node. Node's socket errors expose a
 * `code`, but some HTTP clients (e.g. undici/`fetch`) nest the original error under `cause`, so we
 * check both, plus the message text as a last resort.
 */
export function isNodeConnectionError(error: unknown): boolean {
  const err = error as (Error & { code?: string; cause?: { code?: string } }) | undefined;
  const code = err?.code ?? err?.cause?.code;
  if (code && NODE_CONNECTION_ERROR_CODES.includes(code)) {
    return true;
  }
  const message = err?.message ?? '';
  return (
    NODE_CONNECTION_ERROR_CODES.some(c => message.includes(c)) || /fetch failed/i.test(message)
  );
}

/**
 * Detects a failure caused by the faucet's own account running out of funds. This is an operational
 * condition (the faucet account needs refilling) rather than a client error. It surfaces as:
 *  - `NotEnoughFunds`: the Stacks node rejecting an STX/sBTC faucet transaction, and
 *  - `not enough total amount in utxo set`: the BTC faucet having no spendable UTXOs to build a tx
 *    (note the funds may be present but not yet spendable, e.g. immature coinbase or unconfirmed).
 */
export function isInsufficientFundsError(error: unknown): boolean {
  if (getTxRejectionReason(error) === 'NotEnoughFunds') {
    return true;
  }
  const message = (error as Error | undefined)?.message ?? '';
  return message.includes('not enough total amount in utxo');
}

/**
 * Extracts the Stacks node's mempool rejection reason (e.g. `ConflictingNonceInMempool`) from a
 * failed `/v2/transactions` broadcast. The node responds `400` with a JSON body like
 * `{ error: 'transaction rejected', reason: 'TooMuchChaining', ... }`, which `CoreRpcError`
 * surfaces under `details.error`.
 */
export function getTxRejectionReason(error: unknown): string | undefined {
  if (!(error instanceof CoreRpcError)) {
    return undefined;
  }
  const body = (error.details as { error?: { reason?: unknown } } | undefined)?.error;
  return typeof body?.reason === 'string' ? body.reason : undefined;
}

/**
 * The sanitized outcome of an unhandled faucet error: which status to respond with, the
 * client-facing message, and the reason to record in the server log. Faucet handlers talk to
 * backing nodes whose failures would otherwise surface as a generic `500` leaking internal details
 * (e.g. the node's host/port), so every route's error handler runs its error through here and then
 * renders the result in its own response shape.
 */
export interface ClassifiedFaucetError {
  statusCode: number;
  /** Client-facing error message. Never includes details of the backing node. */
  message: string;
  /**
   * Operator-facing reason, appended to the server log line. Undefined for an unrecognized error,
   * which is logged without a suffix.
   */
  logReason?: string;
}

export function classifyFaucetError(error: unknown): ClassifiedFaucetError {
  if (isPgConnectionError(error)) {
    return {
      statusCode: 503,
      message: 'Faucet is temporarily unavailable, please try again later',
      logReason: 'database unavailable',
    };
  }
  if (isNodeConnectionError(error)) {
    return {
      statusCode: 503,
      message: 'Faucet is temporarily unavailable, please try again later',
      logReason: 'backing node is unreachable',
    };
  }
  if (isInsufficientFundsError(error)) {
    return {
      statusCode: 503,
      message: 'The faucet is temporarily out of funds, please try again later',
      logReason: 'faucet account is out of funds',
    };
  }
  return {
    statusCode: 500,
    message: 'Faucet request failed, please try again later',
  };
}
