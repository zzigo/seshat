const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '.env');
const fileEnv = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...parts] = line.split('=');
    if (key && parts.length) fileEnv[key.trim()] = parts.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

module.exports = {
  apps: [{
    name: 'seshat-web',
    cwd: '/opt/packages/seshat',
    script: 'apps/web/dist/server/entry.mjs',
    env: {
      ...fileEnv,
      HOST: '127.0.0.1',
      PORT: '4331',
      NODE_ENV: 'production',
      AUTH_URL: 'https://seshat.zztt.org',
    },
    max_memory_restart: '500M',
    time: true,
  }],
};
