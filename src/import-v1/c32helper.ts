// The b58ToC32 function from https://github.com/blockstack/c32check, optimized for speed in NodeJS.
import * as crypto from 'crypto';
import * as base58 from 'micro-base58';

const versions = {
  mainnet: {
    p2pkh: 22, // 'P'
    p2sh: 20, // 'M'
  },
  testnet: {
    p2pkh: 26, // 'T'
    p2sh: 21, // 'N'
  },
};

const ADDR_BITCOIN_TO_STACKS: Record<number, number> = {
  0: versions.mainnet.p2pkh,
  5: versions.mainnet.p2sh,
  111: versions.testnet.p2pkh,
  196: versions.testnet.p2sh,
};

const c32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const hex = '0123456789abcdef';
const hexLookup = new Map<string, number>();
[...hex].forEach((char, i) => hexLookup.set(char, i));

export function b58ToC32(b58check: string): string {
  const addrInfo = decode(b58check);
  const hash160 = addrInfo.data;
  const addrVersion = addrInfo.prefix;
  let stacksVersion = addrVersion;
  if (ADDR_BITCOIN_TO_STACKS[addrVersion] !== undefined) {
    stacksVersion = ADDR_BITCOIN_TO_STACKS[addrVersion];
  }

  const checksum = c32checksum(stacksVersion, hash160);
  const c32str = c32encode(Buffer.concat([hash160, checksum]));
  return `S${c32[stacksVersion]}${c32str}`;
}

function decode(string: string) {
  const buffer = base58.decode(string);
  const prefix = buffer[0];
  const data = buffer.slice(1, -4);
  return { prefix, data };
}

function c32checksum(version: number, data: Uint8Array) {
  let dataHash = crypto
    .createHash('sha256')
    .update(Buffer.from([version]))
    .update(data)
    .digest();
  dataHash = crypto.createHash('sha256').update(dataHash).digest();
  const checksum = dataHash.slice(0, 4);
  return checksum;
}

function c32encode(data: Buffer): string {
  const inputHex = data.toString('hex');

  let res: string[] = [];
  let carry = 0;
  for (let i = inputHex.length - 1; i >= 0; i--) {
    if (carry < 4) {
      const currentCode = (hexLookup.get(inputHex[i]) as number) >> carry;
      let nextCode = 0;
      if (i !== 0) {
        nextCode = hexLookup.get(inputHex[i - 1]) as number;
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

  const zeroPrefix = /^\u0000*/.exec(data.toString());
  const numLeadingZeroBytesInHex = zeroPrefix ? zeroPrefix[0].length : 0;

  for (let i = 0; i < numLeadingZeroBytesInHex; i++) {
    res.unshift(c32[0]);
  }

  return res.join('');
}
