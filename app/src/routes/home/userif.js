const express = require('express');
const bcrypt = require('bcrypt');
const users = require('../../config/users');
const router = express.Router();

// 로그인 페이지 라우트
router.get('/login1', (req, res) => {
    res.render('home/login1');
});

// 로그인 처리 라우트
router.post('/login1', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = users.find(u => u.username === username);
        if (!user) {
            res.status(401).send('Invalid username or password');
            return;
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            res.status(401).send('Invalid username or password');
            return;
        }
        req.session.userId = user.username;
        res.redirect('/userif');  // 로그인 성공 시 /userif로 리디렉션
    } catch (error) {
        res.status(400).send('Error logging in');
    }
});

// 로그아웃 라우트
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            res.status(400).send('Error logging out');
            return;
        }
        res.redirect('/userif/login1');
    });
});

// 보호된 라우트
router.get('/', (req, res) => {
    res.render('home/userif'); // userif.ejs 파일 렌더링
});

module.exports = router;
