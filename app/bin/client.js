//  만약에 여러장비가 tcp 소켓을 통해 메시지를 보내고 있다면 특정 장비를 골라서 메시지를 어떻게 보내는가


const net = require('net');

// 연결된 모든 클라이언트를 저장하는 객체
const clients = {};

var server = net.createServer(function(socket) {
    // 클라이언트를 식별하기 위한 고유한 키 생성 (예: IP 주소와 포트)
    const clientKey = `${socket.remoteAddress}:${socket.remotePort}`;
    
    // 클라이언트 객체에 소켓 저장
    clients[clientKey] = socket;

    console.log(`${clientKey} connected.`);

    // 클라이언트로부터 오는 데이터를 화면에 출력
    socket.on('data', function(data) {
        // ... 데이터 수신 및 처리 코드 ...
    });

    // 클라이언트와 접속이 끊기면
    socket.on('close', function() {
        console.log(`${clientKey} disconnected.`);
        // 클라이언트 목록에서 해당 소켓 제거
        delete clients[clientKey];
    });
});

// 특정 클라이언트에 메시지를 보내는 함수
function sendMessageToClient(clientKey, message) {
    const client = clients[clientKey];
    if (client) {
        client.write(message);
        console.log(`Message sent to ${clientKey}: ${message}`);
    } else {
        console.log(`Client ${clientKey} not found.`);
    }
}

// 서버가 특정 포트에서 리스닝을 시작
server.listen(8080, () => {
    console.log('Server listening on port 8080');
});

// 예시: "192.168.1.5:34567" 클라이언트에 메시지 보내기
// sendMessageToClient('192.168.1.5:34567', 'Hello, 장비!');

// 서버는 이제 특정 장비에 메시지를 보낼 수 있습니다.
// 클라이언트와의 상호작용을 기반으로 이 함수를 적절한 위치에서 호출하면 됩니다.