import BigNumber from 'bignumber.js';
import * as btc from 'bitcoinjs-lib';
import * as c32check from 'c32check';

const defaultFetchTimeout = 15_000; // 15 seconds

// function throwFetchError(...args: [Error, string] | [string] | [Error]): never {
//   if (args.length === 2) {
//     const FetchError = new Error('FETCH_ERROR', 'Server fetch error: %s', 500);
//     throw new FetchError(args[1]);
//   } else {
//     const FetchError = new Error('FETCH_ERROR', 'Server fetch error: %s', 500);
//     throw new FetchError(args[0]);
//   }
// }

export enum Network {
  mainnet = 'mainnet',
  testnet = 'testnet',
}

/** Provide either a Stacks or Bitcoin address, and receive the Stacks address, Bitcoin address, and network version */
export function getAddressInfo(addr: string, network: Network = Network.mainnet) {
  let b58addr: string;
  if (addr.match(/^S[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/)) {
    b58addr = c32check.c32ToB58(addr);
  } else if (addr.match(/[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+/)) {
    b58addr = addr;
  } else {
    throw new Error(`Unrecognized address ${addr}`);
  }

  let stxAddr = c32check.b58ToC32(b58addr);

  const decodedStxAddr = c32check.c32addressDecode(stxAddr);

  // Check if address needs coerced from one network version to another
  if (network) {
    if (
      network === Network.mainnet &&
      decodedStxAddr[0] !== c32check.versions.mainnet.p2pkh &&
      decodedStxAddr[0] !== c32check.versions.mainnet.p2sh
    ) {
      if (decodedStxAddr[0] === c32check.versions.testnet.p2pkh) {
        decodedStxAddr[0] = c32check.versions.mainnet.p2pkh;
      } else if (decodedStxAddr[0] === c32check.versions.testnet.p2sh) {
        decodedStxAddr[0] = c32check.versions.testnet.p2pkh;
      } else {
        throw new Error(
          `Cannot convert address network type, unknown network version: ${decodedStxAddr[0]}`
        );
      }
    } else if (
      network === Network.testnet &&
      decodedStxAddr[0] !== c32check.versions.testnet.p2pkh &&
      decodedStxAddr[0] !== c32check.versions.testnet.p2sh
    ) {
      if (decodedStxAddr[0] === c32check.versions.mainnet.p2pkh) {
        decodedStxAddr[0] = c32check.versions.testnet.p2pkh;
      } else if (decodedStxAddr[0] === c32check.versions.mainnet.p2sh) {
        decodedStxAddr[0] = c32check.versions.testnet.p2pkh;
      } else {
        throw new Error(
          `Cannot convert address network type, unknown network version: ${decodedStxAddr[0]}`
        );
      }
    }
    stxAddr = c32check.c32address(decodedStxAddr[0], decodedStxAddr[1]);
    b58addr = c32check.c32ToB58(stxAddr);
  }

  let networkName = 'other';
  if (
    decodedStxAddr[0] === c32check.versions.testnet.p2pkh ||
    decodedStxAddr[0] === c32check.versions.testnet.p2sh
  ) {
    networkName = 'testnet';
  } else if (
    decodedStxAddr[0] === c32check.versions.mainnet.p2pkh ||
    decodedStxAddr[0] === c32check.versions.mainnet.p2sh
  ) {
    networkName = 'mainnet';
  }

  return {
    stacks: stxAddr,
    bitcoin: b58addr,
    network: networkName,
  };
}

/**
 * Parse Stacks Leader Block Commit data from a Bitcoin tx output script. Returns null if script is not a Leader Block Commit.
 * https://github.com/stacksgov/sips/blob/main/sips/sip-001/sip-001-burn-election.md#leader-block-commit
 */
export function decodeLeaderBlockCommit(txOutScript: string) {
  // Total byte length w/ OP_RETURN and lead block commit message is 83 bytes
  if (txOutScript.length !== 166) {
    return null;
  }

  const opReturnHex = '6a';
  if (!txOutScript.startsWith(opReturnHex)) {
    return null;
  }
  const decompiled = btc.script.decompile(Buffer.from(txOutScript, 'hex'));
  if (decompiled?.length !== 2) {
    return null;
  }
  const scriptData = decompiled[1];
  if (!Buffer.isBuffer(scriptData)) {
    return null;
  }

  const magicBytes = [88, 50]; // X2
  if (scriptData[0] !== magicBytes[0] || scriptData[1] !== magicBytes[1]) {
    return null;
  }

  const opLeaderBlockCommit = Buffer.from('[');
  const stxOp = scriptData.subarray(2, 3);
  if (stxOp[0] !== opLeaderBlockCommit[0]) {
    return null;
  }

  // header block hash of the Stacks anchored block
  const blockHash = scriptData.subarray(3, 35);
  const blockHashHex = blockHash.toString('hex');

  // the next value for the VRF seed
  const newSeed = scriptData.subarray(35, 67);
  const newSeedHex = newSeed.toString('hex');

  // the burn block height of this block's parent
  const parentBlock = scriptData.subarray(67, 71);
  const parentBlockInt = parentBlock.readUInt32BE(0);

  // the vtxindex for this block's parent's block commit
  const parentTxOffset = scriptData.subarray(71, 73);
  const parentTxOffsetInt = parentTxOffset.readUInt16BE(0);

  // the burn block height of the miner's VRF key registration
  const keyBlock = scriptData.subarray(73, 77);
  const keyBlockInt = keyBlock.readUInt32BE(0);

  // the vtxindex for this miner's VRF key registration
  const keyTxOffset = scriptData.subarray(77, 79);
  const keyTxOffsetInt = keyTxOffset.readUInt16BE(0);

  // the burn block height at which this leader block commit was created modulo BURN_COMMITMENT_WINDOW (=6).
  // That is, if the block commit is included in the intended burn block then this value should be equal to: (commit_burn_height - 1) % 6.
  // This field is used to link burn commitments from the same miner together even if a commitment was included in a late burn block.
  const burnParentModulus = scriptData.subarray(79, 80)[0];

  return {
    blockHash: blockHashHex,
    newSeed: newSeedHex,
    parentBlock: parentBlockInt,
    parentTxOffset: parentTxOffsetInt,
    keyBlock: keyBlockInt,
    keyTxOffset: keyTxOffsetInt,
    burnParentModulus,
  };
}

export async function fetchJson<TOkResponse = unknown, TErrorResponse = unknown>(args: {
  url: URL;
  init?: RequestInit | undefined;
  timeoutMs?: number;
}): Promise<
  (
    | {
        result: 'ok';
        status: number;
        response: TOkResponse;
      }
    | {
        result: 'error';
        status: number;
        response: TErrorResponse;
      }
  ) & { getCurlCmd: () => string }
> {
  const requestInit: RequestInit = {
    signal: (AbortSignal as any).timeout(args.timeoutMs ?? defaultFetchTimeout),
    ...args.init,
  };
  const headers = new Headers(requestInit.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  requestInit.headers = headers;
  const req = new Request(args.url, requestInit);

  const getCurlCmd = () => {
    let curl = `curl -i -X ${req.method} '${req.url}'`;
    if (args.init?.body) {
      if (typeof args.init.body === 'string') {
        curl += ` -H 'Content-Type: application/json' -d '${args.init.body.replace(
          /'/g,
          `'\\''`
        )}'`;
      } else {
        throw new Error(`Can only create curl command for request bodies with string type`);
      }
    }
    return curl;
  };

  let resp: Response;
  try {
    resp = await fetch(req);
  } catch (error) {
    const errorMsg = `${req.method} ${req.url} - error performing fetch: ${error}`;
    // throwFetchError(error as Error, errorMsg);
    throw error;
  }

  let respText = '';
  try {
    respText = await resp.text();
  } catch (error) {
    const errorMsg = `${req.method} ${req.url} - error reading response ${resp.status}: ${respText}`;
    // throwFetchError(error as Error, errorMsg);
    throw error;
  }

  let respBody: unknown;
  try {
    respBody = JSON.parse(respText);
  } catch (error) {
    if (resp.ok) {
      const errorMsg = `${req.method} ${req.url} - error parsing JSON response ${resp.status}: ${respText}`;
      //   throwFetchError(error as Error, errorMsg);
      throw error;
    }
  }

  if (resp.ok) {
    return { result: 'ok', status: resp.status, response: respBody as TOkResponse, getCurlCmd };
  } else {
    return {
      result: 'error',
      status: resp.status,
      response: (respBody ?? respText) as TErrorResponse,
      getCurlCmd,
    };
  }
}

/**
 * Parse a STX-transfer operation from a Bitcoin tx out script.
 */
export function decodeStxTransferOp(txOutScript: string) {
  const opReturnHex = '6a';
  if (!txOutScript.startsWith(opReturnHex)) {
    return null;
  }
  const decompiled = btc.script.decompile(Buffer.from(txOutScript, 'hex'));
  if (decompiled?.length !== 2) {
    return null;
  }
  const scriptData = decompiled[1];
  if (!Buffer.isBuffer(scriptData)) {
    return null;
  }

  const magicBytes = [88, 50]; // X2
  if (scriptData[0] !== magicBytes[0] || scriptData[1] !== magicBytes[1]) {
    return null;
  }

  const stxTransferOpCode = Buffer.from('$');
  const stxOp = scriptData.subarray(2, 3);
  if (stxOp[0] !== stxTransferOpCode[0]) {
    return null;
  }

  const microAmount = BigInt('0x' + scriptData.subarray(3, 19).toString('hex'));
  const stxAmount = new BigNumber(microAmount.toString()).shiftedBy(-6).toFixed(6);

  return {
    stxAmount: stxAmount,
  };
}

/**
 * Parse Stacks Leader VRF Key Registration data from a Bitcoin tx output script. Returns null if script is not a Leader VRF Key Registration.
 * https://github.com/stacksgov/sips/blob/main/sips/sip-001/sip-001-burn-election.md#leader-vrf-key-registrations
 */
export function decodeLeaderVrfKeyRegistration(txOutScript: string) {
  const opReturnHex = '6a';
  if (!txOutScript.startsWith(opReturnHex)) {
    return null;
  }
  const decompiled = btc.script.decompile(Buffer.from(txOutScript, 'hex'));
  if (decompiled?.length !== 2) {
    return null;
  }
  let scriptData = decompiled[1];
  if (!Buffer.isBuffer(scriptData)) {
    return null;
  }

  const magicBytes = [88, 50]; // X2
  if (scriptData[0] !== magicBytes[0] || scriptData[1] !== magicBytes[1]) {
    return null;
  }

  const opLeaderVrfKeyRegistration = Buffer.from('^');
  const stxOp = scriptData.subarray(2, 3);
  if (stxOp[0] !== opLeaderVrfKeyRegistration[0]) {
    return null;
  }

  // the current consensus hash for the burnchain state of the Stacks blockchain
  const consensusHash = scriptData.subarray(3, 23);
  const consensusHashHex = consensusHash.toString('hex');

  // the 32-byte public key used in the miner's VRF proof
  const provingPublicKey = scriptData.subarray(23, 55);
  const provingPublicKeyHex = provingPublicKey.toString('hex');

  // a field for including a miner memo
  let memo: string | null = null;
  if (scriptData.length > 55) {
    memo = scriptData.subarray(55).toString('hex');
  }

  return {
    consensusHash: consensusHashHex,
    provingPublicKey: provingPublicKeyHex,
    memo: memo,
  };
}
