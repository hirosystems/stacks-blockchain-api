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

  constructor(filePath: string) {
    super();
    this.position = fs.statSync(filePath).size;
    this.fileDescriptor = fs.openSync(filePath, 'r', 0o666);
  }

  _read(size: number): void {
    while (this.lineBuffer.length === 0 && this.position > 0) {
      // Read `size` bytes from the end of the file.
      const length = Math.min(size, this.position);
      const buffer = Buffer.alloc(length);
      this.position = this.position - length;
      fs.readSync(this.fileDescriptor, buffer, 0, length, this.position);

      // Split into lines to fill the `lineBuffer`.
      this.remainder = buffer + this.remainder;
      this.lineBuffer = this.remainder.split('\n');
      this.remainder = this.lineBuffer.shift() ?? '';
    }
    if (this.lineBuffer.length) {
      this.push(this.lineBuffer.pop() + '\n');
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
