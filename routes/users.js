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
        const updatedUser = await User.update(req.user.id, {
            first_name: firstName,
            last_name: lastName,
            email,
            phone,
            company,
            notify_email: notifyEmail === true,
            notify_messages: notifyMessages !== false,
            notify_status: notifyStatus !== false,
            notify_notes: notifyNotes !== false
        });
        res.json({ message: 'Профиль обновлен', user: updatedUser });
    } catch (error) {
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

module.exports = router;
