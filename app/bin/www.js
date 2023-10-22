"use strict"

const app = require("../app")

const POST = process.env.PORT || 3000;

app.listen(POST, () =>{
    console.log("Server working");
});