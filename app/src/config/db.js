// src/config/db.js
const mysql = require("mysql");

const pool = mysql.createPool({
  connectionLimit: 10, // 동시에 열 수 있는 연결 수
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PSWORD,
  database: process.env.DB_DATABASE
});

module.exports = () => pool;
