import { Readable } from 'stream';
import {
  CoreNodeMessage,
  CoreNodeMessageParsed,
  CoreNodeParsedTxMessage,
} from './core-node-message';
import { Transaction, readTransaction, TransactionPayloadTypeID } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
import { NotImplementedError } from '../errors';
import { getEnumDescription } from '../helpers';
import { Address } from '@blockstack/stacks-transactions';
import { c32address } from 'c32check';

/**
 * Read JSON messages from a core-node event stream socket.
 */
export async function readMessageFromStream(socket: Readable): Promise<CoreNodeMessage> {
  let data: Buffer = Buffer.alloc(0);
  for await (const chunk of socket) {
    data = Buffer.concat([data, chunk]);
  }
  const jsonString = data.toString('utf8');
  const message: CoreNodeMessage = JSON.parse(jsonString);
  console.log(`${Date.now()} Received core-node message for block: ${message.block_hash}`);
  // console.log(message);
  return message;
}

export function parseMessageTransactions(msg: CoreNodeMessage): CoreNodeMessageParsed {
  const parsedMessage: CoreNodeMessageParsed = {
    ...msg,
    parsed_transactions: new Array(msg.transactions.length),
  };
  for (let i = 0; i < msg.transactions.length; i++) {
    const coreTx = msg.transactions[i];
    try {
      const txBuffer = Buffer.from(coreTx.raw_tx.substring(2), 'hex');
      const bufferReader = BufferReader.fromBuffer(txBuffer);
      const rawTx = readTransaction(bufferReader);
      const parsedTx: CoreNodeParsedTxMessage = {
        core_tx: coreTx,
        raw_tx: rawTx,
        block_hash: msg.block_hash,
        block_height: msg.block_height,
        sender_address: Address.fromHashMode(
          rawTx.auth.originCondition.hashMode as number,
          rawTx.version as number,
          rawTx.auth.originCondition.signer.toString('hex')
        ).toString(),
      };
      parsedMessage.parsed_transactions[i] = parsedTx;
      const payload = rawTx.payload;
      switch (payload.typeId) {
        case TransactionPayloadTypeID.Coinbase: {
          break;
        }
        case TransactionPayloadTypeID.SmartContract: {
          console.log(`Smart contract deployed: ${payload.name}: ${payload.codeBody}`);
          break;
        }
        case TransactionPayloadTypeID.ContractCall: {
          const address = c32address(
            payload.address.version,
            payload.address.bytes.toString('hex')
          );
          console.log(`Contract call: ${address}.${payload.contractName}.${payload.functionName}`);
          break;
        }
        case TransactionPayloadTypeID.TokenTransfer: {
          console.log(
            `Token transfer: ${payload.amount} from ${parsedTx.sender_address} to ${c32address(
              payload.address.version,
              payload.address.bytes.toString('hex')
            )}`
          );
          break;
        }
        default: {
          throw new NotImplementedError(
            `extracting data for tx type: ${getEnumDescription(
              TransactionPayloadTypeID,
              rawTx.payload.typeId
            )}`
          );
        }
      }
    } catch (error) {
      console.error(`error parsing message transaction ${coreTx}: ${error}`);
      console.error(error);
      throw error;
    }
  }
  return parsedMessage;
}
