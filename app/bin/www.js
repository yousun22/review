"use strict"

const app = require("../app")
const logger = require("../src/config/logger")
const mysql = require('mysql'); // Import the MySQL library

const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>{
    logger.info(`${PORT} 포트에서 서버가 가동되었습니다.`);
});



// TODOAPP //

const net = require('net');
//const app2 = netnpm
//const DHT11=require("./models/DHT11");
//const mongoose=require("mongoose");
//require('dotenv/config');
//require("dotenv").config({ path : ".env"});
//const express = require("express");
//const app = express();
//const http = require("http");
//const { stringify } = require('querystring');
//let dataaa = new Object();
//Allobj=JSON.stringify(dataaa);
//const fs = require('fs');
//const path = require('path');
//const filePath = path.join(__dirname, 'models', 'onoff.json');

const connection = mysql.createConnection({
    host: "lecture-review1.cc2disn1eqgs.ap-northeast-2.rds.amazonaws.com",
    user: "yousun22", // Replace with your MySQL username
    password: "qw21as0500*",
    database: "lecture_review1"
});

// Connect to the MySQL database
connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL database: ' + err.stack);
        return;
    }
    console.log('Connected to MySQL database as id ' + connection.threadId);
});


const clients = {};
// Thing으로 부터 데이터를 받는 서버 생성
var server = net.createServer(function(socket){
	console.log(socket.address().address + " connected.");
	
    const clientKey = `${socket.remoteAddress}:${socket.remotePort}`;
    
    // // 클라이언트 객체에 소켓 저장
    clients[clientKey] = socket;
    const clientSocket = clients[clientKey];

   
    app.post('/update_toggle_state', (req, res) => {
        // 클라이언트로부터 전송받은 토글 상태를 콘솔에 출력
        console.log(req.body); // 요청 본문 로깅
        const toggleState = req.body.toggleState;
    
        const toggleStateString = toggleState ? "oo" : "ff";
        
        console.log(clientSocket)
        if (clientSocket) {
            // 토글 상태를 클라이언트 소켓으로 전송합니다.
            clientSocket.write(toggleStateString.toString(), 'utf8', (err) => {
                if (err) {
                    console.error('Error sending data to client:', err);
                    res.status(500).send('Error sending data to client');
                } else {
                    console.log('Toggle state sent to client successfully');
                    res.status(200).send('Toggle state sent to client');
                }
            });
        } else {
            console.error('Client socket not found for key:', clientKey);
            res.status(404).send('Client not connected');
        }
    });


	// client로 부터 오는 data를 화면에 출력
	socket.on('data', function(data){
        var rcvdata=data.toString('utf-8');
        var cutrcv=rcvdata.split("!");
		
        var cat = '{"User1": "ys"}';
		var obj=JSON.parse(cat);
		obj.data=cutrcv[0];
		obj.dvn=cutrcv[1];
		var date = new Date();
        var year=date.getFullYear();
        var month=date.getMonth();
        var today=date.getDate();
        var hours=date.getHours();
        var minutes =date.getMinutes();true
        var seconds =date.getSeconds();
        obj.created_at= new Date(Date.UTC(year, month, today, hours, minutes, seconds));
		var obj2=JSON.stringify(obj);
		//var obj3=JSON.parse(obj2);
        //var obj=JSON.parse(cat)
		//cat.replace(/\n/g, "");

    //    console.log('client1', socket)
    //    console.log('client2', clientSocket)




		const EventEmitter = require('events');
		const eventEmitter = new EventEmitter();

		connection.query('INSERT INTO waterm (waterdata, created_at) VALUES (?, ?)', [obj.data, obj.created_at], (err, results) => {
			if (err) {
				console.error('Error inserting data into MySQL: ' + err);
			} else {
				console.log('Data inserted into MySQL');
				connection.query('SELECT waterdata FROM waterm ORDER BY created_at DESC LIMIT 1', (err, results) => {
					if (err) {
						console.error('Error retrieving data from MySQL: ' + err);
					} else {
						if (results.length > 0) {
							const latestData = results[0].waterdata;
							console.log('Latest data from the database:', latestData);
							eventEmitter.emit('dataUpdated', latestData);
						} else {
							console.log('No data found in the database.');
						}
					}
				});
				
			}
		});

        console.log(obj.User, obj.dvn, obj.data, obj.created_at);
 
		// dht11.save(function(err){
		// 	if(err){
		// 		console.error(err);
		// 		//res.json({result: 0});
		// 		return;
		// 	}
		// 	    console.log("insert OK");
		// 	    //res.json({result: 1});
		// });
        // //process.stdout.write(cat);
	});
    

	// client와 접속이 끊기는 메시지 출력
	socket.on('close', function(){
		console.log('client disconnted.');
	});
});


