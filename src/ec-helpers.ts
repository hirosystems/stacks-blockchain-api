import * as tinysecp from 'tiny-secp256k1';
import { ECPairInterface, ECPairAPI, ECPairFactory } from 'ecpair';
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
function validateSigFunction(pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean {
  return ECPair.fromPublicKey(pubkey).verify(msghash, signature);
}
export { ECPairInterface, ECPair, tinysecp, validateSigFunction };
