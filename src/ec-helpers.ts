import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairAPI, ECPairFactory, ECPairInterface } from 'ecpair';
import { coerceToBuffer } from './helpers';

export { ECPairInterface };

export const ECPair: ECPairAPI = ECPairFactory(ecc);

export function validateSigFunction(pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean {
  return ECPair.fromPublicKey(pubkey).verify(msghash, signature);
}

const BITCOIN_NETWORKS = {
  mainnet: bitcoin.networks.bitcoin,
  testnet: bitcoin.networks.testnet,
  regtest: bitcoin.networks.regtest,
} as const;

type KeyInputArgs = { network: keyof typeof BITCOIN_NETWORKS } & (
  | { privateKey: Buffer | string }
  | { publicKey: Buffer | string }
);

interface KeyOutput {
  address: string;
  ecPair: ECPairInterface;
}

function ecPairFromKeyInputArgs(args: KeyInputArgs, allowXOnlyPubkey = false): ECPairInterface {
  const network = BITCOIN_NETWORKS[args.network];
  if ('privateKey' in args) {
    let keyBuff = coerceToBuffer(args.privateKey);
    if (keyBuff.length === 33 && keyBuff[32] === 0x01) {
      keyBuff = keyBuff.slice(0, 32); // Drop the compression byte suffix
    }
    return ECPair.fromPrivateKey(keyBuff, { compressed: true, network });
  } else {
    let keyBuff = coerceToBuffer(args.publicKey);
    if (allowXOnlyPubkey && keyBuff.length === 32) {
      // Allow x-only pubkeys, defined in BIP340 (no y parity byte prefix)
      const X_ONLY_PUB_KEY_TIE_BREAKER = 0x02;
      keyBuff = Buffer.concat([Buffer.from([X_ONLY_PUB_KEY_TIE_BREAKER]), keyBuff]);
    }
    return ECPair.fromPublicKey(keyBuff, { compressed: true, network });
  }
}

/**
 * Creates a P2PKH "Pay To Public Key Hash" address.
 * `hashbytes` is the 20-byte hash160 of a single public key.
 * Encoded as base58.
 */
function p2pkhAddressFromKey(args: KeyInputArgs): KeyOutput {
  const network = BITCOIN_NETWORKS[args.network];
  const ecPair = ecPairFromKeyInputArgs(args, true);

  const p2pkhhResult = bitcoin.payments.p2pkh({ pubkey: ecPair.publicKey, network });
  if (!p2pkhhResult.address) {
    throw new Error(
      `Could not create P2PKH address from pubkey ${ecPair.publicKey.toString('hex')}`
    );
  }
  return { ecPair, address: p2pkhhResult.address };
}

/**
 * Creates a P2SH "Pay To Script Hash" address.
 * Typically used to generate multi-signature wallets, however, this function creates a P2PKH wrapped in P2SH address.
 * `hashbytes` is the 20-byte hash160 of a redeemScript script.
 * Encoded as base58.
 */
function p2shAddressFromKey(args: KeyInputArgs): KeyOutput {
  const network = BITCOIN_NETWORKS[args.network];
  const ecPair = ecPairFromKeyInputArgs(args, true);

  // P2SH(P2PKH) address example '3D4sXNTgnVbEWaU58pDgBD82zDkthVWazv' from https://matheo.uliege.be/bitstream/2268.2/11236/4/Master_Thesis.pdf
  const p2sh_p2pkh_Result = bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2pkh({ pubkey: ecPair.publicKey, network }),
    network,
  });

  // P2SH(P2PK) address example '3EuJgd52Tme58nZewZa39svoDtSUgL4Mgn' from https://matheo.uliege.be/bitstream/2268.2/11236/4/Master_Thesis.pdf
  // const p2sh_p2pk_Result = bitcoin.payments.p2sh({
  //   redeem: bitcoin.payments.p2pk({ pubkey: ecPair.publicKey, network }),
  //   network,
  // });

  // 1-of-1 multisig, not sure if valid ...
  // const p2shResult1 = bitcoin.payments.p2sh({
  //   redeem: bitcoin.payments.p2ms({ pubkeys: [ecPair.publicKey], m: 1, network }),
  //   network,
  // });

  if (!p2sh_p2pkh_Result.address) {
    throw new Error(
      `Could not create P2SH address from pubkey ${ecPair.publicKey.toString('hex')}`
    );
  }
  return { ecPair, address: p2sh_p2pkh_Result.address };
}

/**
 * Creates a P2SH-P2WPHK "Pay To Witness Public Key Hash Wrapped In P2SH" address.
 * Used to generate a segwit P2WPKH address nested in a legacy legacy P2SH address.
 * Allows non-SegWit wallets to generate a SegWit transaction, and allows non-SegWit client accept SegWit transaction.
 * `hashbytes` is the 20-byte hash160 of a p2wpkh witness script
 * Encoded as base58.
 */
function p2shp2wpkhAddressFromKey(args: KeyInputArgs): KeyOutput {
  const network = BITCOIN_NETWORKS[args.network];
  const ecPair = ecPairFromKeyInputArgs(args, true);

  const p2shResult = bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wpkh({ pubkey: ecPair.publicKey, network }),
    network,
  });
  if (!p2shResult.address) {
    throw new Error(
      `Could not create P2SH-P2WPHK address from pubkey ${ecPair.publicKey.toString('hex')}`
    );
  }
  return { ecPair, address: p2shResult.address };
}

