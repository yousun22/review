const net = require('net');
const app2 = net
const DHT11=require("./models/DHT11");
const mongoose=require("mongoose");
//require('dotenv/config');
require("dotenv").config({ path : ".env"});
const express = require("express");
const app = express();
const http = require("http");
const { stringify } = require('querystring');
let dataaa = new Object();
Allobj=JSON.stringify(dataaa);
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'models', 'onoff.json');


// 서버를 생성

var server = net.createServer(function(socket){
	console.log(socket.address().address + " connected.");
	
	// client로 부터 오는 data를 화면에 출력
	socket.on('data', function(data){
        var rcvdata=data.toString('utf-8');
        var cutrcv=rcvdata.split("!");
		
        var cat = '{"User1": "ys"}';
		obj=JSON.parse(cat);
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
		obj2=JSON.stringify(obj);
		//var obj3=JSON.parse(obj2);
        //var obj=JSON.parse(cat)
		//cat.replace(/\n/g, "");
        console.log(obj2);
		const dht11=new DHT11({
			User1 : obj.User1,
			dvn : obj.dvn,
			data : obj.data,
			created_at : obj.created_at
		});

		dht11.save(function(err){
			if(err){
				console.error(err);
				//res.json({result: 0});
				return;
			}
			    console.log("insert OK");
			    //res.json({result: 1});
		  });
        //process.stdout.write(cat);
	});

	// client와 접속이 끊기는 메시지 출력
	socket.on('close', function(){
		console.log('client disconnted.');
	});
	//var working = false;
	var fs = require('fs');
				
	fs.watchFile("./models/onoff.json", {persistent: true}, function(){
		
		const data = JSON.parse(fs.readFileSync("./models/onoff.json", "utf8"));
		
		setTimeout(() => {   
			//console.log(data.valve);
			const sendOnoff = String(data.valve);
			console.log(sendOnoff)
			socket.write(sendOnoff);
		  }, 1500);
			 
	});
});


// 에러가 발생할 경우 화면에 에러메시지 출력
server.on('error', function(err){
	console.log('err'+ err	);
});

// Port 5000으로 접속이 가능하도록 대기
//server.listen(8080, function(){
//	console.log('listening on 8080..');   
//});
//node knws1



//app.set("port", 3000);
//var server=http.createServer(app);
//server.listen(3000, (err)=>{
 //  if(err){
//       return console.log(err);
//   }else{
 //      console.log("linstening on 3000");
//       
 //  }
//   
//});
//app.set("port", "3000");
//var server=http.createServer(app);


app.use(express.static(__dirname));
app.set("port", "3000");
var serverh=http.createServer(app);
var io=require("socket.io")(serverh);
io.on("connection",(socket)=>{
	socket.on("socket_evt_mqtt",(data)=>{
        DHT11.find({dvn: "37441273"}).sort({_id:-1}).limit(1).then(obj2=>{
			socket.emit("socket_evt_mqtt", JSON.stringify(obj2[0]));
		});

		
	});
	socket.on("socket_evt_mqtt",(data)=>{

		DHT11.find({dvn:"37475978"}).sort({_id:-1}).limit(1).then(obj2=>{
			socket.emit("socket_evt_mqtt2", JSON.stringify(obj2[0]));
		});
		
	});

	socket.on("socket_evt_mqtt",(data)=>{

		DHT11.find({dvn:"37441272"}).sort({_id:-1}).limit(1).then(obj2=>{
			socket.emit("socket_evt_mqtt3", JSON.stringify(obj2[0]));
		});
		
	});
	

  //웹에서 보드로 명령어 전송(포트 구분 하여 날려야함)
  socket.on("socket_evt",(dataaa)=>{
      Allobj=JSON.parse(dataaa);  // var 선언하지 않으면 전역변수가 된다함
	  //fs.writeFile("./models/onoff.json", Allobj);
      fs.writeFileSync(filePath, JSON.stringify(Allobj));
	  //socket.write(Allobj.valve);
  });
});

//console.log("socket_evt")

serverh.listen(3000, (err)=>{
    if(err){
        return console.log(err);
    }else{
        console.log("server ready");
		mongoose.connect(process.env.MONGODB_URL,{ useNewUrlParser: true, useUnifiedTopology: true} ,(err)=>{
					  if(err){
						   console.log(err);
					  }else{
						   
						   console.log("Connected to database successfully");
						   
					  }
				   }
			   );
		server.listen(8080, (err)=>{
			if(err){
				 return console.log(err);
			}else{
				console.log('listening on 8080..');
		        
					
				
	            
				

				
			}
		});
        
    }
});