const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'Токен доступа отсутствует' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'Пользователь не найден' });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Неверный токен' });
    }
};

const adminAuth = async (req, res, next) => {
    return auth(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора' });
        }
        next();
    });
};

module.exports = { auth, adminAuth };
