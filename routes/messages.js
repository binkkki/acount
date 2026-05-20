const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const Project = require('../models/Project');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

router.get('/:projectId', auth, async (req, res) => {
    try {
        const project = await Project.findByIdForRole(req.params.projectId, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const messages = await Message.findByProjectId(req.params.projectId);
        await Message.markProjectMessagesAsRead(req.params.projectId, req.user.id);

        res.json({ messages, project });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения сообщений' });
    }
});

router.post('/:projectId', auth, async (req, res) => {
    const { message_text } = req.body;
    if (!message_text || !message_text.trim()) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    try {
        const project = await Project.findByIdForRole(req.params.projectId, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const result = await pool.query(
            `INSERT INTO messages (project_id, sender_id, message_text)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [project.id, req.user.id, message_text.trim()]
        );

        if (req.user.id !== project.user_id) {
            await Notification.create({
                user_id: project.user_id,
                project_id: project.id,
                actor_id: req.user.id,
                type: 'message',
                title: `Новое сообщение по проекту "${project.title}"`,
                body: message_text.trim()
            });
        }

        res.status(201).json({ message: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка отправки сообщения' });
    }
});

router.put('/read/:messageId', auth, async (req, res) => {
    try {
        await Message.markAsRead(req.params.messageId);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка обновления статуса сообщения' });
    }
});

module.exports = router;
