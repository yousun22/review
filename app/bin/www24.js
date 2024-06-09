"use strict";
let globalToggleStates = {}; // 각 전화번호별 상태를 관리하는 객체
require('dotenv').config(); // .env 파일에서 환경 변수를 로드
const app = require("../app");
const logger = require("../src/config/logger");
const mysql = require('mysql');
const net = require('net');

const PORT = process.env.PORT || 3000;
const TCP_PORT = 61;

let connection;
let retryTimeout = 35000; // 35초 후 재시도
const pingInterval = 1 * 60 * 1000; // 15분
const secondPingDelay = 0.2 * 60 * 1000; // 1분
const timeoutThreshold = 3 * 60 * 1000; // 2분

function connectToDatabase(retries = 5, delay = 5000) {
    if (retries === 0) {
        console.error('Failed to connect to MySQL after several attempts.');
        return;
    }

    connection = mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PSWORD,
        database: process.env.DB_DATABASE,
        connectTimeout: 30000,
        multipleStatements: true // 여러 쿼리를 한 번에 실행할 수 있게 설정
    });

    connection.connect(err => {
        if (err) {
            console.error(`Error connecting to MySQL database: ${err.stack}, retrying in ${delay / 1000} seconds...`);
            setTimeout(() => connectToDatabase(retries - 1, delay), delay);
        } else {
            console.log('Connected to MySQL database as id ' + connection.threadId);
            fetchLatestToggleStates(); // 서버 시작 시 최신 상태를 가져옵니다.
        }
    });

    connection.on('error', function(err) {
        console.error('Database connection error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
            console.log('Reconnecting after connection lost or reset...');
            connectToDatabase(retries, delay);
        }
    });
}

function fetchLatestToggleStates() {
    connection.query('SELECT phonenum, valve_of FROM (SELECT phonenum, valve_of, ROW_NUMBER() OVER (PARTITION BY phonenum ORDER BY created_at DESC) as rnum FROM waterm) temp WHERE rnum = 1', 
    (err, results) => {
        if (err) {
            console.error('Error retrieving toggle states from MySQL:', err);
        } else if (results.length > 0) {
            results.forEach(result => {
                const phonenum = result.phonenum;
                const valveState = result.valve_of;
                console.log(`Retrieved valve_of for phonenum ${phonenum} from database:`, valveState);
                if (valveState === 'ON' || valveState === 'OFF') {
                    globalToggleStates[phonenum] = valveState;
                } else {
                    console.log('Unexpected value for valve_of:', valveState);
                    globalToggleStates[phonenum] = 'OFF';  // 기본값 설정
                }
            });
            console.log('Initial global toggle states set to:', globalToggleStates);
        } else {
            console.log('No toggle states found in the database.');
        }
    });
}

connectToDatabase();

app.listen(PORT, () => {
    logger.info(`${PORT} 포트에서 서버가 가동되었습니다.`);
});

const clients = {};
const retryTimers = {};
const retryStartTimes = {}; // 시작 시간을 저장할 객체
const commandReceiveTimes = {}; // OCK와 FCK를 받은 시간을 저장할 객체
const lastMessageReceivedTimes = {}; // 마지막으로 메시지를 받은 시간을 저장할 객체

function resendToggleCommand(client, toggleStateString, clientKey, phonenum) {
    if (client && client.socket) {
        client.socket.write(toggleStateString, 'utf8', (err) => {
            if (err) {
                console.error('Error resending data to client:', err);
                return;
            }

            console.log('Toggle state resent to client successfully');
            client.socket.once('data', (data) => {
                const receivedData = data.toString().trim();
                if (receivedData === 'OCK') {
                    console.log('OCK received from client on resend:', clientKey);
                    commandReceiveTimes[clientKey] = Date.now(); // OCK 받은 시간 기록
                    updateValveState('ON', phonenum);
                    setRetryTimer(clientKey, 'ON', toggleStateString);
                } else if (receivedData === 'FCK') {
                    console.log('FCK received from client on resend:', clientKey);
                    commandReceiveTimes[clientKey] = Date.now(); // FCK 받은 시간 기록
                    updateValveState('OFF', phonenum);
                    setRetryTimer(clientKey, 'OFF', toggleStateString);
                } else {
                    console.log('Non-CK message received on resend:', receivedData);
                    // Do not update the database if OCK or FCK is not received
                }
            });
        });
    } else {
        console.error('Client socket not found for key:', clientKey);
    }
}

