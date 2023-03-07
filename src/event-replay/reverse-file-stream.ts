import * as stream from 'stream';
import * as fs from 'fs';

function splitBuffer(input: Buffer, matcher: number): Buffer[] {
  const chunks: Buffer[] = [];
  let position = 0;
  let matchIndex: number;
  do {
    matchIndex = input.indexOf(matcher, position);
    if (matchIndex === -1) {
      chunks.push(input.subarray(position));
    } else {
      chunks.push(input.subarray(position, matchIndex));
    }
    position = matchIndex + 1;
  } while (matchIndex !== -1);
  return chunks;
}

interface ReadableFileStream extends stream.Readable {
  getFileSize(): number;
  getBytesRead(): number;
}

function createReverseFileReadStream(
  filePath: fs.PathLike,
  readBufferSize = 1_000_000
): ReadableFileStream {
  let fileDescriptor: number;
  let fileSize: number;
  let filePosition: number;
  const reverseReadStream = new stream.Readable({
    highWaterMark: readBufferSize,
    construct: callback => {
      fs.open(filePath, 'r', (error, fd) => {
        if (error) {
          callback(error);
          return;
        }
        fileDescriptor = fd;
        fs.fstat(fd, (error, stats) => {
          if (error) {
            callback(error);
            return;
          }
          fileSize = stats.size;
          filePosition = fileSize;
          callback();
        });
      });
    },
    read: size => {
      if (filePosition === 0) {
        reverseReadStream.push(null);
        return;
      }
      const readSize = Math.min(size, filePosition);
      const buff = Buffer.allocUnsafe(readSize);
      fs.read(fileDescriptor, buff, 0, readSize, filePosition - readSize, (error, bytesRead) => {
        if (error) {
          reverseReadStream.destroy(error);
          return;
        }
        filePosition -= bytesRead;
        if (bytesRead > 0) {
          reverseReadStream.push(buff.slice(0, bytesRead));
        } else {
          reverseReadStream.push(null);
        }
      });
    },
    destroy: (error, callback) => {
      if (fileDescriptor) {
        fs.close(fileDescriptor, closeError => callback(closeError || error));
      } else {
        callback(error);
      }
    },
  });
  return Object.assign(reverseReadStream, {
    getFileSize: () => fileSize,
    getBytesRead: () => fileSize - filePosition,
  });
}

/**
 * @param filePath - Path to the file to read.
 * @param readBufferSize - Defaults to ~1 megabytes
 */
export function readLinesReversed(
  filePath: fs.PathLike,
  readBufferSize = 1_000_000
): ReadableFileStream {
  let last: Buffer | undefined = undefined;
  const matcher = '\n'.charCodeAt(0);

  const reverseReadStream = createReverseFileReadStream(filePath, readBufferSize);

  const transformStream = new stream.Transform({
    autoDestroy: true,
    readableObjectMode: true,
    writableHighWaterMark: readBufferSize,
    flush: callback => {
      if (last) {
        try {
          transformStream.push(last.toString('utf8'));
        } catch (error: any) {
          callback(error);
          return;
        }
      }
      callback();
    },
    transform: (chunk: Buffer, _encoding, callback) => {
      if (last !== undefined) {
        last = Buffer.concat([chunk, last]);
      } else {
        last = chunk;
      }
      const list = splitBuffer(last, matcher);
      last = list.shift();

      for (let i = list.length - 1; i >= 0; i--) {
        try {
          transformStream.push(list[i].toString('utf8'));
        } catch (error: any) {
          callback(error);
          return;
        }
      }

      callback();
    },
    destroy: (error, callback) => {
      if ((error as Error)?.name === 'AbortError') {
        // Ignore "AbortError", it means the stream was intentionally destroyed (e.g. a `break` statement in an async iterator)
        error = null;
      }
      reverseReadStream.destroy(error || undefined);
      callback(error);
    },
  });

  const pipelineResult = reverseReadStream.pipe(transformStream);
  return Object.assign(pipelineResult, {
    getFileSize: () => reverseReadStream.getFileSize(),
    getBytesRead: () => reverseReadStream.getBytesRead(),
  });
}
