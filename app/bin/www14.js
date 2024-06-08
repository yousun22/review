"use strict";
let globalToggleState = 'OFF';  // 초기값을 'OFF'로 설정
const app = require("../app");
const logger = require("../src/config/logger");
const mysql = require('mysql');
const net = require('net');
const specificPhonenum = 37441272;

const PORT = process.env.PORT || 3000;
const TCP_PORT = 61;

let connection;

function connectToDatabase(retries = 5, delay = 5000) {
    if (retries === 0) {
        console.error('Failed to connect to MySQL after several attempts.');
        return;
    }

    connection = mysql.createConnection({
        host: "lecture-review1.cc2disn1eqgs.ap-northeast-2.rds.amazonaws.com",
        user: "yousun22",
        password: "qw21as0500*",
        database: "lecture_review1",
        connectTimeout: 30000
    });

    connection.connect(err => {
        if (err) {
            console.error(`Error connecting to MySQL database: ${err.stack}, retrying in ${delay / 1000} seconds...`);
            setTimeout(() => connectToDatabase(retries - 1, delay), delay);
        } else {
            console.log('Connected to MySQL database as id ' + connection.threadId);
            fetchLatestToggleState(); // 서버 시작 시 최신 상태를 가져옵니다.
        }
    });

    connection.on('error', function(err) {
        console.error('Database connection error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
            console.log('Reconnecting after connection lost or reset...');
            connectToDatabase(retries, delay);
        }
    });
}

function fetchLatestToggleState() {
    connection.query('SELECT valve_of FROM waterm WHERE phonenum = ? ORDER BY created_at DESC LIMIT 1', [specificPhonenum], (err, results) => {
        if (err) {
            console.error('Error retrieving toggle state from MySQL:', err);
        } else if (results.length > 0) {
            const valveState = results[0].valve_of;
            console.log('Retrieved valve_of from database:', valveState);  // 디버깅을 위해 추가
            if (valveState === 'ON' || valveState === 'OFF') {
                globalToggleState = valveState;
            } else {
                console.log('Unexpected value for valve_of:', valveState);
                globalToggleState = 'OFF';  // 기본값 설정
            }
            console.log('Initial global toggle state set to:', globalToggleState);
        } else {
            console.log('No toggle state found in the database.');
            globalToggleState = 'OFF';  // 기본값 설정
        }
    });
}

connectToDatabase();

app.listen(PORT, () => {
    logger.info(`${PORT} 포트에서 서버가 가동되었습니다.`);
});

const clients = {};

var server = net.createServer(function(socket) {
    console.log(`${socket.remoteAddress} connected.`);
    const clientKey = `${socket.remoteAddress}:${socket.remotePort}`;
    clients[clientKey] = clients[clientKey] || { socket, timer: null };

    socket.setKeepAlive(true, 60000);
    socket.setTimeout(50000);

    socket.on('data', function(data) {
        const receivedData = data.toString();
        console.log('Received raw data from client:', data); // raw data 확인
        console.log('Received data from client:', receivedData);

        if (/A|C|K/.test(receivedData)) {
            console.log("Received ACK from client.");
            if (clients[clientKey] && clients[clientKey].timer) {
                clearTimeout(clients[clientKey].timer);
                clients[clientKey].timer = null;
                console.log('Timer cancelled, ACK received within timeout.');
            }
            return;
        }

        if (!receivedData || receivedData.trim() === "") {
            console.error('Received invalid or empty data:', receivedData);
            return;
        }

        if (receivedData.startsWith('PD#')) {
            const dataParts = receivedData.split('#');
            const actuationTime = dataParts[1];
            const phonenum = dataParts.length > 2 ? parseInt(dataParts[2]) : null;
            
            console.log(`Parsed actuationTime: ${actuationTime}, phonenum: ${phonenum}`);
            // 데이터베이스에 삽입하지 않고 로그로만 출력
        } else {
            const dataParts = receivedData.split('!');
            const waterdata = dataParts[0];
            const phonenum = dataParts.length > 1 ? parseInt(dataParts[1]) : null;

            console.log(`Parsed waterdata: ${waterdata}, phonenum: ${phonenum}`);

            if (phonenum) {
                const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' '); // 현재 시간을 MySQL 형식으로 변환
                console.log('Inserting data into MySQL:', { waterdata, phonenum, globalToggleState, created_at: createdAt });

                connection.query(
                    'INSERT INTO waterm (waterdata, created_at, phonenum, valve_of) VALUES (?, ?, ?, ?)', 
                    [waterdata, createdAt, phonenum, globalToggleState], 
                    (err, results) => {
                        if (err) {
                            console.error('Error inserting data into MySQL:', err);
                        } else {
                            console.log('Data successfully inserted into MySQL database');
                            console.log('Inserted data:', { waterdata, phonenum, globalToggleState, created_at: createdAt });
                        }
                    }
                );
            } else {
                console.error('Phonenum is null or invalid.');
            }
        }
    });

    socket.on('timeout', () => {
        console.log('Socket timed out. No data received.');
        socket.end();
    });

    socket.on('close', function() {
        console.log(`${clientKey} disconnected.`);
        if (clients[clientKey]) {
            clearTimeout(clients[clientKey].timer);
        }
        delete clients[clientKey];
    });

    socket.on('error', function(err) {
        console.log('Error with client ' + clientKey + ':', err.message);
        if (clients[clientKey]) {
            clearTimeout(clients[clientKey].timer);
        }
        socket.end();
        delete clients[clientKey];
    });
});

