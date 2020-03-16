import * as net from 'net';
import { readMessageFromSocket } from './event-stream/reader';
import { CoreNodeMessage } from './event-stream/core-node-message';
import { Transaction, readTransaction, TransactionPayloadTypeID } from './p2p/tx';
import { BufferReader } from './binary-reader';
import { NotImplementedError } from './errors';
import { getEnumDescription } from './helpers';

async function handleClientMessage(clientSocket: net.Socket): Promise<void> {
  let msg: CoreNodeMessage;
  const txs: Transaction[] = [];
  try {
    msg = await readMessageFromSocket(clientSocket);
  } catch (error) {
    console.error(`error reading messages from socket: ${error}`);
    console.error(error);
    clientSocket.destroy();
    return;
  }
  try {
    for (const tx of msg.transactions) {
      const txBuffer = Buffer.from(tx.substring(2), 'hex');
      const bufferReader = BufferReader.fromBuffer(txBuffer);
      const parsedTx = readTransaction(bufferReader);
      txs.push(parsedTx);
      console.log(parsedTx);
      switch (parsedTx.payload.typeId) {
        case TransactionPayloadTypeID.Coinbase: {
          break;
        }
        case TransactionPayloadTypeID.SmartContract: {
          console.log(`Smart contract deployed: ${parsedTx.payload.name}: ${parsedTx.payload.codeBody}`);
          break;
        }
        default: {
          throw new NotImplementedError(
            `extracting data for tx type: ${getEnumDescription(TransactionPayloadTypeID, parsedTx.payload.typeId)}`
          );
        }
      }
    }
  } catch (error) {
    console.error(`error parsing message transactions: ${error}`);
    console.error(error);
  }
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
