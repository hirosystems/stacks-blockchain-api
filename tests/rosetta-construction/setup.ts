import { defaultSetupInit } from '../utils/shared-setup';

// ts-unused-exports:disable-next-line
export default async () => {
  console.log('Jest - setup..');
  await defaultSetupInit();
  console.log('Jest - setup done');
};
