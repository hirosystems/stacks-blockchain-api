import * as stream from 'stream';
import * as fsPromises from 'fs/promises';

// Vendored and modified source from https://github.com/wmzy/reverse-read-line

export function createReverseFileStream(
  filename: string,
  {
    encoding = 'utf8',
    bufferSize = 4096,
    separator,
  }: {
    encoding?: BufferEncoding;
    bufferSize?: number;
    separator?: string;
  } = {}
): stream.Readable {
  let fd: fsPromises.FileHandle;
  let size: number;
  let offset: number;
  let buffer: Buffer;
  let leftover: Buffer;
  let hasEnd: boolean;
  let lines: string[] = [];
  const sep = separator || /\r?\n/;

  function splitLine(str: string) {
    return str.split(sep);
  }

  let splitBuffer: (buf: Buffer) => number[];

  if (separator) {
    const separatorBuffer = Buffer.from(separator, encoding);
    splitBuffer = (buf: Buffer) => {
      const l = buf.indexOf(separatorBuffer);
      if (l < 0) return [];
      return [l, l + separator.length];
    };
  } else {
    const [bufCR, bufLF] = Buffer.from('\r\n', encoding);
    splitBuffer = function defaultSplitBuffer(buf: Buffer) {
      const l = buf.indexOf(bufLF, 1);
      if (l < 0) return [];

      const r = l + 1;
      if (buf[l - 1] === bufCR) return [l - 1, r];
      return [l, r];
    };
  }

  async function openAndReadStat() {
    if (fd !== undefined) return Promise.resolve();
    fd = await fsPromises.open(filename, 'r');
    const stats = await fd.stat();
    size = stats.size;
    bufferSize = Math.min(size, bufferSize);
    offset = size - bufferSize;
    buffer = Buffer.alloc(bufferSize);
    leftover = Buffer.alloc(0);
    lines = [];
  }

  async function readTrunk(): Promise<void> {
    await openAndReadStat();
    const readResult = await fd.read(buffer, 0, bufferSize, offset);
    const buf = Buffer.concat([readResult.buffer.slice(0, readResult.bytesRead), leftover]);
    if (offset === 0) {
      hasEnd = true;
      const str = buf.toString(encoding);
      lines = splitLine(str).concat(lines);
      return;
    }
    if (offset < bufferSize) {
      bufferSize = offset;
      offset = 0;
    } else {
      offset -= bufferSize;
    }
    const [sl, sr] = splitBuffer(buf);
    if (!sl) {
      leftover = buf;
      return readTrunk();
    }
    leftover = buf.slice(0, sl);
    const str = buf.slice(sr).toString(encoding);
    lines = splitLine(str).concat(lines);
  }

  let trimEndBR: () => void | Promise<void> = () => {
    trimEndBR = () => {};
    if (!lines[lines.length - 1]) lines.pop();
    if (!lines.length && !hasEnd) return readTrunk();
    return Promise.resolve();
  };

  return new stream.Readable({
    encoding: 'utf8',
    async read() {
      if (!lines.length && !hasEnd) {
        await readTrunk();
      }
      await trimEndBR();
      const line = lines.pop();
      this.push(line === undefined ? null : line);
    },
    async destroy(_err, cb) {
      await fd.close();
      cb(null);
    },
  });
}
