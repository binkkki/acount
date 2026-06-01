const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { EmailVerification, VerificationError } = require('../models/EmailVerification');
const { sendVerificationCode } = require('../utilities/emailService');

const router = express.Router();

function toClientUser(user) {
    return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        phone: user.phone,
        company: user.company,
        notifyMessages: user.notify_messages,
        notifyStatus: user.notify_status,
        notifyNotes: user.notify_notes
    };
}

router.post('/register', async (req, res) => {
    try {
        const { password, firstName, lastName, phone, company, acceptedTerms, verificationCode } = req.body;
        const email = req.body.email?.trim().toLowerCase();

        const validationError = validateRegistrationInput({ email, password, firstName, lastName, acceptedTerms });
        if (validationError) return res.status(400).json({ error: validationError });

        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        await EmailVerification.verify({
            email,
            purpose: 'register',
            code: verificationCode
        });

        const user = await User.create({ email, password, firstName, lastName, phone, company, acceptedTerms });
        await notifyAdminsAboutNewUser(user);

        const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.status(201).json({ message: 'Пользователь успешно зарегистрирован', user: toClientUser(user), token });
    } catch (error) {
        if (error instanceof VerificationError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Ошибка при регистрации' });
    }
});

router.post('/register/send-code', async (req, res) => {
    try {
        const { password, firstName, lastName, acceptedTerms } = req.body;
        const email = req.body.email?.trim().toLowerCase();

        const validationError = validateRegistrationInput({ email, password, firstName, lastName, acceptedTerms });
        if (validationError) return res.status(400).json({ error: validationError });

        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const verification = await EmailVerification.create({ email, purpose: 'register' });
        const delivery = await sendVerificationCode({
            to: email,
            code: verification.code,
            purpose: 'register',
            ttlMinutes: verification.ttlMinutes
        });

        res.json({
            message: delivery.sent
                ? 'Код подтверждения отправлен на email'
                : 'Код создан. SMTP не настроен, код выведен в лог сервера',
            emailSent: delivery.sent,
            ttlMinutes: verification.ttlMinutes
        });
    } catch (error) {
        console.error('Registration code error:', error);
        res.status(500).json({ error: 'Не удалось отправить код подтверждения' });
    }
});

async function notifyAdminsAboutNewUser(user) {
    try {
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
        const details = [
            `Пользователь: ${fullName}`,
            `Email: ${user.email}`,
            user.phone ? `Телефон: ${user.phone}` : null,
            user.company ? `Компания: ${user.company}` : null
        ].filter(Boolean).join('\n');

        await Notification.createForAdmins({
            actor_id: user.id,
            type: 'admin_new_user',
            title: 'Зарегистрирован новый пользователь',
            body: details
        });
    } catch (error) {
        console.error('Admin new user notification error:', error);
    }
}

function validateRegistrationInput({ email, password, firstName, lastName, acceptedTerms }) {
    if (!email || !password || !firstName || !lastName) {
        return 'Все обязательные поля должны быть заполнены';
    }

    if (!isValidEmail(email)) {
        return 'Введите корректный email';
    }

    if (String(password).length < 6) {
        return 'Пароль должен содержать минимум 6 символов';
    }

    if (acceptedTerms !== true) {
        return 'Необходимо принять условия пользовательского договора';
    }

    return '';
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || '').trim());
}

router.post('/login', async (req, res) => {
    try {
        const { password } = req.body;
        const email = req.body.email?.trim().toLowerCase();

        if (!email || !password) {
            return res.status(400).json({ error: 'Email и пароль обязательны' });
        }

        const user = await User.findByEmail(email);
        if (!user) {
            return res.status(400).json({ error: 'Неверный email или пароль' });
        }

        const isPasswordValid = await User.verifyPassword(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ error: 'Неверный email или пароль' });
        }

        const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Вход выполнен успешно', user: toClientUser(user), token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Ошибка при входе' });
    }
});

router.get('/verify', async (req, res) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ valid: false, error: 'Токен отсутствует' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ valid: false, error: 'Пользователь не найден' });
        }

        res.json({ valid: true, user: toClientUser(user) });
    } catch (error) {
        res.status(401).json({ valid: false, error: 'Неверный токен' });
    }
});

module.exports = router;
