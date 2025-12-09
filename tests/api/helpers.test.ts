/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as c32check from 'c32check';
import {
  bitcoinToStacksAddress,
  stacksToBitcoinAddress,
} from '@hirosystems/stacks-encoding-native-js';
import * as c32AddrCache from '../../src/c32-addr-cache';
import { ADDR_CACHE_ENV_VAR } from '../../src/c32-addr-cache';
import { isValidBitcoinAddress, getUintEnvOrDefault, BitVec } from '../../src/helpers';
import { ECPair, getBitcoinAddressFromKey } from '../../src/ec-helpers';
import { decodeBtcAddress, poxAddressToBtcAddress } from '@stacks/stacking';
import { has0xPrefix } from '@hirosystems/api-toolkit';

describe('has0xPrefix()', () => {
  test('falsy case, where there be no 0x', () => {
    expect(has0xPrefix('la-la, no prefixie here')).toEqual(false);
  });

  test('it returns true when there is, infact, a 0x prefix', () => {
    expect(has0xPrefix('0xlkjsdkljskljdkjlsdfkljs')).toEqual(true);
  });
});

test('c32address lru caching', () => {
  c32AddrCache.restoreC32AddressModule();
  const origAddrCacheEnvVar = process.env[ADDR_CACHE_ENV_VAR];
  process.env[ADDR_CACHE_ENV_VAR] = '5';
  try {
    // No LRU cache used for c32address fn
    expect(c32AddrCache.getAddressLruCache().itemCount).toBe(0);
    const stxAddr1 = 'SP2JKEZC09WVMR33NBSCWQAJC5GS590RP1FR9CK55';
    const decodedAddr1 = c32check.c32addressDecode(stxAddr1);
    const encodeResult1 = c32check.c32address(decodedAddr1[0], decodedAddr1[1]);
    expect(encodeResult1).toBe(stxAddr1);
    expect(c32AddrCache.getAddressLruCache().itemCount).toBe(0);

    // Inject LRU cache into c32address fn, ensure it gets used
    c32AddrCache.injectC32addressEncodeCache();
    expect(c32AddrCache.getAddressLruCache().max).toBe(5);

    const encodeResult2 = c32check.c32address(decodedAddr1[0], decodedAddr1[1]);
    expect(encodeResult2).toBe(stxAddr1);
    expect(c32AddrCache.getAddressLruCache().itemCount).toBe(1);

    const encodeResult3 = c32check.c32address(decodedAddr1[0], decodedAddr1[1]);
    expect(encodeResult3).toBe(stxAddr1);
    expect(c32AddrCache.getAddressLruCache().itemCount).toBe(1);

    // Test max cache size
    c32AddrCache.getAddressLruCache().reset();
    for (let i = 1; i < 10; i++) {
      // hash160 hex string
      const buff = Buffer.alloc(20);
      buff[i] = i;
      c32check.c32address(1, buff.toString('hex'));
      expect(c32AddrCache.getAddressLruCache().itemCount).toBe(Math.min(i, 5));
    }

    // Sanity check: reset c32 lib to original state, ensure no LRU cache used
    c32AddrCache.restoreC32AddressModule();
    const encodeResult4 = c32check.c32address(decodedAddr1[0], decodedAddr1[1]);
    expect(encodeResult4).toBe(stxAddr1);
    expect(c32AddrCache.getAddressLruCache().itemCount).toBe(0);
  } finally {
    process.env[ADDR_CACHE_ENV_VAR] = origAddrCacheEnvVar;
    c32AddrCache.restoreC32AddressModule();
  }
});

