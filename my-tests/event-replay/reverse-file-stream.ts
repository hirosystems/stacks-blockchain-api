import * as stream from 'stream';
import * as fs from 'fs';

/**
 * Streams lines from a text file in reverse, starting from the end of the file.
 * Modernized version of https://www.npmjs.com/package/fs-reverse
 */
export class ReverseFileStream extends stream.Readable {
  private fileDescriptor: number;
  private position: number;

  private lineBuffer: string[] = [];
  private remainder: string = '';

  public readonly fileLength: number;
  public bytesRead: number = 0;

  constructor(filePath: string, opts?: stream.ReadableOptions) {
    super({
      ...{
        // `objectMode` avoids the `Buffer->utf8->Buffer->utf8` conversions when pushing strings
        objectMode: true,
        // Restore default size for byte-streams, since objectMode sets it to 16
        highWaterMark: 16384,
        autoDestroy: true,
      },
      ...opts,
    });
    this.fileLength = fs.statSync(filePath).size;
    this.position = this.fileLength;
    this.fileDescriptor = fs.openSync(filePath, 'r', 0o666);
  }

  _read(size: number): void {
    while (this.lineBuffer.length === 0 && this.position > 0) {
      // Read `size` bytes from the end of the file.
      const length = Math.min(size, this.position);
      const buffer = Buffer.alloc(length);
      this.position = this.position - length;
      this.bytesRead += fs.readSync(this.fileDescriptor, buffer, 0, length, this.position);

      // Split into lines to fill the `lineBuffer`
      this.remainder = buffer.toString('utf8') + this.remainder;
      this.lineBuffer = this.remainder.split(/\r?\n/);

      // Ignore empty/trailing lines, `readable.push('')` is not recommended
      this.lineBuffer = this.lineBuffer.filter(line => line.length > 0);
      const remainderHasPrefixEnding = this.remainder.startsWith('\n');
      this.remainder = this.lineBuffer.shift() ?? '';

      // Preserve the line-ending char for the remainder if one was at the read boundary
      if (remainderHasPrefixEnding) {
        this.remainder = '\n' + this.remainder;
      }
    }
    if (this.lineBuffer.length) {
      this.push(this.lineBuffer.pop());
    } else if (this.remainder.length) {
      this.push(this.remainder);
      this.remainder = '';
    } else {
      this.push(null);
    }
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    fs.closeSync(this.fileDescriptor);
  }
}
