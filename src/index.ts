import * as net from 'net';
import { BinaryReader } from './binaryReader';
import { readMessages, StacksMessageTypeID } from './stacks-p2p';

async function readSocket(socket: net.Socket): Promise<void> {
  const binaryReader = new BinaryReader(socket);
  for await (const message of readMessages(binaryReader)) {
    if (message.messageTypeId === StacksMessageTypeID.Blocks) {
      console.log(`${Date.now()} Received Stacks message type: StacksMessageID.Blocks`);
    }
  }
}

const server = net.createServer(clientSocket => {
  console.log('client connected');
  readSocket(clientSocket).catch(error => {
    console.error(`error reading messages from socket: ${error}`);
    console.error(error);
    clientSocket.destroy();
    server.close();
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
