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

const server = net.createServer((c) => {
  // 'connection' listener.
  console.log('client connected');
  readSocket(c);
  c.on('end', () => {
    console.log('client disconnected');
  });
  // c.write('hello\r\n');
  // c.pipe(c);
});
server.on('error', (err) => {
  throw err;
});
server.listen(3700, () => {
  console.log('server bound');
});
