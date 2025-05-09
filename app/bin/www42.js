"use strict";
console.log('Current working directory:', process.cwd());
let globalToggleStates = {}; // 각 전화번호별 상태를 관리하는 객체
require('dotenv').config(); // .env 파일에서 환경 변수를 로드
const app = require("../app");
const logger = require("../src/config/logger");
const mysql = require('mysql');
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TCP_PORT = 61; // EC2일때 8080

let retryTimeout = 35000; // 35초 후 재시도
const pingInterval = 1 * 60 * 1000; // 1분
const secondPingDelay = 0.5 * 60 * 1000; // 30초
const timeoutThreshold = 5 * 60 * 1000; // 5분

const reconnectMessages = {}; // 재연결 메시지를 저장할 객체

// 홈 디렉터리 설정 및 존재 여부 확인
const homeDir = process.env.HOME || process.env.USERPROFILE || path.resolve(__dirname, '../../');
const appDir = path.join(homeDir, 'lecture-review1/app');

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
                    mode = 'A'; // 기본값 설정
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




function startServer() {
    const server = net.createServer(function(socket) {
        const clientKey = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`${clientKey} connected.`);

        // 기존 소켓이 존재하면 종료
        if (clients[clientKey]) {
            console.log(`Existing connection found for ${clientKey}. Closing it.`);
            clients[clientKey].socket.end();
            delete clients[clientKey];
        }

        clients[clientKey] = { socket, hashNum: null, timer: null };

        socket.setKeepAlive(true, 60000);
        socket.setTimeout(50000);

        // 여기에서 최대 리스너 수를 늘립니다.
        socket.setMaxListeners(20);

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
            console.error(`💡 해결 방법: 기존 서버 프로세스를 종료하거나 포트를 변경하세요.`);
            process.exit(1); // 무한 재시작 방지를 위해 강제 종료
        } else {
            console.log('Server error:', err.message);
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
                console.log(`Client ${clientKey} has not sent any messages for more than 5 minutes. Closing socket.`);
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
            client.socket.write("NSNSNSNSNS", 'utf8', (err) => {
                if (err) {
                    console.error('Error sending NSM to client:', err);
                } else {
                    console.log(`NSM sent to client ${clientKey}`);
                }
            });

            // 30초 후에 두 번째 NSM 메시지 전송
            setTimeout(() => {
                if (client && client.socket) {
                    client.socket.write("NSNSNSNSNS", 'utf8', (err) => {
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

app.post('/update_toggle_state', (req, res) => {
    const newToggleState = req.body.toggleState ? 'ON' : 'OFF';
    const hashNum = req.body.hashNum; // 요청에서 전화번호를 가져옵니다.
    const clientKey = Object.keys(clients).find(key => clients[key].hashNum === hashNum);
    const toggleStateString = newToggleState === 'ON' ? "ADADADADAD" : "HZHZHZHZHZ";

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

    if (receivedData.startsWith("ID:")) {
        const extractedhashNum = receivedData.split("ID:")[1].trim();
        clients[clientKey].hashNum = extractedhashNum;
        console.log(`hashNum registered: ${extractedhashNum} for ${clientKey}`);
        return; // 이후 처리 생략 (수위 데이터가 아님)
    }

    // OCK 또는 FCK 메시지를 수신하면 타이머를 취소하고 밸브 상태를 업데이트
    if (receivedData === 'OCK' || receivedData === 'FCK') {
        console.log(`${receivedData} received from client.`);
        if (clients[clientKey] && clients[clientKey].timer) {
            clearTimeout(clients[clientKey].timer);
            clients[clientKey].timer = null;
            console.log('Timer cancelled, valid response received within timeout.');
        }
        commandReceiveTimes[clientKey] = Date.now();
        updateValveState(receivedData === 'OCK' ? 'ON' : 'OFF', clients[clientKey].hashNum);
        return;
    }

    // OND 또는 FND 메시지를 수신하면 타이머를 취소하고 재시도 로직을 처리
    if (receivedData === 'OND' || receivedData === 'FND') {
        console.log(`${receivedData} received from client.`);
        clearRetryTimer(clientKey);
        const timeElapsed = Date.now() - commandReceiveTimes[clientKey];
        console.log(`Timeout cleared: ${clientKey} received ${receivedData} after ${timeElapsed}ms.`);

        if (timeElapsed <= 29000) {
            console.log(`Resending command to client ${clientKey} as response time was ${timeElapsed}ms.`);
            const toggleStateString = globalToggleStates[clients[clientKey].hashNum] === 'ON' ? 'ADADADADAD' : 'HZHZHZHZHZ';
            
            setTimeout(() => {
                resendToggleCommand(clients[clientKey], toggleStateString, clientKey, clients[clientKey].hashNum);
            }, 1000);
        }
        return;
    }

    // TO 메시지를 수신하면 TKTKTKTKTK 메시지를 보냄
    if (receivedData.includes("TO")) {
        console.log(`Received TO message from client ${clientKey}, responding with TKTKTKTKTK.`);
        const client = clients[clientKey];
        if (client && client.socket) {
            client.socket.write("TKTKTKTKTK", 'utf8', (err) => {
                if (err) {
                    console.error('Error sending TKTKTKTKTK to client:', err);
                } else {
                    console.log('TKTKTKTKTK sent to client successfully');
                }
            });
        }
    }

    // 데이터 유효성 검사
    if (!receivedData || receivedData.trim() === "") {
        console.error('Received invalid or empty data:', receivedData);
        return;
    }

    // 수신된 데이터를 파싱
    const dataParts = receivedData.split('!');
    const waterdata = dataParts[0];
    const hashNum = dataParts.length > 1 ? dataParts[1] : null;
    if (!hashNum || hashNum.length < 8) {
        console.error(`Invalid hashNum: ${hashNum}`);
        return;
    }


    console.log(`Parsed waterdata: ${waterdata}, hashNum: ${hashNum}`);

    function isValidHashNum(hashNum) {
        return /^[0-9A-Fa-f]{8}$/.test(hashNum); // 정확히 8자리 HEX인지 검사
    }
    if (!isValidHashNum(hashNum)) {
        console.error(`Invalid hashNum: ${hashNum}`);
        return;
    }

    if (hashNum && clients[clientKey]) {
        clients[clientKey].hashNum = hashNum;

        // globalSettings에서 최신 water_level_setting과 mode 가져오기
        const settings = globalSettings[hashNum] || { waterLevel: 10, mode: 'M' };

        if (!settings.waterLevel || !settings.mode) {
            console.log(`No saved settings for hashNum: ${hashNum}. Using default settings.`);
        } else {
            console.log(`Applying saved settings for hashNum: ${hashNum}:`, settings);
        }

        const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // 수신된 waterdata와 함께 가장 최근의 water_level_setting과 mode를 저장
        console.log(`Inserting data: waterdata=${waterdata}, hashNum=${hashNum}, createdAt=${createdAt}`);
        pool.query(
            'INSERT INTO waterm (waterdata, created_at, hashNum, valve_of, water_level_setting, mode) VALUES (?, ?, ?, ?, ?, ?)',
            [waterdata, createdAt, hashNum, globalToggleStates[hashNum], settings.waterLevel, settings.mode],
            (err, results) => {
                if (err) {
                    console.error('Error inserting data into MySQL:', err);
                } else {
                    console.log('Data successfully inserted into MySQL database');
                    
                    // 수위 데이터를 수신한 후 WKWKWKWK 메시지 전송
                    clients[clientKey].socket.write("WKWKWKWK", 'utf8', (err) => {
                        if (err) {
                            console.error('Error sending WKWKWKWK to client:', err);
                        } else {
                            console.log('WKWKWKWK sent to client successfully');
                        }
                    });

                    // 추가: waterdata와 water_level_setting 비교 후 로그 출력
                    compareWaterLevelAndData(hashNum, waterdata);
                }
            }
        );
    } else {
        console.error('hashNum is null or invalid, or client not found.');
    }
}


function compareWaterLevelAndData(hashNum, waterdata) {
    // 비교 기준 변수 추가
    const water_level_setting_limit1 = 250;

    // 가장 최근의 water_level_setting과 mode, valve 상태 가져오기
    pool.query(
        'SELECT water_level_setting, mode, valve_of FROM waterm WHERE hashNum = ? ORDER BY created_at DESC LIMIT 1',
        [hashNum],
        (err, results) => {
            if (err) {
                console.error('Error retrieving water level setting, mode, and valve state:', err);
                return;
            }

            if (results.length > 0) {
                const waterLevelSetting = results[0].water_level_setting * 100; // 수위 설정값에 100배 적용
                // const mode = results[0].mode === 'M' ? 'manual' : results[0].mode === 'A' ? 'auto' : 'scheduler'; 
                const mode = 'manual';
                const actualValveState = results[0].valve_of === 'ON' ? 'OPEN' : 'CLOSED'; // DB에서 실제 밸브 상태 가져옴

                // 수동 모드 또는 스케줄러 모드일 경우 자동 제어를 중지
                // if (mode === 'manual' || mode === 'scheduler') {
                //     console.log(`모드가 ${mode}이므로 자동 제어를 중지합니다.`);
                //     return; // 수동 또는 스케줄러 모드일 때는 아무것도 하지 않음
                // }

                // 나머지는 기존의 자동 제어 로직 유지
                if (waterdata === null || waterdata === 0) {
                    console.log('waterdata가 유효하지 않습니다. 비교를 건너뜁니다.');
                    return;
                }

                console.log(`최근 waterdata: ${waterdata}, water_level_setting: ${waterLevelSetting}, limit1: ${water_level_setting_limit1}, mode: ${mode}, actualValveState: ${actualValveState}`);

                if (waterdata > waterLevelSetting) {
                    if (actualValveState !== 'CLOSED') {
                        console.log('Waterdata가 설정한 수위를 초과했습니다. 닫힘 명령을 보냅니다.');
                        sendCommand(hashNum, "HZHZHZHZHZ");
                    } else {
                        console.log('밸브가 이미 닫혀있습니다. 추가 명령을 보내지 않습니다.');
                    }
                } else if (waterdata <= water_level_setting_limit1) {
                    if (actualValveState !== 'OPEN') {
                        console.log(`Waterdata가 limit1(${water_level_setting_limit1}) 이하입니다. 열림 명령을 보냅니다.`);
                        sendCommand(hashNum, "ADADADADAD");
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


