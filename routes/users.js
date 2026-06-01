const express = require('express');
const { auth, adminAuth } = require('../middleware/auth');
const User = require('../models/User');
const { pool } = require('../config/database');
const router = express.Router();

// Получение профиля текущего пользователя
router.get('/profile', auth, async (req, res) => {
    try {
        res.json({ user: req.user });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения профиля' });
    }
});

// Обновление профиля
router.put('/profile', auth, async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            company,
            notifyEmail,
            notifyMessages,
            notifyStatus,
            notifyNotes
        } = req.body;
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ error: 'Имя, фамилия и email обязательны' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Введите корректный email' });
        }

        if (phone && !isValidPhone(phone)) {
            return res.status(400).json({ error: 'Введите телефон в формате +7XXXXXXXXXX' });
        }

        const updatedUser = await User.update(req.user.id, {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: email.trim().toLowerCase(),
            phone: normalizePhone(phone),
            company: company?.trim() || null,
            notify_email: notifyEmail === true,
            notify_messages: notifyMessages !== false,
            notify_status: notifyStatus !== false,
            notify_notes: notifyNotes !== false
        });
        res.json({ message: 'Профиль обновлен', user: updatedUser });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }
        res.status(500).json({ error: 'Ошибка обновления профиля' });
    }
});

router.put('/password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ error: 'Заполните все поля для смены пароля' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Новый пароль должен содержать минимум 6 символов' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'Новый пароль и подтверждение не совпадают' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'Новый пароль должен отличаться от текущего' });
        }

        const user = await User.findByEmail(req.user.email);
        const isPasswordValid = user && await User.verifyPassword(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ error: 'Текущий пароль указан неверно' });
        }

        await User.updatePassword(req.user.id, newPassword);
        res.json({ message: 'Пароль успешно изменен' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка смены пароля' });
    }
});

router.get('/payments', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, amount, status, payment_method, transaction_number, paid_at
             FROM payments
             WHERE user_id = $1
             ORDER BY paid_at DESC`,
            [req.user.id]
        );
        res.json({ payments: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка загрузки истории платежей' });
    }
});

router.delete('/account', auth, async (req, res) => {
    try {
        const { currentPassword, confirmation } = req.body;

        if (confirmation !== 'УДАЛИТЬ') {
            return res.status(400).json({ error: 'Введите слово УДАЛИТЬ для подтверждения' });
        }

        if (!currentPassword) {
            return res.status(400).json({ error: 'Введите текущий пароль' });
        }

        const user = await User.findByEmail(req.user.email);
        const isPasswordValid = user && await User.verifyPassword(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ error: 'Текущий пароль указан неверно' });
        }

        await User.delete(req.user.id);
        res.json({ message: 'Аккаунт и связанные данные удалены' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления аккаунта' });
    }
});

// Получение всех пользователей (только для админов)
router.get('/', adminAuth, async (req, res) => {
    try {
        const users = await User.getAll();
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения пользователей' });
    }
});

// Удаление пользователя (только для админов)
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        await User.delete(req.params.id);
        res.json({ message: 'Пользователь удален' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления пользователя' });
    }
});

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || '').trim());
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    const normalized = digits[0] === '8' ? `7${digits.slice(1)}` : digits;
    return normalized.length === 11 && normalized[0] === '7' ? `+${normalized}` : value;
}

function isValidPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const normalized = digits[0] === '8' ? `7${digits.slice(1)}` : digits;
    return normalized.length === 11 && normalized[0] === '7';
}

module.exports = router;
