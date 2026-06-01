const express = require('express');
const { auth, adminAuth } = require('../middleware/auth');
const User = require('../models/User');
const { EmailVerification, VerificationError } = require('../models/EmailVerification');
const { sendVerificationCode } = require('../utilities/emailService');
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

router.post('/profile/send-code', auth, async (req, res) => {
    try {
        const payload = buildProfilePayload(req.body);
        const validationError = validateProfilePayload(payload);
        if (validationError) return res.status(400).json({ error: validationError });

        if (!isProfileDataChanged(req.user, payload)) {
            return res.json({ message: 'Для этих настроек код подтверждения не требуется', requiresCode: false });
        }

        const existingUser = await User.findByEmail(payload.email);
        if (existingUser && Number(existingUser.id) !== Number(req.user.id)) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const verification = await EmailVerification.create({
            email: req.user.email,
            purpose: 'profile_update',
            userId: req.user.id
        });
        const delivery = await sendVerificationCode({
            to: req.user.email,
            code: verification.code,
            purpose: 'profile_update',
            ttlMinutes: verification.ttlMinutes
        });

        res.json({
            message: delivery.sent
                ? 'Код подтверждения отправлен на текущий email'
                : 'Код создан. SMTP не настроен, код выведен в лог сервера',
            emailSent: delivery.sent,
            requiresCode: true,
            ttlMinutes: verification.ttlMinutes
        });
    } catch (error) {
        console.error('Profile verification code error:', error);
        res.status(500).json({ error: 'Не удалось отправить код подтверждения' });
    }
});

// Обновление профиля
router.put('/profile', auth, async (req, res) => {
    try {
        const payload = buildProfilePayload(req.body);
        const validationError = validateProfilePayload(payload);
        if (validationError) return res.status(400).json({ error: validationError });

        if (isProfileDataChanged(req.user, payload)) {
            await EmailVerification.verify({
                email: req.user.email,
                purpose: 'profile_update',
                code: req.body.verificationCode,
                userId: req.user.id
            });
        }

        const updatedUser = await User.update(req.user.id, payload);
        res.json({ message: 'Профиль обновлен', user: updatedUser });
    } catch (error) {
        if (error instanceof VerificationError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
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

function buildProfilePayload(body) {
    return {
        first_name: body.firstName?.trim() || '',
        last_name: body.lastName?.trim() || '',
        email: body.email?.trim().toLowerCase() || '',
        phone: normalizePhone(body.phone),
        company: body.company?.trim() || null,
        notify_email: body.notifyEmail === true,
        notify_messages: body.notifyMessages !== false,
        notify_status: body.notifyStatus !== false,
        notify_notes: body.notifyNotes !== false
    };
}

function validateProfilePayload(payload) {
    if (!payload.first_name || !payload.last_name || !payload.email) {
        return 'Имя, фамилия и email обязательны';
    }

    if (!isValidEmail(payload.email)) {
        return 'Введите корректный email';
    }

    if (payload.phone && !isValidPhone(payload.phone)) {
        return 'Введите телефон в формате +7XXXXXXXXXX';
    }

    return '';
}

function isProfileDataChanged(currentUser, nextData) {
    const current = {
        first_name: currentUser.first_name || '',
        last_name: currentUser.last_name || '',
        email: String(currentUser.email || '').trim().toLowerCase(),
        phone: normalizePhone(currentUser.phone) || null,
        company: currentUser.company || null
    };

    return ['first_name', 'last_name', 'email', 'phone', 'company']
        .some(key => String(current[key] || '') !== String(nextData[key] || ''));
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
