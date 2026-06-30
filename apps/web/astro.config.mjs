import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import auth from 'auth-astro';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: process.env.AUTH_URL || process.env.SITE_URL || 'http://localhost:4331',
  integrations: [auth({ injectEndpoints: false })],
  security: {
    checkOrigin: false,
  },
  server: {
    host: true,
    port: Number(process.env.PORT || 4331),
    trustProxy: true,
  },
});
