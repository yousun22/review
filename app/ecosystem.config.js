module.exports = {
  apps: [
    {
      name: 'www24',
      script: './bin/www24.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
// //pm2 start npm --name "www24" -- start
// {
//   "scripts": {
//     "start": "node ./bin/www24.js"
//   }
// }