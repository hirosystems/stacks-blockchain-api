import * as net from 'net';
import { readMessageFromSocket } from './event-stream/reader';
import { CoreNodeMessage } from './event-stream/core-node-message';
import { Transaction, readTransaction, TransactionPayloadTypeID } from './p2p/tx';
import { BufferReader } from './binary-reader';
import { NotImplementedError } from './errors';
import { getEnumDescription } from './helpers';

export interface CoreNodeMessageParsed extends CoreNodeMessage {
  parsed_transactions: Transaction[];
}

function parseMessageTransactions(msg: CoreNodeMessage): CoreNodeMessageParsed {
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

async function handleClientMessage(clientSocket: net.Socket): Promise<void> {
  let msg: CoreNodeMessage;
  try {
    msg = await readMessageFromSocket(clientSocket);
    if (msg.events.length > 0) {
      console.log('got events');
    }
  } catch (error) {
    console.error(`error reading messages from socket: ${error}`);
    console.error(error);
    clientSocket.destroy();
    return;
  }
  const parsedMsg = parseMessageTransactions(msg);
  const stringified = JSON.stringify(parsedMsg, (key, value) => {
    if (typeof value === 'bigint') {
      return `0x${value.toString(16)}`;
    }
    return value;
  });
  console.log(stringified);
}

const server = net.createServer(clientSocket => {
  console.log('client connected');
  handleClientMessage(clientSocket).catch(error => {
    console.error(`error processing socket connection: ${error}`);
    console.error(error);
  });
  clientSocket.on('end', () => {
    console.log('client disconnected');
  });
});

server.on('error', err => {
  console.error('socket server error:');
  console.error(err);
  throw err;
});

server.listen(3700, () => {
  const addr = server.address();
  if (addr === null) {
    throw new Error('server missing address');
  }
  const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  console.log(`server listening at ${addrStr}`);
});
