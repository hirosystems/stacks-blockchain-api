/**
 * Types for https://www.npmjs.com/package/fs-reverse
 */
declare module 'fs-reverse' {
  import * as stream from 'stream';

  function fn(
    file: string,
    opts: { flags?: string; matcher?: string; bufferSize?: number; mode?: number }
  ): stream.Readable;
  namespace fn {}
  export = fn;
}
