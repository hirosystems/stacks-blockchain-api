import { Database, QueryResult } from "duckdb";

export class DatasetStore {

  private readonly db;

  constructor() {
    this.db = new Database(':memory:');
  };

  static async connect(): Promise<DatasetStore> {
    return new DatasetStore();
  };

  newBlockEventsIds = () => {
    var con = this.db.connect();
    return new Promise((resolve) => {
      con.all(
        "SELECT ID FROM READ_PARQUET('events/new_block/canonical/*.parquet')",
        (err: any, result: any) => {
          if (err) {
            throw err;
          }

          let res = result.map((a: any) => a.id); // extract IDs as an Array
          resolve(res);
        }
      );
    });
  };

  newBlockEventsOrderedPayloadStream = (): Promise<QueryResult> => {
    return new Promise(async (resolve) => {
      var con = this.db.connect();
      const res = con.stream(
        "SELECT payload FROM READ_PARQUET('events/new_block/canonical/*.parquet') ORDER BY id",
      );

      resolve(res);
    });
  };

  newBurnBlockEventsOrdered = () => {
    return new Promise((resolve) => {
      var con = this.db.connect();
      con.all(
        "SELECT * FROM READ_PARQUET('events/new_burn_block/canonical/*.parquet') ORDER BY id",
        (err: any, result: any) => {
          if (err) {
            throw err;
          }

          resolve(result);
        }
      );
    });
  };
};
