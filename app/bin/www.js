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



// Thing으로 부터 데이터를 받는 서버 생성
var server = net.createServer(function(socket){
	console.log(socket.address().address + " connected.");
	
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
        var minutes =date.getMinutes();
        var seconds =date.getSeconds();
        obj.created_at= new Date(Date.UTC(year, month, today, hours, minutes, seconds));
		var obj2=JSON.stringify(obj);
		//var obj3=JSON.parse(obj2);
        //var obj=JSON.parse(cat)
		//cat.replace(/\n/g, "");



		connection.query('INSERT INTO waterm(waterdata) VALUES (?)', [obj.data], (err, results) => {

			if (err) {
				console.error('Error inserting data into MySQL: ' + err);
			} else {
				console.log('Data inserted into MySQL');
			}
		});

        console.log(obj.data);


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





server.listen(8080, (err)=>{
    if(err){
         return console.log(err);
    }else{
        console.log('listening on 8080..');
    }
});

///데이터 베이스에 넣어 보자
