import * as Docker from 'dockerode';

// Jest global teardown to stop and remove the container
// ts-unused-exports:disable-next-line
export default async function teardown(): Promise<void> {
  const containers: { id: string; image: string }[] =
    (globalThis as any).__TEST_DOCKER_CONTAINERS ?? [];
  for (const { id, image } of containers) {
    console.log(`Stopping and removing container ${image} - ${id}...`);
    const docker = new Docker();
    const container = docker.getContainer(id);
    await container.remove({ v: true, force: true });
    console.log(`Test docker container ${image} ${id} stopped and removed`);
  }
}
