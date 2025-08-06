import { ChainID } from '@stacks/transactions';
import * as fs from 'fs';
import * as path from 'path';
import { DecodedTxResult, TxPayloadTypeID } from 'stacks-encoding-native-js';
import { CoreNodeBlockMessage } from '../../src/event-stream/core-node-message';
import { CoreNodeMsgBlockData, parseMessageTransaction } from '../../src/event-stream/reader';
import { parseNewBlockMessage } from '../../src/event-stream/event-server';

// Test processing of the psuedo-Stacks transactions, i.e. the ones that
// originate on the Bitcoin chain, and have a `raw_tx == '0x00'.
describe('synthetic stx txs', () => {
  test('test synthetic tx token transfer 1', () => {
    // Testing an older tx from mainnet (at block 120)
    const file =
      'synthetic-tx-payloads/token_transfer-120-0xc0263c14f689ae757290f90765a28314497f52bd22b8bcbf87a12c764dd9d9be.json';
    const txid = file.split('-').slice(-1)[0].split('.')[0];
    const payloadStr = fs.readFileSync(path.join(__dirname, file), { encoding: 'utf8' });
    const blockMsg = JSON.parse(payloadStr) as CoreNodeBlockMessage;
    const txMsg = blockMsg.transactions.find(t => t.txid === txid);
    if (!txMsg) {
      throw new Error(`Cound not find tx ${txid}`);
    }
    const parsed = parseMessageTransaction(
      ChainID.Mainnet,
      txMsg,
      blockMsg as unknown as CoreNodeMsgBlockData,
      blockMsg.events
    );
    if (!parsed) {
      throw new Error(`Failed to parse ${txid}`);
    }

    const expected: DecodedTxResult = {
      anchor_mode: 3,
      auth: {
        origin_condition: {
          hash_mode: 0,
          key_encoding: 0,
          nonce: '0',
          signature: '0x',
          signer: {
            address: 'SMQ5V9ZVGN62G1X3VJNM2MF64SG6JXS8SKVNTGZQ',
            address_hash_bytes: '0x2e5da7fb854c2807a3dcab4151e62660697728cc',
            address_version: 20,
          },
          tx_fee: '0',
        },
        type_id: 4,
      },
      chain_id: 1,
      payload: {
        amount: '2000',
        memo_hex: '0x',
        recipient: {
          address: 'SP2ZP4GJDZJ1FDHTQ963F0292PE9J9752TZJ68F21',
          address_hash_bytes: '0xbf62424dfc82f6c7574986f00922b393249ca2d7',
          address_version: 22,
          type_id: 5,
        },
        type_id: 0,
      },
      post_condition_mode: 1,
      post_conditions: [],
      post_conditions_buffer: '0x0100000000',
      tx_id: '0xc0263c14f689ae757290f90765a28314497f52bd22b8bcbf87a12c764dd9d9be',
      version: 0,
    };

    expect(parsed.parsed_tx).toEqual(expect.objectContaining(expected));
  });

  test('test synthetic tx token transfer 2', () => {
    // Testing a newer tx from mainnet (at block 51655)
    const file =
      'synthetic-tx-payloads/token_transfer-51655-0x2553c7c5b49eab5a0569e5d0f14c8f15945965a51976ac6697641003533986f6.json';
    const txid = file.split('-').slice(-1)[0].split('.')[0];
    const payloadStr = fs.readFileSync(path.join(__dirname, file), { encoding: 'utf8' });
    const blockMsg = JSON.parse(payloadStr) as CoreNodeBlockMessage;
    const txMsg = blockMsg.transactions.find(t => t.txid === txid);
    if (!txMsg) {
      throw new Error(`Cound not find tx ${txid}`);
    }
    const parsed = parseMessageTransaction(
      ChainID.Mainnet,
      txMsg,
      blockMsg as unknown as CoreNodeMsgBlockData,
      blockMsg.events
    );
    if (!parsed) {
      throw new Error(`Failed to parse ${txid}`);
    }

    const expected: DecodedTxResult = {
      anchor_mode: 3,
      auth: {
        origin_condition: {
          hash_mode: 0,
          key_encoding: 0,
          nonce: '0',
          signature: '0x',
          signer: {
            address: 'SM1J78KG0XBCYXS2NP1ZYJ06AGH5T5SKND701Q4CA',
            address_hash_bytes: '0x64744e00ead9eee455b07fe900ca844ba2e67569',
            address_version: 20,
          },
          tx_fee: '0',
        },
        type_id: 4,
      },
      chain_id: 1,
      payload: {
        amount: '8333333333',
        memo_hex: '0x',
        recipient: {
          address: 'SMSJ4YQNTPHWE1KH325MHVHXDRZY7ZA21W989BPW',
          address_hash_bytes: '0x33227af5d5a3c70671188b48ee3d6e3fe3fd420f',
          address_version: 20,
          type_id: 5,
        },
        type_id: 0,
      },
      post_condition_mode: 1,
      post_conditions: [],
      post_conditions_buffer: '0x0100000000',
      tx_id: '0x2553c7c5b49eab5a0569e5d0f14c8f15945965a51976ac6697641003533986f6',
      version: 0,
    };

    expect(parsed.parsed_tx).toEqual(expect.objectContaining(expected));
  });

  test('test synthetic tx stx lock 1', () => {
    // Testing a newer tx from mainnet (at block 1379)
    const file =
      'synthetic-tx-payloads/stx_lock-1379-0xb182e2aacfe2ed4257d66dd2ed4872f672cf10d873852b5218f41594d6b42b11.json';
    const txid = file.split('-').slice(-1)[0].split('.')[0];
    const payloadStr = fs.readFileSync(path.join(__dirname, file), { encoding: 'utf8' });
    const blockMsg = JSON.parse(payloadStr) as CoreNodeBlockMessage;
    const txMsg = blockMsg.transactions.find(t => t.txid === txid);
    if (!txMsg) {
      throw new Error(`Cound not find tx ${txid}`);
    }
    const parsed = parseMessageTransaction(
      ChainID.Mainnet,
      txMsg,
      blockMsg as unknown as CoreNodeMsgBlockData,
      blockMsg.events
    );
    if (!parsed) {
      throw new Error(`Failed to parse ${txid}`);
    }

    const expected: DecodedTxResult = {
      anchor_mode: 3,
      auth: {
        origin_condition: {
          hash_mode: 0,
          key_encoding: 0,
          nonce: '0',
          signature: '0x',
          signer: {
            address: 'SM3KJBA4RZ7Z20KD2HBXNSXVPCR1D3CRAV6Q05MKT',
            address_hash_bytes: '0xe725a898f9fe204da28afb5cf7766602d1b30ad9',
            address_version: 20,
          },
          tx_fee: '0',
        },
        type_id: 4,
      },
      chain_id: 1,
      payload: {
        address: 'SP000000000000000000002Q6VF78',
        address_hash_bytes: '0x0000000000000000000000000000000000000000',
        address_version: 22,
        contract_name: 'pox',
        function_args: [
          {
            hex: '0x010000000000000000000000104c533c00',
            repr: 'u70000000000',
            type_id: 1,
          },
          {
            hex: '0x0c00000002096861736862797465730200000014e725a898f9fe204da28afb5cf7766602d1b30ad90776657273696f6e020000000101',
            repr: '(tuple (hashbytes 0xe725a898f9fe204da28afb5cf7766602d1b30ad9) (version 0x01))',
            type_id: 12,
          },
          {
            hex: '0x01000000000000000000000000000a30a7',
            repr: 'u667815',
            type_id: 1,
          },
          {
            hex: '0x0100000000000000000000000000000001',
            repr: 'u1',
            type_id: 1,
          },
        ],
        function_args_buffer:
          '0x00000004010000000000000000000000104c533c000c00000002096861736862797465730200000014e725a898f9fe204da28afb5cf7766602d1b30ad90776657273696f6e02000000010101000000000000000000000000000a30a70100000000000000000000000000000001',
        function_name: 'stack-stx',
        type_id: 2,
      },
      post_condition_mode: 1,
      post_conditions: [],
      post_conditions_buffer: '0x0100000000',
      tx_id: '0xb182e2aacfe2ed4257d66dd2ed4872f672cf10d873852b5218f41594d6b42b11',
      version: 0,
    };

    expect(parsed.parsed_tx).toEqual(expect.objectContaining(expected));
  });

  test('test synthetic tx stx lock 3', () => {
    const file =
      'synthetic-tx-payloads/stx_lock-1994-0xd45e090ac442380cf50655e3d1c904c355a501d6dffa3b5e4799083062469dbc.json';
    const txid = file.split('-').slice(-1)[0].split('.')[0];
    const payloadStr = fs.readFileSync(path.join(__dirname, file), { encoding: 'utf8' });
    const blockMsg = JSON.parse(payloadStr) as CoreNodeBlockMessage;
    const txMsg = blockMsg.transactions.find(t => t.txid === txid);
    if (!txMsg) {
      throw new Error(`Cound not find tx ${txid}`);
    }
    const { dbData: parsed } = parseNewBlockMessage(ChainID.Mainnet, blockMsg, false);
    if (!parsed) {
      throw new Error(`Failed to parse ${txid}`);
    }
    // Ensure real contract event indexes are contiguous
    const events = [parsed.txs[0].contractLogEvents, parsed.txs[0].stxLockEvents]
      .flat()
      .sort((a, b) => a.event_index - b.event_index);
    expect(events).toHaveLength(13);
    for (let i = 0; i < events.length; i++) {
      expect(events[i].event_index).toEqual(i);
    }
    // Ensure synthetic pox event indexes are in expected range
    for (const poxEvent of parsed.txs[0].pox4Events) {
      expect(poxEvent.event_index).toBeLessThan(events.length);
    }
  });

  test('test synthetic tx stx lock 2', () => {
    // Testing a newer tx from mainnet (at block 51451)
    const file =
      'synthetic-tx-payloads/stx_lock-51451-0xa64ad136e51a3a50eb1fdfd7eefa0b7aeb89e2521b2a2218d887477baa1775c9.json';
    const txid = file.split('-').slice(-1)[0].split('.')[0];
    const payloadStr = fs.readFileSync(path.join(__dirname, file), { encoding: 'utf8' });
    const blockMsg = JSON.parse(payloadStr) as CoreNodeBlockMessage;
    const txMsg = blockMsg.transactions.find(t => t.txid === txid);
    if (!txMsg) {
      throw new Error(`Cound not find tx ${txid}`);
    }
    const parsed = parseMessageTransaction(
      ChainID.Mainnet,
      txMsg,
      blockMsg as unknown as CoreNodeMsgBlockData,
      blockMsg.events
    );
    if (!parsed) {
      throw new Error(`Failed to parse ${txid}`);
    }

    const expected: DecodedTxResult = {
      anchor_mode: 3,
      auth: {
        origin_condition: {
          hash_mode: 0,
          key_encoding: 0,
          nonce: '0',
          signature: '0x',
          signer: {
            address: 'SM313VGCT3TK1M82K2AS2KHNX813BY5FKCXJSKZ4E',
            address_hash_bytes: '0xc23dc19a1ea61a205312b229c6bd4046bf15f367',
            address_version: 20,
          },
          tx_fee: '0',
        },
        type_id: 4,
      },
      chain_id: 1,
      payload: {
        address: 'SP000000000000000000002Q6VF78',
        address_hash_bytes: '0x0000000000000000000000000000000000000000',
        address_version: 22,
        contract_name: 'pox',
        function_args: [
          {
            hex: '0x0100000000000000000000038a607f5f70',
            repr: 'u3892859330416',
            type_id: 1,
          },
          {
            hex: '0x0c00000002096861736862797465730200000014c23dc19a1ea61a205312b229c6bd4046bf15f3670776657273696f6e020000000101',
            repr: '(tuple (hashbytes 0xc23dc19a1ea61a205312b229c6bd4046bf15f367) (version 0x01))',
            type_id: 12,
          },
          {
            hex: '0x01000000000000000000000000000b1560',
            repr: 'u726368',
            type_id: 1,
          },
          {
            hex: '0x010000000000000000000000000000000c',
            repr: 'u12',
            type_id: 1,
          },
        ],
        function_args_buffer:
          '0x000000040100000000000000000000038a607f5f700c00000002096861736862797465730200000014c23dc19a1ea61a205312b229c6bd4046bf15f3670776657273696f6e02000000010101000000000000000000000000000b1560010000000000000000000000000000000c',
        function_name: 'stack-stx',
        type_id: 2,
      },
      post_condition_mode: 1,
      post_conditions: [],
      post_conditions_buffer: '0x0100000000',
      tx_id: '0xa64ad136e51a3a50eb1fdfd7eefa0b7aeb89e2521b2a2218d887477baa1775c9',
      version: 0,
    };

    expect(parsed.parsed_tx).toEqual(expect.objectContaining(expected));
  });

  // Note this is a helper function used to grab samples of the psuedo-Stacks transactions.
  // It's used during development for creating unit tests, but not ran regularly in unit tests.
  function gatherSamples() {
    // Directory containing `/new_block` payloads that are already filtered for `raw_tx == '0x00'`
    const payloadDir = '/tmp/btc-originating-tx-payloads';

    // Output directory to dump selected samples of `/new_block` payloads to use for unit tests
    const outputDir = '/tmp/synthetic-tx-payloads';

    const files = fs.readdirSync(payloadDir);
    const payloads = files
      .map(f => {
        const [block, txid] = path.basename(f, '.json').split('-');
        const filePath = path.join(payloadDir, f);
        const payloadString = fs.readFileSync(filePath, { encoding: 'utf8' });
        const blockMsg = JSON.parse(payloadString) as CoreNodeBlockMessage;
        const txMsg = blockMsg.transactions.find(t => t.txid === txid);
        if (!txMsg) {
          throw new Error(`Cound not find tx ${txid}`);
        }
        return {
          blockHeight: parseInt(block),
          txid,
          filePath,
          blockMsg,
          txMsg,
        };
      })
      .sort((a, b) => a.blockHeight - b.blockHeight);

    const parsedTxs = payloads.map(payload => {
      const parsed = parseMessageTransaction(
        ChainID.Mainnet,
        payload.txMsg,
        payload.blockMsg as unknown as CoreNodeMsgBlockData,
        payload.blockMsg.events
      );
      let txType: 'contract_call' | 'token_transfer' | null;
      if (parsed?.parsed_tx.payload.type_id === TxPayloadTypeID.ContractCall) {
        txType = 'contract_call';
      } else if (parsed?.parsed_tx.payload.type_id === TxPayloadTypeID.TokenTransfer) {
        txType = 'token_transfer';
      } else if (parsed) {
        throw new Error('unexpected');
      } else {
        txType = null;
      }
      return { txType, payload, parsed };
    });

    const tokenTransfers = parsedTxs.filter(p => p.txType === 'token_transfer');
    const tokenTransferSamples = tokenTransfers.slice(0, 3).concat(tokenTransfers.slice(-3));
    tokenTransferSamples.forEach(r => {
      const jsonString = JSON.stringify(r.payload.blockMsg);
      const outputFile = `token_transfer-${r.payload.blockHeight}-${r.payload.txid}.json`;
      fs.writeFileSync(path.join(outputDir, outputFile), jsonString);
    });

    const contractCalls = parsedTxs.filter(p => p.txType === 'contract_call');
    const contractCallSamples = contractCalls.slice(0, 3).concat(contractCalls.slice(-3));
    contractCallSamples.forEach(r => {
      const jsonString = JSON.stringify(r.payload.blockMsg);
      const outputFile = `stx_lock-${r.payload.blockHeight}-${r.payload.txid}.json`;
      fs.writeFileSync(path.join(outputDir, outputFile), jsonString);
    });

    const failedTxs = parsedTxs.filter(p => p.txType === null).slice(0, 3);
    failedTxs.forEach(r => {
      const jsonString = JSON.stringify(r.payload.blockMsg);
      const outputFile = `failed-${r.payload.blockHeight}-${r.payload.txid}.json`;
      fs.writeFileSync(path.join(outputDir, outputFile), jsonString);
    });
  }
});