function setRetryTimer(clientKey, state, toggleStateString) {
    clearRetryTimer(clientKey); // 기존 타이머를 지웁니다.
    retryStartTimes[clientKey] = Date.now(); // 재시도 타이머 시작 시간 기록
    retryTimers[clientKey] = setTimeout(() => {
        console.log(`Timeout: Did not receive ${state === 'ON' ? 'OND' : 'FND'} from client ${clientKey} within ${retryTimeout / 1000} seconds.`);
        console.log(`Retrying command for client ${clientKey} due to no OND/FND received`);
        const client = clients[clientKey];
        if (client && client.socket) {
            client.socket.write(toggleStateString, 'utf8', (err) => {
                if (err) {
                    console.error('Error resending data to client:', err);
                } else {
                    console.log(`Resent ${state} command to client ${clientKey}`);
                }
            });
        }
    }, retryTimeout);
}

function clearRetryTimer(clientKey) {
    if (retryTimers[clientKey]) {
        clearTimeout(retryTimers[clientKey]);
        delete retryTimers[clientKey];
        console.log(`Timeout cleared: ${clientKey} received OND/FND.`);
    }
}

function updateValveState(newState, phonenum) {
    connection.query('UPDATE waterm SET valve_of = ? WHERE phonenum = ? AND created_at = (SELECT * FROM (SELECT MAX(created_at) FROM waterm WHERE phonenum = ?) AS temp)', 
    [newState, phonenum, phonenum], (err, result) => {
        if (err) {
            console.error('Error updating valve_of in MySQL:', err);
        } else {
            globalToggleStates[phonenum] = newState;
            console.log(`밸브 상태가 바뀌었습니다: ${newState} for phonenum ${phonenum}`);
        }
    });
}

