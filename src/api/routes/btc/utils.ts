import * as c32check from 'c32check';

/** Provide either a Stacks or Bitcoin address, and receive the Stacks address, Bitcoin address, and network version */
export function getAddressInfo(addr: string, network: 'mainnet' | 'testnet' = 'mainnet') {
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
      network === 'mainnet' &&
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
      network === 'testnet' &&
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
