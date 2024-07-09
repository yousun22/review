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
          NODE_ENV: 'development',
          DB_HOST: process.env.DB_HOST,
          DB_PORT: process.env.DB_PORT,
          DB_USER: process.env.DB_USER,
          DB_PSWORD: process.env.DB_PSWORD,
          DB_DATABASE: process.env.DB_DATABASE
        },
        env_production: {
          NODE_ENV: 'production',
          DB_HOST: process.env.DB_HOST,
          DB_PORT: process.env.DB_PORT,
          DB_USER: process.env.DB_USER,
          DB_PSWORD: process.env.DB_PSWORD,
          DB_DATABASE: process.env.DB_DATABASE
        }
      }
    ]
  };
  
  //pm2 start ecosystem.config.js --env production
  //pm2 logs www24
  