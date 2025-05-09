"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const getDb = require('./src/config/db');
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const accessLogStream = require("./src/config/logs");
const home = require("./src/routes/home");
app.use('/images', express.static(`${__dirname}/src/images`));

app.set("views", "./src/views");
app.set("view engine", "ejs");

// ✅ 백틱 누락 수정
app.use(express.static(`${__dirname}/src/public`));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/", home);

// API 예제
app.get('/api/getObj2', (req, res) => {
    res.json(obj2); // obj2가 어디선가 정의되어 있어야 합니다.
});

app.get('/api/getLatestData', (req, res) => {
    const latestData = {
        waterm: '데이터베이스에서 가져온 값',
        created_at: new Date().toLocaleString(),
    };
    res.json(latestData);
});

app.get('/test', (req, res) => {
    getDb().query('SELECT waterdata FROM waterm ORDER BY created_at DESC LIMIT 1', (err, results) => {
        if (err) {
            console.error('Error retrieving data from MySQL: ' + err);
            return res.status(500).send('Error retrieving data from MySQL');
        }

        if (results.length > 0) {
            const latestData = results[0].waterdata;
            const html = `
              <html>
              <head><title>데이터 표시 예제</title></head>
              <body>
                <h1>최신 데이터:</h1>
                <p>${latestData}</p>
              </body>
              </html>
            `;
            res.send(html);
        } else {
            res.send('No data found in the database.');
        }
    });
});

app.get("/events/all", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendAllDeviceData = () => {
        const sql = `
        SELECT w1.hashNum, w1.valve_of, w1.waterdata, w1.zero_point
        FROM waterm w1
        JOIN (
            SELECT hashNum, MAX(created_at) AS max_created
            FROM waterm
            GROUP BY hashNum
        ) w2 ON w1.hashNum = w2.hashNum AND w1.created_at = w2.max_created
            `;

        getDb().query(sql, (err, results) => {
            if (err) {
                console.error("DB 오류:", err);
                res.write(`event: error\ndata: ${JSON.stringify({ error: "DB_ERROR" })}\n\n`);
                return;
            }

            const dataMap = {};
            results.forEach(row => {
                dataMap[row.hashNum] = {
                    waterLevel: (row.waterdata / 100).toFixed(1),
                    zeroPoint: (row.zero_point || 0), // 🟡 추가!
                    actualValveState: row.valve_of === 'ON' ? "OPEN" : "CLOSED"
                };
            });

            res.write(`data: ${JSON.stringify(dataMap)}\n\n`);
        });
    };

    const intervalId = setInterval(sendAllDeviceData, 5000);
    sendAllDeviceData();

    req.on("close", () => {
        clearInterval(intervalId);
        res.end();
    });
});

module.exports = app;
