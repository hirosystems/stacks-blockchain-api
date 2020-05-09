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
