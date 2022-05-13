import { Readable, Transform } from 'stream';
import { readLines, readLinesReversed } from './reverse-line-reader';
import {
  CoreNodeAttachmentMessage,
  CoreNodeBlockMessage,
  CoreNodeBurnBlockMessage,
} from '../event-stream/core-node-message';

const PRUNABLE_EVENT_PATHS = ['/new_mempool_tx', '/drop_mempool_tx', '/new_microblocks'];

export interface TsvEntityData {
  stacksBlockHashes: StacksBlockHashes;
  canonicalStacksBlockCount: number;
  orphanStacksBlockCount: number;
  burnBlockHashes: string[];
  canonicalBurnBlockCount: number;
  orphanBurnBlockCount: number;
  tsvLineCount: number;
}

type StacksBlockHashes = [
  indexBlockHash: string,
  microblocks: [microblockHash: string, txIds: string[]][]
][];

export async function getCanonicalEntityList(tsvFilePath: string): Promise<TsvEntityData> {
  const readStream = readLinesReversed(tsvFilePath);

  const stacksBlockHashes: StacksBlockHashes = [];
  let findLastStacksBlock = true;
  let stacksBlockOrphanCount = 0;
  let stacksBlockCanonicalCount = 0;
  let lastStacksBlockHeight = -1;

  let tsvLineCount = 0;

  const getMicroblockHashes = (msg: CoreNodeBlockMessage) => {
    const microblockTxs = new Map<string, { mbSequence: number; txs: string[] }>();
    msg.transactions.forEach(tx => {
      const mbHash = tx.microblock_hash ?? '';
      const mb = microblockTxs.get(mbHash);
      if (mb) {
        mb.txs.push(tx.txid);
      } else {
        microblockTxs.set(mbHash, {
          mbSequence: tx.microblock_sequence ?? -1,
          txs: [tx.txid],
        });
      }
    });
    const result: [microblockHash: string, txIds: string[]][] = [
      ...microblockTxs.entries(),
    ].map(mb => [mb[0], mb[1].txs]);
    return result;
  };

  const processStacksBlockLine = (parts: string[]) => {
    const stacksBlock: CoreNodeBlockMessage = JSON.parse(parts[3]);
    if (findLastStacksBlock) {
      stacksBlockHashes.unshift(
        [stacksBlock.parent_index_block_hash, []],
        [stacksBlock.index_block_hash, getMicroblockHashes(stacksBlock)]
      );
      findLastStacksBlock = false;
    } else {
      if (stacksBlockHashes[0][0] === stacksBlock.index_block_hash) {
        stacksBlockHashes[0][1] = getMicroblockHashes(stacksBlock);
        if (stacksBlock.block_height !== 1) {
          stacksBlockHashes.unshift([stacksBlock.parent_index_block_hash, []]);
        }
        stacksBlockCanonicalCount++;
        if (lastStacksBlockHeight !== -1) {
          if (lastStacksBlockHeight !== stacksBlock.block_height + 1) {
            throw new Error(
              `Unexpected block heights: ${lastStacksBlockHeight} vs ${stacksBlock.block_height}`
            );
          }
        }
        lastStacksBlockHeight = stacksBlock.block_height;
      } else {
        stacksBlockOrphanCount++;
      }
    }
  };

  const burnBlockHashes: string[] = [];
  let findLastBurnBlock = true;
  let burnBlockOrphanCount = 0;
  let burnBlockCanonicalCount = 0;
  let lastBurnBlockHeight = -1;

  const processBurnBlockLine = (parts: string[]) => {
    const burnBlock: CoreNodeBurnBlockMessage = JSON.parse(parts[3]);
    if (findLastBurnBlock) {
      findLastBurnBlock = false;
      burnBlockHashes.unshift(burnBlock.burn_block_hash);
    } else {
      if (burnBlock.burn_block_height >= lastBurnBlockHeight) {
        // ignore orphaned burn block, detected orphan via height
        burnBlockOrphanCount++;
        return;
      } else if (burnBlock.burn_block_hash === burnBlockHashes[0]) {
        // ignore burn block, detected dupe block hash
        burnBlockOrphanCount++;
        return;
      } else {
        burnBlockHashes.unshift(burnBlock.burn_block_hash);
      }
    }
    lastBurnBlockHeight = burnBlock.burn_block_height;
    burnBlockCanonicalCount++;
  };

  for await (const line of readStream) {
    if (line === '') {
      continue;
    }
    tsvLineCount++;
    const parts = line.split('\t');
    if (parts.length !== 4) {
      throw new Error(`unexpected line: ${line}`);
    }
    if (parts[2] === '/new_block') {
      processStacksBlockLine(parts);
    } else if (parts[2] === '/new_burn_block') {
      processBurnBlockLine(parts);
    } else if (parts[2] === '/attachments/new') {
      // ignore
    } else if (PRUNABLE_EVENT_PATHS.includes(parts[2])) {
      // ignore
    } else {
      throw new Error(`Unexpected event type: ${line}`);
    }
  }
  return {
    stacksBlockHashes: stacksBlockHashes,
    canonicalStacksBlockCount: stacksBlockCanonicalCount,
    orphanStacksBlockCount: stacksBlockOrphanCount,
    burnBlockHashes,
    canonicalBurnBlockCount: burnBlockCanonicalCount,
    orphanBurnBlockCount: burnBlockOrphanCount,
    tsvLineCount,
  };
}