app.get('/', (req, res) => {
    // MySQL에서 데이터 가져오기
    db.query('SELECT * FROM waterm', (err, results) => {
        if (err) {
            console.error('MySQL에서 데이터 가져오기 오류: ' + err);
            res.status(500).send('데이터 가져오기 실패');
            return;
        }
        // JSON 형식으로 결과를 클라이언트에 응답
        res.json(results);
    });
});

// app.get('/test', (req, res) => {
// 	connection.query('SELECT waterdata FROM waterm ORDER BY created_at DESC LIMIT 1', (err, results) => {
// 	  if (err) {
// 		console.error('Error retrieving data from MySQL: ' + err);
// 		return res.status(500).send('Error retrieving data from MySQL');
// 	  }
  
// 	  if (results.length > 0) {
// 		const latestData = results[0].waterdata;
// 		const html = `<html>
// 		  <head>
// 			<title>데이터 표시 예제</title>
// 		  </head>
// 		  <body>
// 			<h1>최신 데이터:</h1>
// 			<p>${latestData}</p>
// 		  </body>
// 		</html>`;
  
// 		res.send(html);
// 	  } else {
// 		res.send('No data found in the database.');
// 	  }
// 	});
//   });

 //데이터 업데이트 시 이벤트 발생
 server.listen(8080, (err)=>{
    if(err){
         return console.log(err);
    }else{
        console.log('listening on 8080..');
    }
});

// 클라이언터 측에서 새로고침 하면 되는 구문
// app.get('/latest', (req, res) => {
//     connection.query('SELECT waterdata FROM waterm ORDER BY created_at DESC LIMIT 1', (err, results) => {
//         if (err) {
//             console.error('Error retrieving data from MySQL: ' + err);
//             return res.status(500).send('Error retrieving data from MySQL');
//         }
//         if (results.length > 0) {
//             // 원본 데이터를 숫자로 변환합니다.
//             let originalData = Number(results[0].waterdata);
//             // 데이터를 100으로 나누고 소수점 둘째 자리에서 반올림합니다.
//             let processedData = (originalData / 100).toFixed(1);
//             // 변환된 데이터를 JSON 형식으로 응답합니다.
//             res.json({ latestData: processedData });
//         } else {
//             res.status(404).send('No data found in the database.');
//         }
//     });
// });

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // 클라이언트에게 보낼 데이터를 정기적으로 확인합니다.
    const checkDatabaseAndUpdate = () => {
        connection.query('SELECT waterdata FROM waterm ORDER BY created_at DESC LIMIT 1', (err, results) => {
            if (err) {
                console.error('Error retrieving data from MySQL: ' + err);
                return;
            }
            if (results.length > 0) {
                // 원본 데이터를 숫자로 변환합니다.
                let originalData = Number(results[0].waterdata);
                // 데이터를 100으로 나누고 소수점 첫째 자리까지 반올림합니다.
                let processedData = (originalData / 100).toFixed(1);
                // 변환된 데이터를 문자열로 변환하여 클라이언트에 보냅니다.
                res.write(`data: ${JSON.stringify(processedData)}\n\n`);
            }
        });
    };

    // 데이터베이스를 5초마다 확인합니다.
    const intervalId = setInterval(checkDatabaseAndUpdate, 5000);

    // 클라이언트가 연결을 끊으면 인터벌을 정리합니다.
    req.on('close', () => {
        clearInterval(intervalId);
    });
});

// 토글 스위치 상태 업데이트를 위한 경로
// app.post('/update_toggle_state', (req, res) => {
//     // 클라이언트로부터 전송받은 토글 상태를 콘솔에 출력
//     console.log('Toggle state:', req.body.toggleState);
//     const clientKey = `${socket.remoteAddress}:${socket.remotePort}`;
    
//     // 클라이언트 객체에 소켓 저장
//     clients[clientKey] = socket;
//     const clientSocket = clients[clientKey];

//     console.log(clientSocket);

//     // 여기서 데이터베이스 업데이트나 기타 로직을 수행할 수 있습니다.

//     // 성공적으로 요청을 처리했음을 클라이언트에 응답
//     res.status(200).send('Toggle state updated');
// });

