module.exports = {
  apps: [{
    name: 'seshat-web',
    cwd: '/opt/packages/seshat',
    script: 'apps/web/dist/server/entry.mjs',
    env: {
      HOST: '127.0.0.1',
      PORT: '4331',
      NODE_ENV: 'production',
    },
    max_memory_restart: '500M',
    time: true,
  }],
};

