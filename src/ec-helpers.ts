import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairAPI, ECPairFactory } from 'ecpair';

export { ECPairInterface } from 'ecpair';

export const ECPair: ECPairAPI = ECPairFactory(ecc);

export function validateSigFunction(pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean {
  return ECPair.fromPublicKey(pubkey).verify(msghash, signature);
}

const BITCOIN_NETWORKS = {
  mainnet: bitcoin.networks.bitcoin,
  testnet: bitcoin.networks.testnet,
  regtest: bitcoin.networks.regtest,
} as const;

/**
 * Function for creating a tweaked p2tr key-spend only address (this is recommended by BIP341)
 * @see https://github.com/bitcoinjs/bitcoinjs-lib/blob/424abf2376772bb57b7668bc35b29ed18879fa0a/test/integration/taproot.md
 */
export function p2trAddressFromPublicKey(
  publicKey: Buffer,
  network: keyof typeof BITCOIN_NETWORKS
): string {
  if (publicKey.length === 32) {
    // Defined in BIP340
    const X_ONLY_PUB_KEY_TIE_BREAKER = 0x02;
    publicKey = Buffer.concat([Buffer.from([X_ONLY_PUB_KEY_TIE_BREAKER]), publicKey]);
  }
  const ecPair = ECPair.fromPublicKey(publicKey, { compressed: true });
  const pubKeyBuffer = ecPair.publicKey;
  if (!pubKeyBuffer) {
    throw new Error(`Could not get public key`);
  }

  // x-only pubkey (remove 1 byte y parity)
  const myXOnlyPubkey = pubKeyBuffer.slice(1, 33);
  const commitHash = bitcoin.crypto.taggedHash('TapTweak', myXOnlyPubkey);
  const tweakResult = ecc.xOnlyPointAddTweak(myXOnlyPubkey, commitHash);
  if (tweakResult === null) {
    throw new Error('Invalid Tweak');
  }
  const { xOnlyPubkey: tweaked } = tweakResult;
  const scriptPubkey = Buffer.concat([
    // witness v1, PUSH_DATA 32 bytes
    Buffer.from([0x51, 0x20]),
    // x-only tweaked pubkey
    tweaked,
  ]);

  const address = bitcoin.address.fromOutputScript(scriptPubkey, BITCOIN_NETWORKS[network]);
  return address;
}

export function p2trAddressFromPrivateKey(
  privateKey: Buffer,
  network: keyof typeof BITCOIN_NETWORKS
): string {
  const ecPair = ECPair.fromPrivateKey(privateKey, { compressed: true });
  if (!ecPair.publicKey) {
    throw new Error(`Could not get public key`);
  }
  return p2trAddressFromPublicKey(ecPair.publicKey, network);
}

export function generateRandomP2TRAccount(
  network: keyof typeof BITCOIN_NETWORKS
): {
  address: string;
  privateKey: Buffer;
} {
  const ecPair = ECPair.makeRandom({ compressed: true });
  return {
    address: p2trAddressFromPublicKey(ecPair.publicKey, network),
    privateKey: ecPair.privateKey as Buffer,
  };
}
