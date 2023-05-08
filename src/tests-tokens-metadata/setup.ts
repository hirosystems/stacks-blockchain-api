import { loadDotEnv } from '../helpers';

// ts-unused-exports:disable-next-line
export default () => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  process.env.STACKS_CHAIN_ID = '0x80000000';
  console.log('Jest - setup done');
};
