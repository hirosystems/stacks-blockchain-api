import { defaultSetupTeardown } from '../test-utils/shared-setup';

// ts-unused-exports:disable-next-line
export default async () => {
  console.log('Jest - teardown..');
  await defaultSetupTeardown();
  console.log('Jest - teardown done');
};
