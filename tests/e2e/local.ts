/* The e2e tests run offline: a page may only reach the app's own server. Requests to other hosts
   (the UI's web fonts, anything a later change adds) are aborted, so no test needs internet access
   and the sample sites can only draw with the fonts served from public/fonts. URL capture runs in
   the server's own browser, which this does not touch. */
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const test = base.extend<{ localOnly: void }>({
  localOnly: [
    async ({ context }, use) => {
      await context.route((url) => !LOCAL_HOSTS.has(url.hostname), (route) => route.abort('blockedbyclient'));
      await use();
    },
    { auto: true },
  ],
});