server.on('error', function(err) {
    console.log('Server error:', err.message);
    server.close(() => {
        setTimeout(() => {
            server.listen(TCP_PORT, () => console.log(`Server re-listening on port ${TCP_PORT}...`));
        }, 10000);  // 10초 후에 다시 시도
    });
});

server.listen(TCP_PORT, () => {
    console.log(`Server listening on port ${TCP_PORT}...`);
});

app.post('/update_toggle_state', (req, res) => {
    const newToggleState = req.body.toggleState ? 'ON' : 'OFF';
    const clientKey = Object.keys(clients)[0];
    const client = clients[clientKey];

    if (client && client.socket) {
        const toggleStateString = newToggleState === 'ON' ? "AB" : "CD";
        client.socket.write(toggleStateString, 'utf8', (err) => {
            if (err) {
                console.error('Error sending data to client:', err);
                return res.status(500).send('Error sending data to client');
            }

            console.log('Toggle state sent to client successfully');
            client.socket.once('data', (data) => {
                if (data.toString().trim() === 'ACK') {
                    console.log('ACK received from client:', clientKey);

                    connection.query('UPDATE waterm SET valve_of = ? WHERE phonenum = ? AND created_at = (SELECT * FROM (SELECT MAX(created_at) FROM waterm WHERE phonenum = ?) AS temp)', [newToggleState, specificPhonenum, specificPhonenum], (err, result) => {
                        if (err) {
                            console.error('Error updating valve_of in MySQL:', err);
                            return res.status(500).send('Error updating valve_of in DB');
                        }
                        globalToggleState = newToggleState;
                        console.log('밸브 상태가 바뀌었습니다:', globalToggleState);
                        res.status(200).send('Toggle state updated and sent to client');
                    });
                } else {
                    console.log('Non-ACK message received:', data.toString());
                    res.status(200).send('Toggle state sent but no ACK received');
                }
            });
        });
    } else {
        console.error('Client socket not found for key:', clientKey);
        res.status(404).send('Client not connected');
    }
});

app.get('/toggle_state', (req, res) => {
    res.json({ toggleState: globalToggleState });
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const checkDatabaseAndUpdate = () => {
        connection.query('SELECT waterdata FROM waterm ORDER BY created_at DESC LIMIT 1', (err, results) => {
            if (err) {
                console.error('Error retrieving data from MySQL:', err);
                return;
            }
            if (results.length > 0) {
                let originalData = Number(results[0].waterdata);
                let processedData = (originalData / 100).toFixed(1);
                res.write(`data: ${JSON.stringify(processedData)}\n\n`);
            }
        });
    };

    const intervalId = setInterval(checkDatabaseAndUpdate, 5000);

    req.on('close', () => {
        clearInterval(intervalId);
    });
});

process.on('uncaughtException', function (err) {
    console.error('Uncaught exception:', err);
    // 복구 시도 또는 안전하게 종료
    connectToDatabase(); // MySQL 연결 복구 시도
    server.close(() => {
        server.listen(TCP_PORT, () => console.log(`Server re-listening on port ${TCP_PORT}...`));
    });
});
