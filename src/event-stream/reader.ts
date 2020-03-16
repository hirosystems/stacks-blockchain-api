import * as net from 'net';
import { CoreNodeMessage } from './core-node-message';

/**
 * Read JSON messages from a core-node event stream socket.
 */
export async function readMessageFromSocket(socket: net.Socket): Promise<CoreNodeMessage> {
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
