"use strict";
console.log('Current working directory:', process.cwd());
let globalToggleStates = {}; // 각 전화번호별 상태를 관리하는 객체
require('dotenv').config(); // .env 파일에서 환경 변수를 로드
const app = require("../app");
//const logger = require("../src/config/logger");
const mysql = require('mysql');
const net = require('net');
const fs = require('fs');
const path = require('path');
const socketLogDir = path.join(__dirname, '../logs');
const socketLogFile = path.join(socketLogDir, 'socket_err.log');

const PORT = process.env.PORT || 3000;
const TCP_PORT = 8080; // EC2일때 8080, 로컬일때 61

let retryTimeout = 35000; // 35초 후 재시도
const pingInterval = 2 * 60 * 1000; // 1분
const secondPingDelay = 0.5 * 60 * 1000; // 30초
const timeoutThreshold = 3 * 60 * 1000; // 2분

const reconnectMessages = {}; // 재연결 메시지를 저장할 객체

// 홈 디렉터리 설정 및 존재 여부 확인
const homeDir = process.env.HOME || process.env.USERPROFILE || path.resolve(__dirname, '../../');
const appDir = path.join(homeDir, 'lecture-review1/app');

if (!fs.existsSync(socketLogDir)) {
    fs.mkdirSync(socketLogDir, { recursive: true });
}

if (fs.existsSync(appDir)) {
    process.chdir(appDir);
} else {
    console.warn(`Directory does not exist: ${appDir}`);
    process.chdir(path.resolve(__dirname, '../../app'));
}

// MySQL 연결 풀 생성
const pool = mysql.createPool({
    connectionLimit: 10, // 풀 내 최대 연결 수 설정
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PSWORD,
    database: process.env.DB_DATABASE,
    multipleStatements: true
});

// 초기 밸브 상태 가져오기
function fetchLatestToggleStates() {
    pool.query('SELECT hashNum, valve_of, water_level_setting, mode FROM (SELECT hashNum, valve_of, water_level_setting, mode, ROW_NUMBER() OVER (PARTITION BY hashNum ORDER BY created_at DESC) as rnum FROM waterm) temp WHERE rnum = 1', 
    (err, results) => {
        if (err) {
            console.error('Error retrieving toggle states from MySQL:', err);
        } else if (results.length > 0) {
            results.forEach(result => {
                const hashNum = result.hashNum;
                const valveState = result.valve_of;
                const waterLevel = result.water_level_setting; // water_level 값도 불러오기
                let mode = result.mode; // 저장된 모드 값 불러오기

                console.log(`Retrieved valve_of for hashNum ${hashNum} from database:`, valveState);
                console.log(`Retrieved water_level for hashNum ${hashNum} from database:`, waterLevel);
                console.log(`Retrieved mode for hashNum ${hashNum} from database:`, mode);

                // valveState가 'ON' 또는 'OFF'일 경우에만 저장
                if (valveState === 'ON' || valveState === 'OFF') {
                    globalToggleStates[hashNum] = valveState;
                }

                // mode가 null이면 기본값 'S'(scheduler) 설정
                
                if (!mode) {
                    mode = 'M'; // 기본값을 manual로 설정
                }

                // globalSettings에 waterLevel과 mode를 함께 저장
                globalSettings[hashNum] = { waterLevel, mode };

                console.log(`Global settings for hashNum ${hashNum}:`, globalSettings[hashNum]);
            });
            console.log('Initial global toggle states set to:', globalToggleStates);
        } else {
            console.log('No toggle states found in the database.');
        }
    });
}


const clients = {};
const retryTimers = {};
const retryStartTimes = {}; // 시작 시간을 저장할 객체
const commandReceiveTimes = {}; // OCK와 FCK를 받은 시간을 저장할 객체
const lastMessageReceivedTimes = {}; // 마지막으로 메시지를 받은 시간을 저장할 객체

