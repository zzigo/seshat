import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import auth from 'auth-astro';

// foliate-js supports several formats from the same entry point. Its optional
// PDF adapter uses a dynamic vendor URL that Vite 7 interprets as an invalid
// glob even when Seshat only opens EPUB files. Replace that unreachable import
// at build time, keeping the upstream package pinned and otherwise untouched.
const omitFoliatePdf = {
  name: 'omit-foliate-pdf',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/foliate-js/view.js')) return null;
    return code.replace(
      "import('./pdf.js')",
      "Promise.reject(new Error('PDF is handled by Seshat PDF.js'))",
    );
  },
};

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: process.env.AUTH_URL || process.env.SITE_URL || 'http://localhost:4331',
  integrations: [auth({ injectEndpoints: false })],
  vite: {
    plugins: [omitFoliatePdf],
    // Emit hoisted component scripts as external files so the strict
    // workspace CSP (script-src 'self') does not block them.
    // Keep the previous release's hashed assets during in-place production
    // builds so already-open tabs do not receive transient 404 responses.
    build: { assetsInlineLimit: 0, emptyOutDir: false },
  },
  security: {
    checkOrigin: false,
  },
  server: {
    host: true,
    port: Number(process.env.PORT || 4331),
    trustProxy: true,
  },
});
