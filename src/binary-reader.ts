import { Readable } from 'stream';
import { SmartBuffer, SmartBufferOptions } from 'smart-buffer';
import { isEnum } from './helpers';

export class BufferReader extends SmartBuffer {
  static fromBuffer(buffer: Buffer): BufferReader {
    return new BufferReader({ buff: buffer });
  }

  constructor(options?: SmartBufferOptions | Buffer) {
    if (Buffer.isBuffer(options)) {
      super({ buff: options });
    } else {
      super(options);
    }
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

  readUInt8Enum<T extends string, TEnumValue extends number>(
    enumVariable: { [key in T]: TEnumValue },
    invalidEnumErrorFormatter: (val: number) => Error
  ): TEnumValue {
    const num = this.readUInt8();
    if (isEnum(enumVariable, num)) {
      return num;
    } else {
      throw invalidEnumErrorFormatter(num);
    }
  }
}

export class BinaryReader {
  readonly readableStream: Readable;

  constructor(readableStream: Readable) {
    this.readableStream = readableStream;
  }

  private readExact(length: number, callback: (error: Error | null, data?: Buffer) => void): void {
    // TODO: debug logging for this during async perf reading testing..
    // console.info(`___INFO: ${(this.readableStream as any).readableFlowing}`);
    const chunk: Buffer = this.readableStream.read(length);
    if (chunk !== null) {
      if (chunk.length !== length) {
        callback(
          new Error(`Unexpected chunk length, expected '${length}', received '${chunk.length}'`)
        );
      }
      callback(null, chunk);
    } else {
      this.readableStream.once('readable', () => {
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

  async readUInt8Enum<T extends string, TEnumValue extends number>(
    enumVariable: { [key in T]: TEnumValue },
    invalidEnumErrorFormatter: (val: number) => Error
  ): Promise<TEnumValue> {
    const num = await this.readUInt8();
    if (isEnum(enumVariable, num)) {
      return num;
    } else {
      throw invalidEnumErrorFormatter(num);
    }
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

  /**
   * Read a fixed amount of bytes into a buffer which provides much faster synchronous
   * buffer read operations. This should always be used for reading a span of fixed-length
   * fields.
   * @param length - Byte count to read into a buffer.
   */
  readFixed(length: number): Promise<BufferReader> {
    return this.readBuffer(length).then(buffer => new BufferReader({ buff: buffer }));
  }
}
