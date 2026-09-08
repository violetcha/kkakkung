import { copyFile, constants } from 'node:fs/promises';
for (const app of ['apps/web', 'server']) {
  const dest = app === 'apps/web' ? '.env.local' : '.env';
  try {
    await copyFile(
      new URL(`../${app}/.env.example`, import.meta.url),
      new URL(`../${app}/${dest}`, import.meta.url),
      constants.COPYFILE_EXCL,
    );
    console.log(`Created ${app}/${dest}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Kept existing ${app}/${dest}`);
  }
}
