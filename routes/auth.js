const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
        const { email, password, firstName, lastName, phone, company, acceptedTerms } = req.body;

        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'Все обязательные поля должны быть заполнены' });
        }

        if (acceptedTerms !== true) {
            return res.status(400).json({ error: 'Необходимо принять условия пользовательского договора' });
        }

        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const user = await User.create({ email, password, firstName, lastName, phone, company, acceptedTerms });
        const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.status(201).json({ message: 'Пользователь успешно зарегистрирован', user: toClientUser(user), token });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Ошибка при регистрации' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

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