test('bitcoin<->stacks address', () => {
  const mainnetStxAddr = 'SP2JKEZC09WVMR33NBSCWQAJC5GS590RP1FR9CK55';
  const mainnetBtcAddr = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
  // What we'd have here, is a failure to communicate.
  expect(bitcoinToStacksAddress(mainnetBtcAddr)).toBe(mainnetStxAddr);
  expect(stacksToBitcoinAddress(mainnetStxAddr)).toBe(mainnetBtcAddr);

  const testnetStxAddr = 'STDFV22FCWGHB7B5563BHXVMCSYM183PRB9DH090';
  const testnetBtcAddr = 'mhyfanXuwsCMrixyQcCDzh28iHEdtQzZEm';
  expect(bitcoinToStacksAddress(testnetBtcAddr)).toBe(testnetStxAddr);
  expect(stacksToBitcoinAddress(testnetStxAddr)).toBe(testnetBtcAddr);

  // Generated with these utilities:
  //   https://iancoleman.io/bip39/
  //   https://segwitaddress.org/
  //   https://walletgenerator.net/?currency=Bitcoin
  const addrs = {
    b58_mainnet: [
      '1LF1KNGTQLHsz2sW1WejWgDy9kkdCjRA22',
      '12AuGKy12wAQ1t6RmnwKL7QPjFEnoA2fM1',
      '1JhPFgs7xjoHwWRXpxk6hNB1CrAL5DgXFV',
      '1MqjkhGRwaZpFL37cB9NjgMVe6Xk17yQt3',
      '1JyJBEY2kZTgyvgrYfVxwWJZaDQgtk9tXy',
    ],
    b58_testnet: [
      'mhyfanXuwsCMrixyQcCDzh28iHEdtQzZEm',
      'mjEM6dK5po9ZvPgAVaGN3JwHS2xae6TsHB',
      'midgRmu2gxgYhuAZzTysYxYCFPhAKB5Qz4',
      'n3KsEMTMdDJYqppDtgic3zF5C2Vv8TsqUk',
      'mjWdDSVpF8SSdPTeGBjXBwKMBqK64UnhDf',
    ],
    bech32_mainnet: [
      'bc1q94r804jnffpq5607hjyrvqxppw5augm5nu37sz',
      'bc1quj7fszqq9sr23tep7xcfcyeq3zy7wg32yey3pk',
      'bc1qxsta6qpx2ffyke9d5ymcwsuyhlf99asv876gn8',
      'bc1qr84sae78vhmh3caanszeqe7aax9qa00n6f8n88',
      'bc1q7fw5ezxlc8qynefst3xkqwy0v5cux4kjlwqthl',
    ],
    bech32_testnet: [
      'tb1qvkyqlrddsadppkhd2xdjhn7873gqnstdu29ulu',
      'tb1qeemkntv6juneaf96vy4lqru6g7fh5pp6nu4jpe',
      'tb1qf7av3nkqjrt2gfqter4exs5jmtrptdjurncc2f',
      'tb1qwvwagx5f24farha0fzfmxr48lgr7sly7t5tsyh',
      'tb1qqruv3zxqtmaxqa8uxaychtm0szfazeay63j9yu',
    ],
    // bech32m / segwit_V1 / p2tr / taproot
    p2tr_mainnet: [
      'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
      'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5',
      'bc1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sspknck9',
    ],
    // bech32m / segwit_V1 / p2tr / taproot
    p2tr_testnet: [
      'tb1p6h5fuzmnvpdthf5shf0qqjzwy7wsqc5rhmgq2ks9xrak4ry6mtrscsqvzp',
      'tb1p8dlmzllfah294ntwatr8j5uuvcj7yg0dete94ck2krrk0ka2c9qqex96hv',
    ],
    bip141_p2wpkh_mainnet: [
      'bc1q86agjesjeu33mq7uwxsfgdxpe5uxwd0z9ttke9',
      'bc1qlq3xlzgun9x92hd4hrfqkqs6uh78tjleqsc2u2',
      'bc1qhesqfy7jrye6g5ajcv3ttdvlytqaweyj8vyzlr',
      'bc1qsfnmqrlvlk770e4cn0j86ccdy5ygs6n66mtuhl',
      'bc1q08xurcuavy40tpk0c50h6p5467j5ztte7ht8yp',
    ],
    // p2swsh 1-of-1 multisig
    bip141_p2wsh_mainnet: [
      'bc1qk0v05gg93wtf2ghn3xcxfg9d9yphaxzt0fnk0fv54mfe3q4zkz6sma5u4n',
      'bc1qm6gque5azfadcnkkzzszxnw60as8kcuw7g6a4dgyv3ufezp4q4wsyh8zre',
      'bc1q6fdnctgzznkprn90rgpmjw2f3zw5m5full8ngkynpjymjmjt84ks57u8w0',
      'bc1qv0caul6hrmphj7m6ck29glvw7pmv0uv3zam7xntnzwjfzr28e6sqlh7pfl',
      'bc1q5k73zwta4cl3yhxra3jkefpae693uckcla6kvlluh22w9hz274qq0r3ll8',
    ],
    // p2swsh 1-of-1 multisig
    bip141_p2wsh_testnet: [
      'tb1qk0v05gg93wtf2ghn3xcxfg9d9yphaxzt0fnk0fv54mfe3q4zkz6sv4zn0u',
      'tb1qm6gque5azfadcnkkzzszxnw60as8kcuw7g6a4dgyv3ufezp4q4wsnl3dek',
      'tb1q6fdnctgzznkprn90rgpmjw2f3zw5m5full8ngkynpjymjmjt84ksrk2g5q',
      'tb1qv0caul6hrmphj7m6ck29glvw7pmv0uv3zam7xntnzwjfzr28e6sqglgwns',
      'tb1q5k73zwta4cl3yhxra3jkefpae693uckcla6kvlluh22w9hz274qqct8s9g',
    ],
    // p2wsh nested in p2sh (1-1 multisig)
    p2wsh_nested_p2sh_mainnet: [
      '3ByN322G6KnYZwae7upD5SdytroktBGVYV',
      '33oVknpSJLEptjEk1Eu9YMWTV4ZnpuKckA',
      '3MqC2eD6gpXeESVEgjvyfi9mLtYBRo6hYi',
      '3PiiMhDr56xJzyk29gpg92qAiz1j29BB4j',
      '33cLHchyHgAyqWyEQM34CeuCrKNxXY6udk',
    ],
    // p2wsh nested in p2sh (1-1 multisig)
    p2wsh_nested_p2sh_testnet: [
      '2N3Xa6kxHhnHtmjDBo3S5hPdF7D1vcQC6EB',
      '2MuMhpXkTunkB6WsHgNX2AJVihQmxiRKEmG',
      '2NFGvRS9sgZTfCmNZppSYkypRwLDtsdkKKR',
      '2NDPDqwNu7eaDN7YREQ7DcKy7U9bF6uxPtg',
      '2MuAYMMdzu8gL3Jbn5UevpbtU4fb8JKZ1w6',
    ],
  };

  Object.entries(addrs).forEach(([addrFormat, addrSet]) => {
    addrSet.forEach(addr => {
      expect({ addrFormat, addr, valid: isValidBitcoinAddress(addr) }).toEqual({
        addrFormat,
        addr,
        valid: true,
      });
    });
  });
});

