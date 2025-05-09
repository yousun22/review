"use strict";

const logger = require("../../config/logger");
const User = require("../../models/User");
const fs = require("fs");
const path = require("path");

const output = {
    home: (req, res) => {
        logger.info(`GET / 304 "홈 화면으로 이동"`);
        res.render("home/index");
    },

    login: (req, res) => {
        logger.info(`GET /login 304 "로그인 화면으로 이동"`);
        res.render("home/login");
    },

    register: (req, res) => {
        logger.info(`GET /register 304 "회원가입 화면으로 이동"`);
        res.render("home/register");
    },

    userif: (req, res) => {
        logger.info(`GET /userif 304 "데이터 화면으로 이동"`);
        res.render("home/userif");
    },

    userifse: (req, res) => {
        logger.info(`GET /userifse 304 "데이터 화면으로 이동"`);
        res.render("home/userifse");
    },

    grains: (req, res) => {
        logger.info(`GET /5grains 304 "5grains 화면으로 이동"`);

        // ✅ 항상 최신 JSON을 읽음
        const jsonPath = path.resolve(__dirname, "../../config/5grains.json");
        let devices = [];

        try {
            const rawData = fs.readFileSync(jsonPath, "utf-8");
            devices = JSON.parse(rawData);
            console.log("📦 현재 불러온 devices 목록:", devices.map(d => d.hashNum));
        } catch (err) {
            console.error("❌ 5grains.json 파일을 읽는 중 오류 발생:", err);
        }

        res.render("home/5grains", { devices });
    },

    sfkorea: (req, res) => {
        logger.info(`GET /sfkorea 304 "sfkorea 화면으로 이동"`);

        // ✅ 항상 최신 JSON을 읽음
        const jsonPath = path.resolve(__dirname, "../../config/sfkorea.json");
        let devices = [];

        try {
            const rawData = fs.readFileSync(jsonPath, "utf-8");
            devices = JSON.parse(rawData);
            console.log("📦 현재 불러온 devices 목록:", devices.map(d => d.hashNum));
        } catch (err) {
            console.error("❌ sfkorea.json 파일을 읽는 중 오류 발생:", err);
        }

        res.render("home/sfkorea", { devices });
    },
};

const process = {
    login: async (req, res) => {
        const user = new User(req.body);
        const response = await user.login();
        const url = {
            method: "POST",
            path: "/login",
            status: response.err ? 400 : 200,
        };
        log(response, url);
        return res.status(url.status).json(response);
    },

    register: async (req, res) => {
        const user = new User(req.body);
        const response = await user.register();
        const url = {
            method: "POST",
            path: "/register",
            status: response.err ? 409 : 201,
        };
        log(response, url);
        return res.status(url.status).json(response);
    },
};

module.exports = {
    output,
    process,
};

const log = (response, url) => {
    if (response.err) {
        logger.error(
            `${url.method} ${url.path} ${url.status} Response:  ${response.success}, ${response.err}`
        );
    } else {
        logger.info(
            `${url.method} ${url.path} ${url.status} Response: ${response.success}, ${response.msg || ""}`
        );
    }
};
