import { Readable } from 'stream';
import { SmartBuffer } from 'smart-buffer';

class BufferReader extends SmartBuffer {
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

export class BinaryReader {
  readonly stream: Readable;

  constructor(stream: Readable) {
    this.stream = stream;
  }

  private readExact(length: number, callback: (error: Error | null, data?: Buffer) => void): void {
    const chunk: Buffer = this.stream.read(length);
    if (chunk !== null) {
      if (chunk.length !== length) {
        callback(new Error(`Unexpected chunk length, expected '${length}', received '${chunk.length}'`));
      }
      callback(null, chunk);
    } else {
      this.stream.once('readable', () => {
        this.readExact(length, callback);
      });
    }
  }

  readBuffer(length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.readExact(length, (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data);
        }
      });
    });
  }

  readUInt8(): Promise<number> {
    return this.readBuffer(1).then(buffer => buffer[0]);
  }

  readUInt16BE(): Promise<number> {
    return this.readBuffer(2).then(buffer => buffer.readUInt16BE(0));
  }

  readUInt32BE(): Promise<number> {
    return this.readBuffer(4).then(buffer => buffer.readUInt32BE(0));
  }

  readUInt64BE(): Promise<bigint> {
    return this.readBuffer(8).then(buffer => buffer.readBigUInt64BE(0));
  }

  read32Bytes(): Promise<Buffer> {
    return this.readBuffer(32);
  }

  sync(length: number): Promise<BufferReader> {
    return this.readBuffer(length).then(buffer => new BufferReader({ buff: buffer }));
  }
}