test('PoX bitcoin address encoding', () => {
  const vectors: [string, 'mainnet' | 'testnet'][] = [
    ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'mainnet'], // P2WPKH
    ['bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', 'mainnet'], // P2WSH
    ['bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', 'mainnet'], // P2TR

    ['tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'testnet'], // P2WPKH
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', 'testnet'], // P2WSH
    ['tb1p6h5fuzmnvpdthf5shf0qqjzwy7wsqc5rhmgq2ks9xrak4ry6mtrscsqvzp', 'testnet'], // P2TR

    ['17VZNX1SN5NtKa8UQFxwQbFeFc3iqRYhem', 'mainnet'], // P2PKH
    ['3EktnHQD7RiAE6uzMj2ZifT9YgRrkSgzQX', 'mainnet'], // P2SH

    ['mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'testnet'], // P2PKH
    ['2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc', 'testnet'], // P2SH
  ];

  for (const v of vectors) {
    const addr = v[0];
    const decoded = decodeBtcAddress(addr);
    const encoded = poxAddressToBtcAddress(decoded.version, decoded.data, v[1]);
    expect(encoded).toBe(addr);
  }
});

describe('Bitcoin address encoding formats', () => {
  test('P2PKH bitcoin address encoding', () => {
    const TEST_VECTORS = [
      // Test vector from https://github.com/bitcoinjs/bitcoinjs-lib/blob/54259d301960cefddc259d64012bb4a7c2366d48/test/fixtures/address.json#L3-L9
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
        network: 'mainnet',
        format: 'p2pkh',
      },
      // Test vector from https://github.com/bitcoinjs/bitcoinjs-lib/blob/54259d301960cefddc259d64012bb4a7c2366d48/test/fixtures/address.json#L31-L37
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: 'mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r',
        network: 'testnet',
        format: 'p2pkh',
      },
      {
        privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
        publicKey: '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        address: 'mhYeZXrSEuyf2wbJ14qZ2apG7ofMLDj9Ss',
        network: 'testnet',
        format: 'p2pkh',
      },
    ] as const;

    for (const vector of TEST_VECTORS) {
      if (vector.privateKey) {
        const addrFromPriv = getBitcoinAddressFromKey({
          privateKey: vector.privateKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPriv).toBe(vector.address);
      }
      if (vector.publicKey) {
        const addrFromPub = getBitcoinAddressFromKey({
          publicKey: vector.publicKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPub).toBe(vector.address);
      }
    }
  });

  test('P2SH bitcoin address encoding', () => {
    const TEST_VECTORS = [
      // Test vector from https://github.com/bitcoinjs/bitcoinjs-lib/blob/54259d301960cefddc259d64012bb4a7c2366d48/test/fixtures/address.json#L11-L15
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: '3LRW7jeCvQCRdPF8S3yUCfRAx4eqXFmdcr',
        network: 'mainnet',
        format: 'p2sh',
      },
      // Test vector from https://github.com/trezor-graveyard/bitcoinjs-trezor/blob/13b1c0be67abfea0bddbf5360548630c82331ce9/test/fixtures/address.json#L39-L43
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: '2NByiBUaEXrhmqAsg7BbLpcQSAQs1EDwt5w',
        network: 'testnet',
        format: 'p2sh',
      },
      {
        privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
        publicKey: '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        address: '2MygMgDLGPjN9wfEW8gaS1CqAwnuzLdNheW',
        network: 'testnet',
        format: 'p2sh',
      },
    ] as const;

    for (const vector of TEST_VECTORS) {
      if (vector.privateKey) {
        const addrFromPriv = getBitcoinAddressFromKey({
          privateKey: vector.privateKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPriv).toBe(vector.address);
      }
      if (vector.publicKey) {
        const addrFromPub = getBitcoinAddressFromKey({
          publicKey: vector.publicKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPub).toBe(vector.address);
      }
    }
  });

  test('P2SH-P2WPHK bitcoin address encoding', () => {
    const TEST_VECTORS = [
      // Test vector from https://github.com/bitcoinjs/bitcoinjs-message/blob/c43430f4c03c292c719e7801e425d887cbdf7464/test/fixtures.json#L117
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: '3JvL6Ymt8MVWiCNHC7oWU6nLeHNJKLZGLN',
        network: 'mainnet',
        format: 'p2sh-p2wpkh',
      },
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: '2NAUYAHhujozruyzpsFRP63mbrdaU5wnEpN',
        network: 'testnet',
        format: 'p2sh-p2wpkh',
      },
      {
        privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
        publicKey: '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        address: '2NEb2fNbJXdwi7EC6vKCjWUTA12PABNniQM',
        network: 'testnet',
        format: 'p2sh-p2wpkh',
      },
    ] as const;

    for (const vector of TEST_VECTORS) {
      if (vector.privateKey) {
        const addrFromPriv = getBitcoinAddressFromKey({
          privateKey: vector.privateKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPriv).toBe(vector.address);
      }
      if (vector.publicKey) {
        const addrFromPub = getBitcoinAddressFromKey({
          publicKey: vector.publicKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPub).toBe(vector.address);
      }
    }
  });

  test('P2SH-P2WSH bitcoin address encoding', () => {
    const TEST_VECTORS = [
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: '344YToRR99ER5CRo975kXTUAnYcBrVxQYm',
        network: 'mainnet',
        format: 'p2sh-p2wsh',
      },
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: '2MuckXYMSkbjmGz4LpEhd9QTRztpMceVskG',
        network: 'testnet',
        format: 'p2sh-p2wsh',
      },
      {
        privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
        publicKey: '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        address: '2MvggQUqkG6weTSxTcpwvqh5gSow4zKjkcL',
        network: 'testnet',
        format: 'p2sh-p2wsh',
      },
    ] as const;

    for (const vector of TEST_VECTORS) {
      if (vector.privateKey) {
        const addrFromPriv = getBitcoinAddressFromKey({
          privateKey: vector.privateKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPriv).toBe(vector.address);
      }
      if (vector.publicKey) {
        const addrFromPub = getBitcoinAddressFromKey({
          publicKey: vector.publicKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPub).toBe(vector.address);
      }
    }
  });

  test('P2WPKH bitcoin address encoding', () => {
    // Test vectors from https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki#examples
    const TEST_VECTORS = [
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        network: 'mainnet',
        format: 'p2wpkh',
      },
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        network: 'testnet',
        format: 'p2wpkh',
      },
      {
        privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
        publicKey: '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        address: 'tb1qzepy04hjksj6c4m3ggawdjqvw48hzu4swvwmvt',
        network: 'testnet',
        format: 'p2wpkh',
      },
    ] as const;

    for (const vector of TEST_VECTORS) {
      if (vector.privateKey) {
        const addrFromPriv = getBitcoinAddressFromKey({
          privateKey: vector.privateKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPriv).toBe(vector.address);
      }
      if (vector.publicKey) {
        const addrFromPub = getBitcoinAddressFromKey({
          publicKey: vector.publicKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPub).toBe(vector.address);
      }
    }
  });

  test('P2WSH bitcoin address encoding', () => {
    // TODO: right now the `P2WSH` function is creating 1-of-1 multisig addresses (and has not been verified to work).
    // There's a more standard approach that creates addresses using "key OP_CHECKSIG as script" as referenced in BIP173:
    //  - mainnet: bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3
    //  - testnet: tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7
    const TEST_VECTORS = [
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: 'bc1q9qs9xv7mjghkd69fgx62xttxmeww5q7eekjxu0nxtzf4yu4ekf8s4plngs',
        network: 'mainnet',
        format: 'p2wsh',
      },
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: 'tb1q9qs9xv7mjghkd69fgx62xttxmeww5q7eekjxu0nxtzf4yu4ekf8szffujl',
        network: 'testnet',
        format: 'p2wsh',
      },
      {
        privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
        publicKey: '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        address: 'tb1qczxqnu5hx2zvxcqt3lmr6vjju4ysf7d649mvrzd8v7l3jez0dqzql2ek5y',
        network: 'testnet',
        format: 'p2wsh',
      },
    ] as const;

    for (const vector of TEST_VECTORS) {
      if (vector.privateKey) {
        const addrFromPriv = getBitcoinAddressFromKey({
          privateKey: vector.privateKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPriv).toBe(vector.address);
      }
      if (vector.publicKey) {
        const addrFromPub = getBitcoinAddressFromKey({
          publicKey: vector.publicKey,
          network: vector.network,
          addressFormat: vector.format,
        });
        expect(addrFromPub).toBe(vector.address);
      }
    }
  });

  test('P2TR bitcoin address encoding', () => {
    const P2TR_TEST_VECTORS = [
      // Vector from https://github.com/bitcoin/bitcoin/blob/master/src/test/data/bip341_wallet_vectors.json
      {
        privateKey: null,
        publicKey: 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d',
        address: 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5',
        network: 'mainnet',
      },
      // Vector from https://github.com/chaintope/bitcoinrb/blob/c6d2cf564f069e37301b7ba5cd2ff8a25b94dbfe/spec/bitcoin/taproot/simple_builder_spec.rb#L31
      {
        privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
        publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        address: 'bc1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sspknck9',
        network: 'mainnet',
      },
      // Vector from locally verified regtest/krypton accounts
      {
        privateKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
        publicKey: '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        address: 'tb1p8dlmzllfah294ntwatr8j5uuvcj7yg0dete94ck2krrk0ka2c9qqex96hv',
        network: 'testnet',
      },
    ] as const;

    for (const vector of P2TR_TEST_VECTORS) {
      if (vector.privateKey) {
        const p2trAddrFromPriv = getBitcoinAddressFromKey({
          privateKey: vector.privateKey,
          network: vector.network,
          addressFormat: 'p2tr',
        });
        expect(p2trAddrFromPriv).toBe(vector.address);
      }
      const p2trAddrFromPub = getBitcoinAddressFromKey({
        publicKey: vector.publicKey,
        network: vector.network,
        addressFormat: 'p2tr',
      });
      expect(p2trAddrFromPub).toBe(vector.address);
    }

    const randomEcPair = ECPair.makeRandom({ compressed: true });
    const randP2TRMainnet = getBitcoinAddressFromKey({
      publicKey: randomEcPair.publicKey,
      network: 'mainnet',
      addressFormat: 'p2tr',
    });
    expect(randP2TRMainnet).toMatch(/^bc1p/);

    const randP2TRTestnet = getBitcoinAddressFromKey({
      publicKey: randomEcPair.publicKey,
      network: 'testnet',
      addressFormat: 'p2tr',
    });
    expect(randP2TRTestnet).toMatch(/^tb1p/);
  });
});

