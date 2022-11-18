/**
 * Types for https://node-postgres.com/api/cursor
 */
declare module 'pg-cursor' {
  import { QueryResultRow, QueryResult, Submittable } from 'pg';
  interface CursorQueryConfig {
    /** by default rows come out as a key/value pair for each row pass the string 'array' here to receive rows as an array of values */
    rowMode?: string;
    /** custom type parsers just for this query result */
    types?: any;
  }
  class Cursor<R extends QueryResultRow = any> implements Submittable {
    constructor(text: string, values?: any[], config?: CursorQueryConfig);
    /**
     * If the cursor has read to the end of the result sets all subsequent calls to cursor#read will return a 0 length array of rows.
     */
    read(rowCount: number, callback: (err: Error, rows: R[], result: QueryResult<R>) => void): void;
    /**
     * Used to close the cursor early. If you want to stop reading from the cursor before you get all of the rows returned, call this.
     */
    close(callback: (err: Error) => void): void;
    submit(connection: Connection): void;
  }
  namespace Cursor {}
  export = Cursor;
}
