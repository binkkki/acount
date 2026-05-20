const bcrypt = require('bcryptjs');
const fs = require('fs');

async function resetAdminPassword() {
    const newPassword = '1223456tker.'; // пароль для админа
    const hash = await bcrypt.hash(newPassword, 10);
    console.log('Скопируй этот хэш в базу:', hash);
}

resetAdminPassword();
