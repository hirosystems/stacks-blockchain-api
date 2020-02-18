import * as net from 'net';
import { Readable } from 'stream';
import { readUInt32BE } from './binaryReader';
import { readBlockHeader } from './blockReader';
import { readTransactions } from './txReader';


async function readBlocks(stream: Readable) {
  try {
    do {
      const eventType = await readUInt32BE(stream);
      if (eventType !== 1) {
        throw new Error(`Expected event type 1 (block) but received ${eventType}`);
      }
      const blockHeader = await readBlockHeader(stream);
      console.log(blockHeader);
      const txs = await readTransactions(stream);
      console.log(txs);
      console.log(Date.now());
    } while (!stream.destroyed)
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

const server = net.createServer((c) => {
  // 'connection' listener.
  console.log('client connected');
  // processLineByLine(c);
  readBlocks(c);
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
