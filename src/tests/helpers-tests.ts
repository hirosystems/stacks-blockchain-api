import * as c32check from 'c32check';
import { getCurrentGitTag, has0xPrefix, isValidBitcoinAddress } from '../helpers';

test('get git tag', () => {
  const tag = getCurrentGitTag();
  expect(tag).toBeTruthy();
});

describe('has0xPrefix()', () => {
  test('falsy case, where there be no 0x', () => {
    expect(has0xPrefix('la-la, no prefixie here')).toEqual(false);
  });

  test('it returns true when there is, infact, a 0x prefix', () => {
    expect(has0xPrefix('0xlkjsdkljskljdkjlsdfkljs')).toEqual(true);
  });
});

test('bitcoin<->stacks address', () => {
  const mainnetStxAddr = 'SP2JKEZC09WVMR33NBSCWQAJC5GS590RP1FR9CK55';
  const mainnetBtcAddr = '1G4ayBXJvxZMoZpaNdZG6VyWwWq2mHpMjQ';
  // What we'd have here, is a failure to communicate.
  expect(c32check.b58ToC32(mainnetBtcAddr)).toBe(mainnetStxAddr);
  expect(c32check.c32ToB58(mainnetStxAddr)).toBe(mainnetBtcAddr);

  const testnetStxAddr = 'STDFV22FCWGHB7B5563BHXVMCSYM183PRB9DH090';
  const testnetBtcAddr = 'mhyfanXuwsCMrixyQcCDzh28iHEdtQzZEm';
  expect(c32check.b58ToC32(testnetBtcAddr)).toBe(testnetStxAddr);
  expect(c32check.c32ToB58(testnetStxAddr)).toBe(testnetBtcAddr);

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