var server = net.createServer(function(socket) {
    console.log(`${socket.remoteAddress} connected.`);
    const clientKey = `${socket.remoteAddress}:${socket.remotePort}`;
    clients[clientKey] = { socket, phonenum: null, timer: null };

    socket.setKeepAlive(true, 60000);
    socket.setTimeout(50000);

    // 여기에서 최대 리스너 수를 늘립니다.
    socket.setMaxListeners(20);

    socket.on('data', function(data) {
        const receivedData = data.toString();
        console.log('Received raw data from client:', data); // raw data 확인
        console.log('Received data from client:', receivedData);

        // 마지막 메시지 수신 시간을 기록
        lastMessageReceivedTimes[clientKey] = Date.now();

        if (receivedData === 'OCK' || receivedData === 'FCK') {
            console.log(`${receivedData} received from client.`);
            if (clients[clientKey] && clients[clientKey].timer) {
                clearTimeout(clients[clientKey].timer);
                clients[clientKey].timer = null;
                console.log('Timer cancelled, valid response received within timeout.');
            }
            commandReceiveTimes[clientKey] = Date.now(); // OCK 또는 FCK 받은 시간 기록
            updateValveState(receivedData === 'OCK' ? 'ON' : 'OFF', clients[clientKey].phonenum);
            return;
        }

        if (receivedData === 'OND' || receivedData === 'FND') {
            console.log(`${receivedData} received from client.`);
            clearRetryTimer(clientKey);
            const timeElapsed = Date.now() - commandReceiveTimes[clientKey]; // 경과 시간 계산
            console.log(`Timeout cleared: ${clientKey} received ${receivedData} after ${timeElapsed}ms.`);

            if (timeElapsed <= 29000) {
                console.log(`Resending command to client ${clientKey} as response time was ${timeElapsed}ms.`);
                const toggleStateString = globalToggleStates[clients[clientKey].phonenum] === 'ON' ? 'AD' : 'HZ';
                
                // 1초 후에 명령을 재전송
                setTimeout(() => {
                    resendToggleCommand(clients[clientKey], toggleStateString, clientKey, clients[clientKey].phonenum);
                }, 1000);
            }
            return;
        }

        if (!receivedData || receivedData.trim() === "") {
            console.error('Received invalid or empty data:', receivedData);
            return;
        }

        const dataParts = receivedData.split('!');
        const waterdata = dataParts[0];
        const phonenum = dataParts.length > 1 ? parseInt(dataParts[1]) : null;

        console.log(`Parsed waterdata: ${waterdata}, phonenum: ${phonenum}`);

        if (phonenum) {
            clients[clientKey].phonenum = phonenum; // 클라이언트에 전화번호 할당
            const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' '); // 현재 시간을 MySQL 형식으로 변환
            console.log('Inserting data into MySQL:', { waterdata, phonenum, globalToggleStates: globalToggleStates[phonenum], created_at: createdAt });

            connection.query(
                'INSERT INTO waterm (waterdata, created_at, phonenum, valve_of) VALUES (?, ?, ?, ?)', 
                [waterdata, createdAt, phonenum, globalToggleStates[phonenum]], 
                (err, results) => {
                    if (err) {
                        console.error('Error inserting data into MySQL:', err);
                    } else {
                        console.log('Data successfully inserted into MySQL database');
                    }
                }
            );
        } else {
            console.error('Phonenum is null or invalid.');
        }
    });

    socket.on('timeout', () => {
        console.log(`Socket timeout for client ${clientKey}. No data received.`);
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

// 서버 객체에 대해 최대 리스너 수를 늘립니다.
server.setMaxListeners(20);

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
    const phonenum = req.body.phonenum; // 요청에서 전화번호를 가져옵니다.
    const clientKey = Object.keys(clients).find(key => clients[key].phonenum === phonenum);
    const client = clients[clientKey];

    if (client && client.socket) {
        const toggleStateString = newToggleState === 'ON' ? "AD" : "HZ";
        client.socket.write(toggleStateString, 'utf8', (err) => {
            if (err) {
                console.error('Error sending data to client:', err);
                return res.status(500).send('Error sending data to client');
            }

            console.log('Toggle state sent to client successfully');
            client.socket.once('data', (data) => {
                const receivedData = data.toString().trim();
                if (receivedData === 'FCK') {
                    console.log('FCK received from client:', clientKey);
                    commandReceiveTimes[clientKey] = Date.now(); // FCK 받은 시간 기록
                    res.status(200).send('Toggle state updated to OFF and sent to client');
                    updateValveState('OFF', phonenum);
                    setRetryTimer(clientKey, 'OFF', 'HZ');
                } else if (receivedData === 'OCK') {
                    console.log('OCK received from client:', clientKey);
                    commandReceiveTimes[clientKey] = Date.now(); // OCK 받은 시간 기록
                    res.status(200).send('Toggle state updated to ON and sent to client');
                    updateValveState('ON', phonenum);
                    setRetryTimer(clientKey, 'ON', 'AD');
                } else {
                    console.log('Non-CK message received:', receivedData);
                    res.status(200).send('Toggle state sent but no CK received');
                }
            });
        });
    } else {
        console.error('Client socket not found for key:', clientKey);
        res.status(404).send('Client not connected');
    }
});

app.get('/toggle_state', (req, res) => {
    const phonenum = req.query.phonenum;
    res.json({ toggleState: globalToggleStates[phonenum] });
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const phonenum = req.query.phonenum;

    const checkDatabaseAndUpdate = () => {
        connection.query('SELECT waterdata FROM waterm WHERE phonenum = ? ORDER BY created_at DESC LIMIT 1', [phonenum], (err, results) => {
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

function sendPingToClients() {
    Object.keys(clients).forEach(clientKey => {
        const client = clients[clientKey];
        if (client && client.socket) {
            client.socket.write("NSM", 'utf8', (err) => {
                if (err) {
                    console.error('Error sending NSM to client:', err);
                } else {
                    console.log(`NSM sent to client ${clientKey}`);
                }
            });

            // 1분 후에 두 번째 NSM 메시지 전송
            setTimeout(() => {
                if (client && client.socket) {
                    client.socket.write("NSM", 'utf8', (err) => {
                        if (err) {
                            console.error('Error sending second NSM to client:', err);
                        } else {
                            console.log(`Second NSM sent to client ${clientKey}`);
                        }
                    });
                }
            }, secondPingDelay);
        }
    });
}

// 15분마다 연결 확인 메시지 전송
setInterval(sendPingToClients, pingInterval);

// 3분 동안 메시지를 받지 못한 클라이언트 소켓 종료
setInterval(() => {
    const now = Date.now();
    Object.keys(clients).forEach(clientKey => {
        const lastReceived = lastMessageReceivedTimes[clientKey] || 0;
        if (now - lastReceived > timeoutThreshold) {
            console.log(`Client ${clientKey} has not sent any messages for more than 3 minutes. Closing socket.`);
            const client = clients[clientKey];
            if (client && client.socket) {
                client.socket.end();
                delete clients[clientKey];
            }
        }
    });
}, timeoutThreshold / 2); // 10분마다 확인

process.on('uncaughtException', function (err) {
    console.error('Uncaught exception:', err);
    // 복구 시도 또는 안전하게 종료
    connectToDatabase(); // MySQL 연결 복구 시도
    server.close(() => {
        server.listen(TCP_PORT, () => console.log(`Server re-listening on port ${TCP_PORT}...`));
    });
});
