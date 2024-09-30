import {
  parseNamespaceRawValue,
  parseNameRawValue,
  parseZoneFileTxt,
} from '../../src/event-stream/bns/bns-helpers';
import * as zoneFileParser from 'zone-file';

describe('BNS helper tests', () => {
  test('Success: namespace parsed', () => {
    const expectedNamespace = {
      namespace_id: 'xyz',
      address: 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH',
      base: 1n,
      coeff: 1n,
      launched_at: 14,
      lifetime: 1,
      no_vowel_discount: 1n,
      nonalpha_discount: 1n,
      ready_block: 4,
      reveal_block: 6,
      status: 'ready',
      buckets: '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
      tx_id: '0x2114c8cda9e829f8b5d3c4163724ae9c4d9142d2bae4a35bffb006408d21c0ab',
      index_block_hash: '0xdeadbeef',
    };
    const namespace = parseNamespaceRawValue(
      // This value comes from Smart Contract Event (event.contract_event.raw_value)
      '0x0c00000003096e616d657370616365020000000378797a0a70726f706572746965730c000000050b6c61756e636865642d61740a010000000000000000000000000000000e086c69666574696d650100000000000000000000000000000001106e616d6573706163652d696d706f7274051abf8e82623c380cd870931d48b525d5e12a4d67820e70726963652d66756e6374696f6e0c0000000504626173650100000000000000000000000000000001076275636b6574730b00000010010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000105636f6566660100000000000000000000000000000001116e6f2d766f77656c2d646973636f756e740100000000000000000000000000000001116e6f6e616c7068612d646973636f756e7401000000000000000000000000000000010b72657665616c65642d61740100000000000000000000000000000006067374617475730d000000057265616479',
      4,
      '0x2114c8cda9e829f8b5d3c4163724ae9c4d9142d2bae4a35bffb006408d21c0ab',
      0
    );
    expect(namespace?.address).toEqual(expectedNamespace.address);
    expect(namespace?.namespace_id).toEqual(expectedNamespace.namespace_id);
    expect(namespace?.base).toEqual(expectedNamespace.base);
    expect(namespace?.coeff).toEqual(expectedNamespace.coeff);
    expect(namespace?.launched_at).toEqual(expectedNamespace.launched_at);
    expect(namespace?.lifetime).toEqual(expectedNamespace.lifetime);
    expect(namespace?.no_vowel_discount).toEqual(expectedNamespace.no_vowel_discount);
    expect(namespace?.nonalpha_discount).toEqual(expectedNamespace.nonalpha_discount);
    expect(namespace?.ready_block).toEqual(expectedNamespace.ready_block);
    expect(namespace?.reveal_block).toEqual(expectedNamespace.reveal_block);
    expect(namespace?.status).toEqual(expectedNamespace.status);
    expect(namespace?.buckets).toEqual(expectedNamespace.buckets);
    expect(namespace?.tx_id).toEqual(expectedNamespace.tx_id);
  });

  test('Success: parse name raw value', () => {
    const expectedName = {
      attachment: {
        hash: 'c5217bcb3e52612ff7c835f9bb46a5f86aa73b8d',
        metadata: {
          name: 'abcdef',
          namespace: 'xyz',
          tx_sender: {
            type: 0,
            version: 26,
            hash160: 'bf8e82623c380cd870931d48b525d5e12a4d6782',
          },
          op: 'name-import',
        },
      },
    };
    const expectedAttachment = expectedName.attachment;
    const name = parseNameRawValue(
      // This value comes from Smart Contract Event (event.contract_event.raw_value)
      '0x0c000000010a6174746163686d656e740c00000003106174746163686d656e742d696e646578010000000000000000000000000000000004686173680200000014c5217bcb3e52612ff7c835f9bb46a5f86aa73b8d086d657461646174610c00000004046e616d650200000006616263646566096e616d657370616365020000000378797a026f700d0000000b6e616d652d696d706f72740974782d73656e646572051abf8e82623c380cd870931d48b525d5e12a4d6782'
    );
    const attachment = name.attachment;
    expect(attachment.hash).toEqual(expectedAttachment.hash);
    expect(attachment.metadata.name).toEqual(expectedAttachment.metadata.name);
    expect(attachment.metadata.namespace).toEqual(expectedAttachment.metadata.namespace);
    expect(attachment.metadata.op).toEqual(expectedAttachment.metadata.op);
    expect(attachment.metadata.tx_sender.version).toEqual(
      expectedAttachment.metadata.tx_sender.version
    );
    expect(attachment.metadata.tx_sender.hash160).toEqual(
      expectedAttachment.metadata.tx_sender.hash160
    );
  });

  test('Parse TXT', () => {
    const subdomain = `$ORIGIN abcdef.xyz
      $TTL 3600
      asim	IN	TXT	"owner=ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH" "seqn=0" "parts=1" "zf0=JE9SSUdJTiBhc2ltCiRUVEwgMzYwMApfaHR0cHMuX3RjcCBVUkkgMTAgMSAiaHR0cHM6Ly9nYWlhLmJsb2Nrc3RhY2sub3JnL2h1Yi9TVDJaUlgwSzI3R1cwU1AzR0pDRU1IRDk1VFFHSk1LQjdHOVkwWDFNSC9wcm9maWxlLmpzb24iCg=="
      _http._tcp	IN	URI	10	1	"https://gaia.blockstack.org/hub/1M3325hr1utdv4HhSAfvYKhapzPP9Axhde/profile.json"
      _resolver	IN	URI	10	1	"http://localhost:3000"
      `;
    const parsedZoneFile = zoneFileParser.parseZoneFile(subdomain);
    const zoneFileTxt = parseZoneFileTxt(parsedZoneFile.txt?.[0].txt as string[]);
    expect(zoneFileTxt.owner).toBe('ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH');
    expect(zoneFileTxt.parts).toBe('1');
    expect(zoneFileTxt.seqn).toBe('0');
  });
});