function resendToggleCommand(client, toggleStateString, clientKey, hashNum) {
    if (client && client.socket) {
        client.socket.write(toggleStateString, 'utf8', (err) => {
            if (err) {
                console.error('Error resending data to client:', err);
                logSocketError(`Error sending data to ${clientKey}: ${err.message}`);
                return;
            }

            console.log('Toggle state resent to client successfully');
            client.socket.once('data', (data) => {
                const receivedData = data.toString().trim();
                if (receivedData === 'OCK') {
                    console.log('OCK received from client on resend:', clientKey);
                    commandReceiveTimes[clientKey] = Date.now(); // OCK 받은 시간 기록
                    updateValveState('ON', hashNum);
                    setRetryTimer(clientKey, 'ON', toggleStateString);
                } else if (receivedData === 'FCK') {
                    console.log('FCK received from client on resend:', clientKey);
                    commandReceiveTimes[clientKey] = Date.now(); // FCK 받은 시간 기록
                    updateValveState('OFF', hashNum);
                    setRetryTimer(clientKey, 'OFF', toggleStateString);
                } else {
                    console.log('Non-CK message received on resend:', receivedData);
                    // Do not update the database if OCK or FCK is not received
                }
            });
        });
    } else {
        console.error('Client socket not found for key:', clientKey);
        reconnectMessages[hashNum] = '장치와 연결 재시도중';
        setTimeout(() => {
            reconnectMessages[hashNum] = null;
        }, retryTimeout);
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
        } else {
            const hashNum = clients[clientKey] ? clients[clientKey].hashNum : null;
            if (hashNum) {
                reconnectMessages[hashNum] = '장치와 연결 재시도중';
                setTimeout(() => {
                    reconnectMessages[hashNum] = null;
                }, retryTimeout);
            }
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

function updateValveState(newState, hashNum) {
    pool.query('UPDATE waterm SET valve_of = ? WHERE hashNum = ? AND created_at = (SELECT * FROM (SELECT MAX(created_at) FROM waterm WHERE hashNum = ?) AS temp)', 
    [newState, hashNum, hashNum], (err, result) => {
        if (err) {
            console.error('Error updating valve_of in MySQL:', err);
        } else {
            globalToggleStates[hashNum] = newState;
            console.log(`밸브 상태가 바뀌었습니다: ${newState} for hashNum ${hashNum}`);
        }
    });
}


// 새로운 기능: 수위 및 모드 저장
let globalSettings = {}; // 각 전화번호별 water_level_setting 및 mode를 저장하는 객체

app.post('/save_water_level', (req, res) => {
    const hashNum = req.body.hashNum;
    const waterLevel = req.body.waterLevel;
    const mode = req.body.mode;

    // 클라이언트에서 전달된 모드를 정확하게 처리
    //const modeValue = mode === 'manual' ? 'M' : mode === 'auto' ? 'A' : 'S'; // 정확한 값으로 변환
    const modeValue ='M'
    
    globalSettings[hashNum] = { waterLevel, mode: modeValue };
    console.log(`Settings saved for hashNum: ${hashNum}`, globalSettings[hashNum]);

    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    pool.query(
        'INSERT INTO waterm (hashNum, valve_of, mode, water_level_setting, created_at) VALUES (?, ?, ?, ?, ?)',
        [hashNum, globalToggleStates[hashNum], modeValue, waterLevel, createdAt], 
        (err, result) => {
            if (err) {
                console.error('Error saving water level and mode to MySQL:', err);
                res.status(500).send('Error saving data to database.');
            } else {
                console.log(`Water level and mode saved successfully for hashNum: ${hashNum}`);
                res.status(200).send('Data saved successfully.');
            }
        }
    );
});

app.post('/zero_point', (req, res) => {
    const hashNum = req.body.hashNum;

    if (!hashNum) {
        return res.status(400).send('❌ hashNum 누락');
    }

    // 최근 수위 데이터 조회
    pool.query(
        'SELECT waterdata FROM waterm WHERE hashNum = ? ORDER BY created_at DESC LIMIT 1',
        [hashNum],
        (err, results) => {
            if (err) {
                console.error(`❌ 수위 조회 실패 for ${hashNum}:`, err);
                return res.status(500).send('DB 조회 실패');
            }

            if (results.length === 0) {
                return res.status(404).send('최근 수위 데이터 없음');
            }

            const currentWaterdata = results[0].waterdata;
            const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

            const currentState = globalToggleStates[hashNum] || 'OFF';
            const currentSettings = globalSettings[hashNum] || { mode: 'M', waterLevel: 10 };

            // 새로운 row로 zero_point 업데이트
            pool.query(
                'INSERT INTO waterm (hashNum, waterdata, valve_of, mode, water_level_setting, zero_point, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [hashNum, currentWaterdata, currentState, currentSettings.mode, currentSettings.waterLevel, currentWaterdata, createdAt],
                (err2, result2) => {
                    if (err2) {
                        console.error(`❌ 영점 저장 실패 for ${hashNum}:`, err2);
                        return res.status(500).send('DB 저장 실패');
                    }

                    console.log(`✅ [${hashNum}] 영점 ${currentWaterdata} 저장 완료`);
                    res.status(200).send('영점 저장 성공');
                }
            );
        }
    );
});

function isSuspiciousIP(ip) {
    return ip.startsWith('45.') || ip.startsWith('185.') || ip.startsWith('103.') || ip.startsWith('94.') || ip.startsWith('91.');
}

function startServer() {
    const server = net.createServer(function(socket) {
        const ip = socket.remoteAddress.replace(/^.*:/, '');
        const clientKey = `${ip}:${socket.remotePort}`;

        Object.keys(clients).forEach(oldKey => {
            console.log(`🔁 기존 연결 ${oldKey} 종료 → 새 연결 ${clientKey} 유지`);
            if (clients[oldKey]?.socket) {
                clients[oldKey].socket.end();
            }
            delete clients[oldKey];
        });

        if (isSuspiciousIP(ip)) {
            console.log(`❌ [BLOCKED] 의심 IP 접근 차단: ${ip}`);
            logSocketError(`Blocked suspicious IP: ${ip}`);
            socket.destroy();
            return;
        }

        console.log(`🔌 [NEW] ${clientKey} connected.`);

        // 30초 이내에 hashNum 등록되지 않으면 연결 종료
        // const earlyCloseTimer = setTimeout(() => {
        //     if (!clients[clientKey]?.hashNum) {
        //         console.warn(`⏱ [BLOCK] ${clientKey} hashNum 등록 없이 대기 → 소켓 종료`);
        //         socket.end(); // 연결 종료
        //     }
        // }, 90000);

        // socket.on('close', () => clearTimeout(earlyCloseTimer));
        // socket.on('error', () => clearTimeout(earlyCloseTimer));

        // 기존 연결 종료 처리
        if (clients[clientKey]) {
            console.log(`Existing connection found for ${clientKey}. Closing it.`);
            clients[clientKey].socket.end();
            delete clients[clientKey];
        }

        clients[clientKey] = { socket, hashNum: null, timer: null };

        socket.setKeepAlive(true, 60000);
        socket.setTimeout(3 * 60 * 1000);
        socket.setMaxListeners(20);

        socket.write("NSNSNS", 'utf8', (err) => {
            if (err) {
                console.error('Error sending initial NSNS:', err);
                logSocketError(`Error sending initial NSNS: ${err.message}`);
            } else {
                console.log(`Initial NSNS sent to client ${clientKey}`);
            }
        });

        socket.on('data', function(data) {
            enqueueData({ clientKey, data });
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
            logSocketError(`Socket error on ${clientKey}: ${err.message}`);
            if (clients[clientKey]) {
                clearTimeout(clients[clientKey].timer);
            }
            socket.end();
            delete clients[clientKey];
        });
    });

    server.setMaxListeners(20);

    server.on('error', function(err) {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${TCP_PORT} is already in use. Another server might be running.`);
            logSocketError(err.message);
            console.error(`💡 해결 방법: 기존 서버 프로세스를 종료하거나 포트를 변경하세요.`);
            process.exit(1); // 무한 재시작 방지를 위해 강제 종료
        } else {
            console.log('Server error:', err.message);
            logSocketError(`Server error: ${err.message}`);
            server.close(() => {
                setTimeout(() => {
                    startServer();
                }, 10000);  // 10초 후에 다시 시도
            });
        }
    });

    server.listen(TCP_PORT, () => {
        console.log(`Server listening on port ${TCP_PORT}...`);
    });

    // 1분마다 연결 확인 메시지 전송
    setInterval(sendPingToClients, pingInterval);

    // 5분 동안 메시지를 받지 못한 클라이언트 소켓 종료
    setInterval(() => {
        const now = Date.now();
        Object.keys(clients).forEach(clientKey => {
            const lastReceived = lastMessageReceivedTimes[clientKey] || 0;
            if (now - lastReceived > timeoutThreshold) {
                console.log(`Client ${clientKey} has not sent any messages for more than 2 minutes. Closing socket.`);
                const client = clients[clientKey];
                if (client && client.socket) {
                    client.socket.end();
                    delete clients[clientKey];
                }
            }
        });
    }, timeoutThreshold / 2); // 2.5분마다 확인
}

function sendPingToClients() {
    Object.keys(clients).forEach(clientKey => {
        const client = clients[clientKey];
        if (client && client.socket) {
            client.socket.write("NSNSNS", 'utf8', (err) => {
                if (err) {
                    console.error('Error sending NSM to client:', err);
                    logSocketError(err.message);
                } else {
                    console.log(`NSM sent to client ${clientKey}`);
                }
            });

            // 30초 후에 두 번째 NSM 메시지 전송
            setTimeout(() => {
                if (client && client.socket) {
                    client.socket.write("NSNSNS", 'utf8', (err) => {
                        if (err) {
                            console.error('Error sending second NSM to client:', err);
                            logSocketError(err.message);
                        } else {
                            console.log(`Second NSM sent to client ${clientKey}`);
                        }
                    });
                }
            }, secondPingDelay);
        }
    });
}

app.post('/update_toggle_state', (req, res) => {
    const newToggleState = req.body.toggleState ? 'ON' : 'OFF';
    const hashNum = req.body.hashNum; // 요청에서 전화번호를 가져옵니다.
    const clientKey = Object.keys(clients).find(key => clients[key].hashNum === hashNum);
    const toggleStateString = newToggleState === 'ON' ? "ADADAD" : "HZHZHZ";

    if (!clientKey) {
        return res.status(404).send('Client not connected');
    }

    enqueueCommand({ clientKey, toggleStateString }, (err, state) => {
        if (err) {
            reconnectMessages[hashNum] = '장치와 연결 재시도중';
            setTimeout(() => {
                reconnectMessages[hashNum] = null;
            }, retryTimeout);
            return res.status(500).send('Error sending data to client');
        }
        if (state === 'ON') {
            updateValveState('ON', hashNum);
            res.status(200).send('Toggle state updated to ON and sent to client');
        } else if (state === 'OFF') {
            updateValveState('OFF', hashNum);
            res.status(200).send('Toggle state updated to OFF and sent to client');
        } else {
            res.status(200).send('Toggle state sent but no CK received');
        }
    });
});

app.get('/toggle_state', (req, res) => {
    const hashNum = req.query.hashNum;
    res.json({ toggleState: globalToggleStates[hashNum], reconnectMessage: reconnectMessages[hashNum] });
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const hashNum = req.query.hashNum;

    const checkDatabaseAndUpdate = () => {
        pool.query('SELECT waterdata FROM waterm WHERE hashNum = ? ORDER BY created_at DESC LIMIT 1', [hashNum], (err, results) => {
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

app.get('/get_water_level_and_mode', (req, res) => {
    const hashNum = req.query.hashNum;

    pool.query('SELECT water_level_setting, mode FROM waterm WHERE hashNum = ? ORDER BY created_at DESC LIMIT 1', [hashNum], (err, results) => {
        if (err) {
            console.error('Error retrieving water level and mode:', err);
            return res.status(500).send('Error retrieving data.');
        }

        if (results.length > 0) {
            const waterLevel = results[0].water_level_setting;
            console.log(`Fetched water level: ${waterLevel}`); // 수위 값이 올바르게 나오는지 확인
            const mode = results[0].mode === 'M' ? 'manual' : results[0].mode === 'A' ? 'auto' : 'scheduler';
            res.json({ waterLevel, mode });
        } else {
            res.status(404).send('No data found.');
        }
    });
});

let server; // 반드시 전역에 선언



process.on('uncaughtException', function (err) {
  console.error('Uncaught exception:', err);

  // MySQL 연결 테스트 (선택)
  pool.getConnection((connErr, conn) => {
    if (connErr) return console.error('MySQL connection failed after crash:', connErr);
    conn.query('SELECT 1', (queryErr) => {
      conn.release();
      if (queryErr) console.error('MySQL test query failed:', queryErr);
    });
  });

//   if (server) {
//     server.close(() => {
//       console.log('Server closed after crash. Restarting...');

//       // 새 서버 재시작
//       server = app.listen(TCP_PORT, () => {
//         console.log(`Server re-listening on port ${TCP_PORT}...`);
//       });
//     });
//   }
});


// 명령 및 데이터 큐 추가
const commandQueue = [];
const dataQueue = [];
let isProcessing = false;

function enqueueCommand(command, callback) {
    commandQueue.push({ command, callback });
    processQueue();
}

function enqueueData(data) {
    dataQueue.push(data);
    processQueue();
}

function processQueue() {
    if (isProcessing) return;
    isProcessing = true;

    if (commandQueue.length > 0) {
        const { command, callback } = commandQueue.shift();
        sendCommandToClient(command, callback);
    } else if (dataQueue.length > 0) {
        const { clientKey, data } = dataQueue.shift();
        handleClientData(clientKey, data);
    }

    isProcessing = false;

    if (commandQueue.length > 0 || dataQueue.length > 0) {
        setImmediate(processQueue); // 다음 작업을 즉시 처리하도록 설정
    }
}

function sendCommandToClient(command, callback) {
    const clientKey = command.clientKey;
    const client = clients[clientKey];

    if (client && client.socket) {
        client.socket.write(command.toggleStateString, 'utf8', (err) => {
            if (err) {
                console.error('Error sending data to client:', err);
                logSocketError(`Error sending data to ${clientKey}: ${err.message}`);
                callback(err);
                return;
            }

            console.log('Toggle state sent to client successfully');
            client.socket.once('data', (data) => {
                const receivedData = data.toString().trim();
                if (receivedData === 'OCK' || receivedData === 'FCK') {
                    console.log(`${receivedData} received from client: ${clientKey}`);
                    commandReceiveTimes[clientKey] = Date.now();
                    callback(null, receivedData === 'OCK' ? 'ON' : 'OFF');
                } else {
                    console.log('Non-CK message received:', receivedData);
                    callback(null, 'UNKNOWN');
                }
            });
        });
    } else {
        console.error('Client socket not found for key:', clientKey);
        const hashNum = clients[clientKey] ? clients[clientKey].hashNum : null;
        if (hashNum) {
            reconnectMessages[hashNum] = '장치와 연결 재시도중';
            setTimeout(() => {
                reconnectMessages[hashNum] = null;
            }, retryTimeout);
        }
        callback(new Error('Client not connected'));
    }
}

function handleClientData(clientKey, data) {
    const receivedData = data.toString().trim();
    console.log(`Raw data received from clientKey ${clientKey}: ${data}`);
    console.log('Received data from client:', receivedData);

    lastMessageReceivedTimes[clientKey] = Date.now();

    // 🟡 ID 메시지 등록
    if (receivedData.startsWith("ID:")) {
        const extractedhashNum = receivedData.split("ID:")[1].trim();
        clients[clientKey].hashNum = extractedhashNum;
        console.log(`hashNum registered: ${extractedhashNum} for ${clientKey}`);
        return;
    }

    // ✅ OCK 또는 FCK 메시지 (hashNum 포함된 경우) 처리
    if (receivedData.startsWith('OCK') || receivedData.startsWith('FCK')) {
        const prefix = receivedData.slice(0, 3); // OCK or FCK
        const hashNumFromData = receivedData.slice(3).trim();

        console.log(`${prefix} received from client with hashNum ${hashNumFromData}`);

        if (!hashNumFromData || hashNumFromData.length !== 8) {
            console.error('❌ Invalid hashNum in OCK/FCK message:', hashNumFromData);
            return;
        }

        commandReceiveTimes[clientKey] = Date.now();
        updateValveState(prefix === 'OCK' ? 'ON' : 'OFF', hashNumFromData);
        return;
    }

    // 🟡 OND/FND 메시지 (타이머 제거 및 재전송 처리)
    if (receivedData === 'OND' || receivedData === 'FND') {
        console.log(`${receivedData} received from client.`);
        clearRetryTimer(clientKey);
        const timeElapsed = Date.now() - commandReceiveTimes[clientKey];
        console.log(`Timeout cleared: ${clientKey} received ${receivedData} after ${timeElapsed}ms.`);

        if (timeElapsed <= 29000) {
            console.log(`Resending command to client ${clientKey} as response time was ${timeElapsed}ms.`);
            const toggleStateString = globalToggleStates[clients[clientKey].hashNum] === 'ON' ? 'ADADADA' : 'HZHZHZ';
            setTimeout(() => {
                resendToggleCommand(clients[clientKey], toggleStateString, clientKey, clients[clientKey].hashNum);
            }, 1000);
        }
        return;
    }

    // 🔁 TO → TKTKTKTKTK
    if (receivedData.includes("TO")) {
        console.log(`Received TO message from client ${clientKey}, responding with TKTKTKTKTK.`);
        const client = clients[clientKey];
        if (client && client.socket) {
            client.socket.write("TKTKTK", 'utf8', (err) => {
                if (err) console.error('Error sending TKTKTK to client:', err);
                else console.log('TKTKTK sent to client successfully');
            });
        }
    }

    // 🧪 수위데이터 파싱 (ex: 1270!0000EB7E)
    const dataParts = receivedData.split('!');
    if (dataParts.length !== 2) return;

    const waterdata = dataParts[0];
    const hashNum = dataParts[1];

    // 중복 소켓 확인 및 이전 소켓 제거
    const existingClientKey = Object.keys(clients).find(key =>
        clients[key].hashNum === hashNum && key !== clientKey
    );

    if (existingClientKey) {
        console.log(`🔁 Duplicate hashNum detected via waterdata: ${hashNum}. Closing previous socket ${existingClientKey}`);
        clients[existingClientKey].socket.end();
        delete clients[existingClientKey];
    }

    console.log(`Parsed waterdata: ${waterdata}, hashNum: ${hashNum}`);
    clients[clientKey].hashNum = hashNum;

    const settings = globalSettings[hashNum] || { waterLevel: 10, mode: 'M' };
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

// 최신 zero_point 불러오기
    pool.query(
        'SELECT zero_point FROM waterm WHERE hashNum = ? AND zero_point IS NOT NULL ORDER BY created_at DESC LIMIT 1',
        [hashNum],
        (err, results) => {
            let zeroPoint = results.length > 0 ? results[0].zero_point : 0;

            pool.query(
                'INSERT INTO waterm (waterdata, created_at, hashNum, valve_of, water_level_setting, mode, zero_point) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [waterdata, createdAt, hashNum, globalToggleStates[hashNum], settings.waterLevel, settings.mode, zeroPoint],
                (err, results) => {
                    if (err) {
                        console.error('Error inserting data into MySQL:', err);
                    } else {
                        console.log('Data with zero_point inserted');
                        clients[clientKey].socket.write("WKWKWK", 'utf8');
                        compareWaterLevelAndData(hashNum, waterdata); // 이후 로직
                    }
                }
            );
        }
    );

}


function compareWaterLevelAndData(hashNum, waterdata) {
    const water_level_setting_limit1 = 250;

    pool.query(
        'SELECT water_level_setting, mode, valve_of FROM waterm WHERE hashNum = ? ORDER BY created_at DESC LIMIT 1',
        [hashNum],
        (err, results) => {
            if (err) {
                console.error('Error retrieving water level setting, mode, and valve state:', err);
                return;
            }

            if (results.length > 0) {
                // ✅ 1. mode 먼저 해석
                const mode = results[0].mode === 'M' ? 'manual' : results[0].mode === 'A' ? 'auto' : 'scheduler';

                // ✅ 2. 수동/스케줄러 모드이면 바로 종료
                if (mode !== 'auto') {
                    console.log(`모드가 ${mode}이므로 자동 제어를 중지합니다.`);
                    return;
                }

                // ✅ 3. 설정값 존재 여부 확인
                const waterLevelSettingRaw = results[0].water_level_setting;
                if (waterLevelSettingRaw == null) {
                    //console.log('⚠️ 설정된 수위 값(water_level_setting)이 DB에 없습니다. 비교를 건너뜁니다.');
                    return;
                }

                const waterLevelSetting = waterLevelSettingRaw * 100;
                const actualValveState = results[0].valve_of === 'ON' ? 'OPEN' : 'CLOSED';

                if (waterdata === null || waterdata === 0) {
                    console.log('waterdata가 유효하지 않습니다. 비교를 건너뜁니다.');
                    return;
                }

                console.log(`최근 waterdata: ${waterdata}, water_level_setting: ${waterLevelSetting}, limit1: ${water_level_setting_limit1}, mode: ${mode}, actualValveState: ${actualValveState}`);

                if (waterdata > waterLevelSetting) {
                    if (actualValveState !== 'CLOSED') {
                        console.log('Waterdata가 설정한 수위를 초과했습니다. 닫힘 명령을 보냅니다.');
                        sendCommand(hashNum, "HZHZHZ");
                    } else {
                        console.log('밸브가 이미 닫혀있습니다. 추가 명령을 보내지 않습니다.');
                    }
                } else if (waterdata <= water_level_setting_limit1) {
                    if (actualValveState !== 'OPEN') {
                        console.log(`Waterdata가 limit1(${water_level_setting_limit1}) 이하입니다. 열림 명령을 보냅니다.`);
                        sendCommand(hashNum, "ADADAD");
                    } else {
                        console.log('밸브가 이미 열려있습니다. 추가 명령을 보내지 않습니다.');
                    }
                } else {
                    console.log('Waterdata가 설정한 수위 이하입니다. 명령을 보내지 않습니다.');
                }
            } else {
                console.log('사용자에게 해당하는 데이터가 없습니다.');
            }
        }
    );
}


// 장치에 명령을 한 번 전송하는 함수
// 장치에 명령을 한 번 전송하는 함수
function sendCommand(hashNum, command) {
    const clientKey = Object.keys(clients).find(key => clients[key].hashNum === hashNum);

    if (!clientKey) {
        console.log('Client not connected');
        return;
    }

    enqueueCommand({ clientKey, toggleStateString: command }, (err, state) => {
        if (err) {
            console.error(`Error sending command (${command}) to client:`, err);
        } else {
            console.log(`명령 (${command}) 전송 완료`);
        }
    });
}

function checkPortInUse(port, callback) {
    const tester = require('net').createServer()
        .once('error', err => callback(err.code === 'EADDRINUSE'))
        .once('listening', () => tester.once('close', () => callback(false)).close())
        .listen(port);
}

function startApp() {
    checkPortInUse(TCP_PORT, (inUse) => {
        if (inUse) {
            console.error(`❌ TCP 포트 ${TCP_PORT}가 이미 사용 중입니다. 서버 중지`);
            process.exit(1);
        } else {
            startServer();               // TCP 서버 시작
            fetchLatestToggleStates();   // DB 상태 로딩

            server = app.listen(PORT, () => {
                console.log(`📡 Web server listening on port ${PORT}`);
            });
        }
    });
}

function logSocketError(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFile(socketLogFile, logEntry, (err) => {
        if (err) console.error("❌ Failed to write socket error log:", err);
    });
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);

    checkPortInUse(TCP_PORT, (inUse) => {
        if (inUse) {
            console.error(`⚠️ 포트 ${TCP_PORT} 충돌 감지. 서버 재시작 불가.`);
            process.exit(1);
        } else {
            console.log('서버 재시작 시도...');
            startApp();
        }
    });
});

startApp(); // 최초 실행


