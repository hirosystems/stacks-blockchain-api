import { Readable } from 'stream';
import { CoreNodeMessage, CoreNodeMessageParsed } from './core-node-message';
import { Transaction, readTransaction, TransactionPayloadTypeID } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
import { NotImplementedError } from '../errors';
import { getEnumDescription } from '../helpers';

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
  console.log(`${Date.now()} Received core-node message:`);
  console.log(message);
  return message;
}

export function parseMessageTransactions(msg: CoreNodeMessage): CoreNodeMessageParsed {
  const parsedMessage: CoreNodeMessageParsed = {
    ...msg,
    parsed_transactions: new Array<Transaction>(msg.transactions.length),
  };
  for (let i = 0; i < msg.transactions.length; i++) {
    const tx = msg.transactions[i];
    try {
      const txBuffer = Buffer.from(tx.substring(2), 'hex');
      const bufferReader = BufferReader.fromBuffer(txBuffer);
      const parsedTx = readTransaction(bufferReader);
      parsedMessage.parsed_transactions[i] = parsedTx;
      console.log(parsedTx);
      const payload = parsedTx.payload;
      switch (payload.typeId) {
        case TransactionPayloadTypeID.Coinbase: {
          break;
        }
        case TransactionPayloadTypeID.SmartContract: {
          console.log(`Smart contract deployed: ${payload.name}: ${payload.codeBody}`);
          break;
        }
        case TransactionPayloadTypeID.ContractCall: {
          console.log(`Contract call: ${payload.address}.${payload.contractName}.${payload.functionName}`);
          break;
        }
        default: {
          throw new NotImplementedError(
            `extracting data for tx type: ${getEnumDescription(TransactionPayloadTypeID, parsedTx.payload.typeId)}`
          );
        }
      }
    } catch (error) {
      console.error(`error parsing message transaction ${tx}: ${error}`);
      console.error(error);
      throw error;
    }
  }
  return parsedMessage;
}
