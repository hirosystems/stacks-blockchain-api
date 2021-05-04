import { Server as SocketIOServer, Socket, RemoteSocket } from 'socket.io';
import * as http from 'http';
import { DataStore } from '../../datastore/common';
import { Block } from '@blockstack/stacks-blockchain-api-types';
import { getBlockFromDataStore, parseDbBlock } from '../controllers/db-controller';

// export type AddressRoom<Address extends string> = `address:${Address}`;

export type Room = 'blocks' | 'transactions';

interface ClientToServerMessages {
  subscribe: (room: Room) => void;
  unsubscribe: (room: Room) => void;
}

interface ServerToClientMessages {
  block: (block: Block) => void;
}

export function createSocketIORouter(db: DataStore, server: http.Server) {
  const io = new SocketIOServer<ClientToServerMessages, ServerToClientMessages>(server, {
    // ...
  });

  io.on('connection', socket => {
    socket.on('subscribe', room => {
      void socket.join(room);
    });
    socket.on('unsubscribe', room => {
      void socket.leave(room);
    });
  });

  db.on('blockUpdate', (dbBlock, txIds) => {
    const block = parseDbBlock(dbBlock, txIds);
    io.to('blocks').emit('block', block);
  });

  return io;
}

export function test() {
  const socket: Socket<ServerToClientMessages, ClientToServerMessages> = {} as any;
  socket.emit('subscribe', 'blocks');
  socket.on('block', block => {
    console.log(block.hash);
  });
  // later..
  socket.emit('unsubscribe', 'blocks');
  // socket.on('my-event',)
}
