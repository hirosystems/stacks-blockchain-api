import { ChainID } from '@stacks/transactions';
import * as fs from 'fs';
import * as path from 'path';
import { DecodedTxResult, TxPayloadTypeID } from 'stacks-encoding-native-js';
import { CoreNodeBlockMessage } from '../event-stream/core-node-message';
import { parseMessageTransaction } from '../event-stream/reader';

// Test processing of the psuedo-Stacks transactions, i.e. the ones that
// originate on the Bitcoin chain, and have a `raw_tx == '0x00'.

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
  const parsed = parseMessageTransaction(ChainID.Mainnet, txMsg, blockMsg, blockMsg.events);
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
        signer: '2e5da7fb854c2807a3dcab4151e62660697728cc',
        signer_stacks_address: {
          address: 'SMQ5V9ZVGN62G1X3VJNM2MF64SG6JXS8SKVNTGZQ',
          address_hash_bytes: Buffer.from('2e5da7fb854c2807a3dcab4151e62660697728cc', 'hex'),
          address_version: 20,
        },
        tx_fee: '0',
      },
      type_id: 4,
    },
    chain_id: 1,
    payload: {
      amount: '2000',
      memo_buffer: Buffer.from([]),
      memo_hex: '0x',
      recipient: {
        address: 'SP2ZP4GJDZJ1FDHTQ963F0292PE9J9752TZJ68F21',
        address_hash_bytes: Buffer.from('bf62424dfc82f6c7574986f00922b393249ca2d7', 'hex'),
        address_version: 22,
        type_id: 5,
      },
      type_id: 0,
    },
    post_condition_mode: 1,
    post_conditions: [],
    post_conditions_buffer: Buffer.from([1, 0, 0, 0, 0]),
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
  const parsed = parseMessageTransaction(ChainID.Mainnet, txMsg, blockMsg, blockMsg.events);
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
        signer: '64744e00ead9eee455b07fe900ca844ba2e67569',
        signer_stacks_address: {
          address: 'SM1J78KG0XBCYXS2NP1ZYJ06AGH5T5SKND701Q4CA',
          address_hash_bytes: Buffer.from('64744e00ead9eee455b07fe900ca844ba2e67569', 'hex'),
          address_version: 20,
        },
        tx_fee: '0',
      },
      type_id: 4,
    },
    chain_id: 1,
    payload: {
      amount: '8333333333',
      memo_buffer: Buffer.from([]),
      memo_hex: '0x',
      recipient: {
        address: 'SMSJ4YQNTPHWE1KH325MHVHXDRZY7ZA21W989BPW',
        address_hash_bytes: Buffer.from('33227af5d5a3c70671188b48ee3d6e3fe3fd420f', 'hex'),
        address_version: 20,
        type_id: 5,
      },
      type_id: 0,
    },
    post_condition_mode: 1,
    post_conditions: [],
    post_conditions_buffer: Buffer.from([1, 0, 0, 0, 0]),
    tx_id: '0x2553c7c5b49eab5a0569e5d0f14c8f15945965a51976ac6697641003533986f6',
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
      payload.blockMsg,
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
