import * as inspector from 'inspector';

export async function startCpuProfiler() {
  const session = new inspector.Session();
  session.connect();

  await new Promise<void>((resolve, reject) => {
    session.post('Profiler.enable', error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    session.post('Profiler.start', error => {
      if (error) {
        reject(error);
      } else {
        console.log(`CPU profiling started...`);
        resolve();
      }
    });
  });

  // fs.writeFileSync('./profile.cpuprofile', JSON.stringify(profile));

  const stop = async () => {
    try {
      return await new Promise<inspector.Profiler.Profile>((resolve, reject) => {
        session.post('Profiler.stop', (error, profileResult) => {
          if (error) {
            reject(error);
          } else {
            resolve(profileResult.profile);
          }
        });
      });
    } finally {
      session.disconnect();
    }
  };

  return stop;
}
