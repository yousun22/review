
"use strict"

// 모듈
const express = require("express");
const bodyParser =require("body-parser");

const dotenv = require("dotenv");
dotenv.config();

const app = express();


const accessLogStream = require("./src/config/log")
//라우팅
const home = require("./src/routes/home");

//앱 세팅
app.set("views", "./src/views");
app.set("view engine", "ejs");

//app.use(express.static(`{$__dirname}/src/public`));
app.use(express.static(`${__dirname}/src/public`));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true}));


app.use("/",home);//use는 미들웨어를 등록해주는 메서드

app.get('/api/getObj2', (req, res) => {
    // "obj2" 데이터가 정의되어 있다고 가정
    res.json(obj2);
});

app.get('/api/getLatestData', (req, res) => {
    // 데이터베이스에서 최신 데이터를 가져옴
    // 예제 데이터로 대체
    const latestData = {
        waterm: '데이터베이스에서 가져온 값',
        created_at: new Date().toLocaleString(), // 현재 시간을 사용하거나 데이터베이스에서 가져온 시간 사용
    };
    res.json(latestData);
});


app.get('/test', (req, res) => {
	connection.query('SELECT waterdata FROM waterm ORDER BY created_at DESC LIMIT 1', (err, results) => {
	  if (err) {
		console.error('Error retrieving data from MySQL: ' + err);
		return res.status(500).send('Error retrieving data from MySQL');
	  }
  
	  if (results.length > 0) {
		const latestData = results[0].waterdata;
		const html = `<html>
		  <head>
			<title>데이터 표시 예제</title>
		  </head>
		  <body>
			<h1>최신 데이터:</h1>
			<p>${latestData}</p>
		  </body>
		</html>`;
  
		res.send(html);
	  } else {
		res.send('No data found in the database.');
	  }
	});
  });


module.exports =app;