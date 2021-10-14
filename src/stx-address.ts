import { createHash } from 'crypto';
import { Address } from '@stacks/transactions';

const c32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const hex = '0123456789abcdef';

export function decodeStxAddress(address: Address): string {
  return c32address(address.version, address.hash160).toString();
}

/**
 * Make a c32check address with the given version and hash160
 * The only difference between a c32check string and c32 address
 * is that the letter 'S' is pre-pended.
 * @param version - the address version number
 * @param hash160hex - the hash160 to encode (must be a hash160)
 * @returns the address
 */
export function c32address(version: number, hash160hex: string): string {
  const c32string = c32checkEncode(version, hash160hex);
  return 'S' + c32string;
}

/**
 * Encode a hex string as a c32check string.  This is a lot like how
 * base58check works in Bitcoin-land, but this algorithm uses the
 * z-base-32 alphabet instead of the base58 alphabet.  The algorithm
 * is as follows:
 * * calculate the c32checksum of version + data
 * * c32encode version + data + c32checksum
 * @param version - the version string (between 0 and 31)
 * @param data - the data to encode
 * @returns the c32check representation
 */
function c32checkEncode(version: number, data: string): string {
  data = data.toLowerCase();
  if (data.length % 2 !== 0) {
    data = `0${data}`;
  }

  let versionHex = version.toString(16);
  if (versionHex.length === 1) {
    versionHex = `0${versionHex}`;
  }

  const checksumHex = c32checksum(`${versionHex}${data}`);
  const c32str = c32encode(`${data}${checksumHex}`);
  return `${c32[version]}${c32str}`;
}

/**
 * Get the c32check checksum of a hex-encoded string
 * @param dataHex - the hex string
 * @returns the c32 checksum, as a bin-encoded string
 */
function c32checksum(dataHex: string): string {
  const dataHash = hashSha256(hashSha256(Buffer.from(dataHex, 'hex')));
  const checksum = dataHash.slice(0, 4).toString('hex');
  return checksum;
}

/**
 * Encode a hex string as a c32 string.  Note that the hex string is assumed
 * to be big-endian (and the resulting c32 string will be as well).
 * @param inputHex - the input to encode
 * @param minLength - the minimum length of the c32 string
 * @returns the c32check-encoded representation of the data, as a string
 */
function c32encode(inputHex: string, minLength?: number): string {
  if (inputHex.length % 2 !== 0) {
    inputHex = `0${inputHex}`;
  }
  inputHex = inputHex.toLowerCase();

  let res: string[] = [];
  let carry = 0;
  for (let i = inputHex.length - 1; i >= 0; i--) {
    if (carry < 4) {
      const currentCode = hex.indexOf(inputHex[i]) >> carry;
      let nextCode = 0;
      if (i !== 0) {
        nextCode = hex.indexOf(inputHex[i - 1]);
      }
      // carry = 0, nextBits is 1, carry = 1, nextBits is 2
      const nextBits = 1 + carry;
      const nextLowBits = nextCode % (1 << nextBits) << (5 - nextBits);
      const curC32Digit = c32[currentCode + nextLowBits];
      carry = nextBits;
      res.unshift(curC32Digit);
    } else {
      carry = 0;
    }
  }

  let C32leadingZeros = 0;
  for (let i = 0; i < res.length; i++) {
    if (res[i] !== '0') {
      break;
    } else {
      C32leadingZeros++;
    }
  }

  res = res.slice(C32leadingZeros);

  const zeroPrefix = /^\u0000*/.exec(Buffer.from(inputHex, 'hex').toString());
  const numLeadingZeroBytesInHex = zeroPrefix ? zeroPrefix[0].length : 0;

  for (let i = 0; i < numLeadingZeroBytesInHex; i++) {
    res.unshift(c32[0]);
  }

  if (minLength) {
    const count = minLength - res.length;
    for (let i = 0; i < count; i++) {
      res.unshift(c32[0]);
    }
  }

  return res.join('');
}

function hashSha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}
