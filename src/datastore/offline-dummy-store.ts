import { EventEmitter } from 'events';
import { DataStore } from './common';

export const OfflineDummyStore: DataStore = new Proxy(new EventEmitter() as DataStore, {
  get(target: any, propKey) {
    if (propKey in target) return target[propKey];
    return function () {
      throw new Error(
        `Cannot call function on the Dummy datastore. Check if the application is running in offline mode.`
      );
    };
  },
});
