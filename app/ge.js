const bcrypt = require('bcrypt');

const password = '100'; // 여기에서 원하시는 비밀번호를 입력하세요

bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Hashed password:', hash); // 해시된 비밀번호 출력
    }
});
