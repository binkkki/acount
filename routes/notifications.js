const express = require('express');
const { auth } = require('../middleware/auth');
const Notification = require('../models/Notification');

const router = express.Router();

router.get('/', auth, async (req, res) => {
    try {
        const notifications = await Notification.findByUserId(req.user.id);
        const unreadCount = await Notification.unreadCount(req.user.id);
        res.json({ notifications, unreadCount });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения уведомлений' });
    }
});

router.patch('/:id/read', auth, async (req, res) => {
    try {
        const notification = await Notification.markAsRead(req.params.id, req.user.id);
        if (!notification) return res.status(404).json({ error: 'Уведомление не найдено' });
        res.json({ notification });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка обновления уведомления' });
    }
});

router.patch('/read-all', auth, async (req, res) => {
    try {
        await Notification.markAllAsRead(req.user.id);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка обновления уведомлений' });
    }
});

router.post('/mark-read/:id', auth, async (req, res) => {
    try {
        const notification = await Notification.markAsRead(req.params.id, req.user.id);
        res.json({ success: true, notification });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка отметки уведомления как прочитанного' });
    }
});

router.get('/unread-count', auth, async (req, res) => {
    try {
        const count = await Notification.unreadCount(req.user.id);
        res.json({ count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения количества уведомлений' });
    }
});

module.exports = router;