/**
 * Creates a P2SH-P2WSH "Pay To Witness Script Hash Wrapped In P2SH" address.
 * Used to generate a segwit P2WSH address nested in a legacy legacy P2SH address.
 * Typically used for multi-signature wallets, however, this function creates a 1-of-1 "multisig" address.
 * Allows non-SegWit wallets to generate a SegWit transaction, and allows non-SegWit client accept SegWit transaction.
 */
function p2shp2wshAddressFromKeys(args: KeyInputArgs): KeyOutput {
  const network = BITCOIN_NETWORKS[args.network];
  const ecPair = ecPairFromKeyInputArgs(args, true);

  const p2shResult = bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wsh({
      redeem: bitcoin.payments.p2ms({ m: 1, pubkeys: [ecPair.publicKey], network }),
      network,
    }),
    network,
  });
  if (!p2shResult.address) {
    throw new Error(
      `Could not create P2SH-P2WPHK address from pubkey ${ecPair.publicKey.toString('hex')}`
    );
  }
  return { ecPair, address: p2shResult.address };
}

/**
 * Creates a P2WPKH "Pay To Witness Public Key Hash" address.
 * Used to generated standard segwit addresses.
 * `hashbytes` is the 20-byte hash160 of the witness script.
 * Encoded as SEGWIT_V0 / bech32.
 */
function p2wpkhAddressFromKey(args: KeyInputArgs): KeyOutput {
  const network = BITCOIN_NETWORKS[args.network];
  const ecPair = ecPairFromKeyInputArgs(args, true);

  const p2wpkhResult = bitcoin.payments.p2wpkh({ pubkey: ecPair.publicKey, network });
  if (!p2wpkhResult.address) {
    throw new Error(
      `Could not create p2wpkh address from pubkey ${ecPair.publicKey.toString('hex')}`
    );
  }
  return { ecPair, address: p2wpkhResult.address };
}

/**
 * Creates a P2WSH "Pay To Witness Script Hash" address.
 * Typically used to generate multi-signature segwit wallets, however, this function creates a 1-of-1 "multisig" address.
 * `hashbytes` is the 32-byte sha256 of the witness script.
 * Encoded as SEGWIT_V0 / bech32.
 */
function p2wshAddressFromKey(args: KeyInputArgs): KeyOutput {
  const network = BITCOIN_NETWORKS[args.network];
  const ecPair = ecPairFromKeyInputArgs(args, true);

  const p2wshResult = bitcoin.payments.p2wsh({
    redeem: bitcoin.payments.p2ms({ m: 1, pubkeys: [ecPair.publicKey], network }),
    network,
  });
  if (!p2wshResult.address) {
    throw new Error(
      `Could not create p2wpkh address from pubkey ${ecPair.publicKey.toString('hex')}`
    );
  }
  return { ecPair, address: p2wshResult.address };
}

/**
 * Creates a P2TR "Pay To Taproot" address.
 * Uses the tweaked p2tr key-spend only address encoding recommended by BIP341.
 * Encoded as SEGWIT_V1 / bech32m.
 * @see https://github.com/bitcoinjs/bitcoinjs-lib/blob/424abf2376772bb57b7668bc35b29ed18879fa0a/test/integration/taproot.md
 */
function p2trAddressFromKey(args: KeyInputArgs): KeyOutput {
  const network = BITCOIN_NETWORKS[args.network];
  const ecPair = ecPairFromKeyInputArgs(args, true);
  bitcoin.initEccLib(ecc);
  const pmnt = bitcoin.payments.p2tr({
    internalPubkey: ecPair.publicKey.slice(1, 33),
    network: network,
  });
  if (!pmnt.address) {
    throw new Error(`Could not create p2tr address from key`);
  }
  return { ecPair, address: pmnt.address };
}

export interface VerboseKeyOutput {
  address: string;
  wif: string;
  privateKey: Buffer;
  publicKey: Buffer;
}

export type BitcoinAddressFormat =
  | 'p2pkh'
  | 'p2sh'
  | 'p2sh-p2wpkh'
  | 'p2sh-p2wsh'
  | 'p2wpkh'
  | 'p2wsh'
  | 'p2tr';

export function getBitcoinAddressFromKey<TVerbose extends boolean = false>(
  args: KeyInputArgs & {
    addressFormat: BitcoinAddressFormat;
    verbose?: TVerbose;
  }
): TVerbose extends true ? VerboseKeyOutput : string {
  const keyOutput: KeyOutput = (() => {
    switch (args.addressFormat) {
      case 'p2pkh':
        return p2pkhAddressFromKey(args);
      case 'p2sh':
        return p2shAddressFromKey(args);
      case 'p2sh-p2wpkh':
        return p2shp2wpkhAddressFromKey(args);
      case 'p2sh-p2wsh':
        return p2shp2wshAddressFromKeys(args);
      case 'p2wpkh':
        return p2wpkhAddressFromKey(args);
      case 'p2wsh':
        return p2wshAddressFromKey(args);
      case 'p2tr':
        return p2trAddressFromKey(args);
    }
    throw new Error(`Unexpected address format: ${args.addressFormat}`);
  })();

  if (args.verbose) {
    const output: VerboseKeyOutput = {
      address: keyOutput.address,
      wif: keyOutput.ecPair.toWIF(),
      privateKey: keyOutput.ecPair.privateKey as Buffer,
      publicKey: keyOutput.ecPair.publicKey,
    };
    return output as TVerbose extends true ? VerboseKeyOutput : string;
  } else {
    return keyOutput.address as TVerbose extends true ? VerboseKeyOutput : string;
  }
}

export function privateToPublicKey(privateKey: string | Buffer): Buffer {
  const ecPair = ecPairFromKeyInputArgs({ privateKey, network: 'mainnet' });
  return ecPair.publicKey;
}
