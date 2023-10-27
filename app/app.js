
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



module.exports =app;