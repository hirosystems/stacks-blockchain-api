import { Readable } from 'stream';
import { CoreNodeMessage, CoreNodeMessageParsed } from './core-node-message';
import { Transaction, readTransaction, TransactionPayloadTypeID } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
import { NotImplementedError } from '../errors';
import { getEnumDescription } from '../helpers';
import { Address, AddressHashMode, TransactionVersion } from '@blockstack/stacks-transactions/src';

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
    parsed_transactions: new Array(msg.transactions.length),
  };
  for (let i = 0; i < msg.transactions.length; i++) {
    const coreTx = msg.transactions[i];
    try {
      const txBuffer = Buffer.from(coreTx.raw_tx.substring(2), 'hex');
      const bufferReader = BufferReader.fromBuffer(txBuffer);
      const rawTx = readTransaction(bufferReader);
      const parsedTx = {
        ...rawTx,
        origin_address: Address.fromHashMode(
          Buffer.from([rawTx.auth.originCondition.hashMode]).toString('hex') as AddressHashMode,
          Buffer.from([rawTx.version]).toString('hex') as TransactionVersion,
          rawTx.auth.originCondition.signer.toString('hex')
        ).toString(),
      };
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
        case TransactionPayloadTypeID.TokenTransfer: {
          console.log(
            `Token transfer: ${payload.amount} from ${parsedTx.auth.originCondition.signer.toString('hex')} to ${
              payload.address
            }`
          );
          break;
        }
        default: {
          throw new NotImplementedError(
            `extracting data for tx type: ${getEnumDescription(TransactionPayloadTypeID, parsedTx.payload.typeId)}`
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