test('getUintEnvOrDefault tests', () => {
  const key = 'SOME_UINT_ENV';
  process.env[key] = '123';
  expect(getUintEnvOrDefault(key)).toBe(123);
  process.env[key] = '-123';
  expect(() => getUintEnvOrDefault(key)).toThrowError();
  process.env[key] = 'ABC';
  expect(() => getUintEnvOrDefault(key)).toThrowError();
});

test('signer bitvec decoding', () => {
  const signerBitvecString1 = '00010000000100';
  const signerBitvecPayload1 = Buffer.from(signerBitvecString1, 'hex');
  const bitVec1 = BitVec.consensusDeserialize(signerBitvecPayload1);
  expect(bitVec1.bits).toHaveLength(1);
  expect(bitVec1.bits).toStrictEqual([false]);
  expect(bitVec1.toString()).toBe('0');
  expect(BitVec.consensusDeserializeToString(signerBitvecString1)).toBe('0');

  const signerBitvecString2 = '000100000001ff';
  const signerBitvecPayload2 = Buffer.from(signerBitvecString2, 'hex');
  const bitVec2 = BitVec.consensusDeserialize(signerBitvecPayload2);
  expect(bitVec2.bits).toHaveLength(1);
  expect(bitVec2.bits).toStrictEqual([true]);
  expect(bitVec2.toString()).toBe('1');
  expect(BitVec.consensusDeserializeToString(signerBitvecString2)).toBe('1');

  const signerBitvecString3 = '000300000001c0';
  const signerBitvecPayload3 = Buffer.from(signerBitvecString3, 'hex');
  const bitVec3 = BitVec.consensusDeserialize(signerBitvecPayload3);
  expect(bitVec3.bits).toHaveLength(3);
  expect(bitVec3.bits).toStrictEqual([true, true, false]);
  expect(bitVec3.toString()).toBe('110');
  expect(BitVec.consensusDeserializeToString(signerBitvecString3)).toBe('110');
});
