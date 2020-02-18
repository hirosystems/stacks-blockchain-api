import { Readable } from 'stream';
import { SmartBuffer } from 'smart-buffer';

function readExact(stream: Readable, byteCount: number, callback: (error: Error | null, data?: Buffer) => void): void {
  const chunk: Buffer = stream.read(byteCount);
  if (chunk !== null) {
    if (chunk.length !== byteCount) {
      callback(new Error(`Unexpected chunk length, expected '${byteCount}', received '${chunk.byteLength}'`));
    }
    callback(null, chunk);
  } else {
    stream.once('readable', () => {
      readExact(stream, byteCount, callback);
    });
  }
}

export function readBuffer(stream: Readable, byteCount: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    readExact(stream, byteCount, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    })
  });
}

export async function readByte(stream: Readable): Promise<number> {
  const buffer = await readBuffer(stream, 1);
  return buffer[0];
}

export async function readUInt16BE(stream: Readable): Promise<number> {
  const buffer = await readBuffer(stream, 2);
  return buffer.readUInt16BE(0);
}

export async function readUInt32BE(stream: Readable): Promise<number> {
  const buffer = await readBuffer(stream, 4);
  return buffer.readUInt32BE(0);
}

export async function readUInt64BE(stream: Readable): Promise<bigint> {
  const buffer = await readBuffer(stream, 8);
  return buffer.readBigUInt64BE(0);
}

export async function read32Bytes(stream: Readable): Promise<Buffer> {
  const buffer = await readBuffer(stream, 32);
  return buffer;
}

export class BufferReader extends SmartBuffer {

  constructor(buff: Buffer) {
    super({ buff: buff });
  }

  static async fromStream(stream: Readable, length: number): Promise<BufferReader> {
    const buff = await readBuffer(stream, length);
    return new BufferReader(buff);
  }

  readBigUIntLE(length: number): bigint {
    const buffer = Buffer.from(this.readBuffer(length)).reverse();
    const hex = buffer.toString('hex');
    const num = BigInt(`0x${hex}`);
    return num;
  }
  
  readBigUIntBE(length: number): bigint {
    const buffer = this.readBuffer(length);
    const hex = buffer.toString('hex');
    const num = BigInt(`0x${hex}`);
    return num;
  }
}