export function readTsvLines(
  filePath: string,
  pathFilter?: '/new_block' | '/new_burn_block' | '/attachments/new'
): Readable {
  let readLineCount = 0;
  const transformStream = new Transform({
    objectMode: true,
    autoDestroy: true,
    transform: (line: string, _encoding, callback) => {
      if (line === '') {
        callback();
        return;
      }
      readLineCount++;
      const [, , path, payload] = line.split('\t');
      if (pathFilter !== undefined) {
        if (path === pathFilter) {
          callback(null, {
            path,
            payload,
            readLineCount,
          });
          return;
        }
      } else {
        callback(null, {
          path,
          payload,
          readLineCount,
        });
        return;
      }
      callback();
    },
  });
  const readLineStream = readLines(filePath);
  return readLineStream.pipe(transformStream);
}

export function createTsvReorgStream({
  canonicalStacksBlockHashes,
  canonicalBurnBlockHashes,
  preorgBlockHeight,
  outputCells = false,
}: {
  canonicalStacksBlockHashes: StacksBlockHashes;
  canonicalBurnBlockHashes: string[];
  preorgBlockHeight: number;
  outputCells?: boolean;
}): Transform {
  let nextCanonicalStacksBlockIndex = 0;
  let nextCanonicalBurnBlockIndex = 0;
  let readLineCount = 0;
  let blockLimitFound = false;
  const canonicalIndexBlockHashesSet = new Map(canonicalStacksBlockHashes);
  const eventIdsRead = new Set<number>();
  const filterStream = new Transform({
    objectMode: true,
    autoDestroy: true,
    transform: (line: string, _encoding, callback) => {
      if (line === '') {
        callback();
        return;
      }
      readLineCount++;
      const parts = line.split('\t');
      const eventId = parseInt(parts[0]);
      // ignore duplicate events
      if (eventIdsRead.has(eventId)) {
        callback();
        return;
      }
      eventIdsRead.add(eventId);
      if (blockLimitFound) {
        // stop performing reorg logic and passthrough lines as-is
      } else if (parts[2] === '/new_block') {
        const block: CoreNodeBlockMessage = JSON.parse(parts[3]);
        if (block.block_height === preorgBlockHeight) {
          // emit `blockFound` so consumers of this stream can switch read behavior
          blockLimitFound = true;
          filterStream.emit('blockFound');
        } else if (
          block.index_block_hash === canonicalStacksBlockHashes[nextCanonicalStacksBlockIndex][0]
        ) {
          nextCanonicalStacksBlockIndex++;
        } else {
          // ignore orphaned block
          callback();
          return;
        }
      } else if (parts[2] === '/new_burn_block') {
        const burnBlock: CoreNodeBurnBlockMessage = JSON.parse(parts[3]);
        if (burnBlock.burn_block_hash === canonicalBurnBlockHashes[nextCanonicalBurnBlockIndex]) {
          nextCanonicalBurnBlockIndex++;
        } else {
          // ignore orphaned or duplicate burn block
          callback();
          return;
        }
      } else if (parts[2] === '/attachments/new') {
        const attachments: CoreNodeAttachmentMessage[] = JSON.parse(parts[3]);
        const canonicalAttachments = attachments.filter(attm =>
          canonicalIndexBlockHashesSet.has(attm.index_block_hash)
        );
        if (canonicalAttachments.length === 0) {
          // this event does not contain any canonical data, ignore it
          callback();
          return;
        }
        // Some entries are canonical and some are not. This payload needs to be manipulated to
        // exclude the non-canonical data.
        if (canonicalAttachments.length !== attachments.length) {
          parts[3] = JSON.stringify(canonicalAttachments);
          line = parts.join('\t');
        }
      } else if (PRUNABLE_EVENT_PATHS.includes(parts[2])) {
        callback();
        return;
      } else {
        callback(new Error(`Unexpected event type: ${line}`));
        return;
      }
      if (outputCells) {
        callback(null, {
          path: parts[2],
          payload: parts[3],
          readLineCount,
        });
      } else {
        callback(null, line + '\n');
      }
    },
  });
  return filterStream;
}
