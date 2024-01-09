import { defaultSetupInit } from '../test-utils/shared-setup';

// ts-unused-exports:disable-next-line
export default async () => {
  console.log('Jest - setup..');
  await defaultSetupInit({dummyEventHandler: true});
  process.env.PG_DATABASE = 'postgres';
  console.log('Jest - setup done');
};
