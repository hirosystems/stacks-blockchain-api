import { Readable, Transform } from 'stream';
import { readLines, readLinesReversed } from './reverse-line-reader';
import { CoreNodeBlockMessage, CoreNodeBurnBlockMessage } from '../event-stream/core-node-message';

const PRUNABLE_EVENT_PATHS = ['/new_mempool_tx', '/drop_mempool_tx', '/new_microblocks'];

export interface TsvEntityData {
  indexBlockHashes: string[];
  canonicalStacksBlockCount: number;
  orphanStacksBlockCount: number;
  burnBlockHashes: string[];
  canonicalBurnBlockCount: number;
  orphanBurnBlockCount: number;
  tsvLineCount: number;
}

export async function getCanonicalEntityList(tsvFilePath: string): Promise<TsvEntityData> {
  const readStream = readLinesReversed(tsvFilePath);

  const indexBlockHashes: string[] = [];
  let findLastStacksBlock = true;
  let stacksBlockOrphanCount = 0;
  let stacksBlockCanonicalCount = 0;
  let lastStacksBlockHeight = -1;

  let tsvLineCount = 0;

  const processStacksBlockLine = (parts: string[]) => {
    const stacksBlock: CoreNodeBlockMessage = JSON.parse(parts[3]);
    if (findLastStacksBlock) {
      indexBlockHashes.push(stacksBlock.parent_index_block_hash, stacksBlock.index_block_hash);
      findLastStacksBlock = false;
    } else {
      if (indexBlockHashes[0] === stacksBlock.index_block_hash) {
        if (stacksBlock.block_height !== 1) {
          indexBlockHashes.unshift(stacksBlock.parent_index_block_hash);
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
      // TODO: can these events be left as-is?
    } else if (PRUNABLE_EVENT_PATHS.includes(parts[2])) {
      // ignore
    } else {
      throw new Error(`Unexpected event type: ${line}`);
    }
  }
  return {
    indexBlockHashes,
    canonicalStacksBlockCount: stacksBlockCanonicalCount,
    orphanStacksBlockCount: stacksBlockOrphanCount,
    burnBlockHashes,
    canonicalBurnBlockCount: burnBlockCanonicalCount,
    orphanBurnBlockCount: burnBlockOrphanCount,
    tsvLineCount,
  };
}

export function readPreorgTsv(
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
          transformStream.push({
            path,
            payload,
            readLineCount,
          });
        }
      } else {
        if (path == '/new_block' || path === '/new_burn_block' || path === '/attachments/new') {
          transformStream.push({
            path,
            payload,
            readLineCount,
          });
        } else {
          callback(new Error(`Unexpected event type: ${line}`));
          return;
        }
      }
      callback();
    },
  });
  const readLineStream = readLines(filePath);
  return readLineStream.pipe(transformStream);
}

export function createTsvReorgStream(
  canonicalIndexBlockHashes: string[],
  canonicalBurnBlockHashes: string[],
  outputCells = false
): Transform {
  let nextCanonicalStacksBlockIndex = 0;
  let nextCanonicalBurnBlockIndex = 0;
  let readLineCount = 0;
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
      if (parts[2] === '/new_block') {
        const block: CoreNodeBlockMessage = JSON.parse(parts[3]);
        if (block.index_block_hash === canonicalIndexBlockHashes[nextCanonicalStacksBlockIndex]) {
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
        // leave alone
      } else if (PRUNABLE_EVENT_PATHS.includes(parts[2])) {
        callback();
        return;
      } else {
        callback(new Error(`Unexpected event type: ${line}`));
        return;
      }
      if (outputCells) {
        filterStream.push({
          path: parts[2],
          payload: parts[3],
          readLineCount,
        });
      } else {
        filterStream.push(line + '\n');
      }
      callback();
    },
  });
  return filterStream;
}
