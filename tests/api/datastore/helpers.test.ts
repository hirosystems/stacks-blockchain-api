import { BitVec } from '../../../src/helpers.ts';
import { ECPair, getBitcoinAddressFromKey } from '../../../src/ec-helpers.ts';

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
