// models/Message.js
const { pool } = require('../config/database');

class Message {
    // Создать новое сообщение
    static async create(messageData) {
        const { project_id, sender_id, message_text } = messageData;
        const result = await pool.query(
            `INSERT INTO messages (project_id, sender_id, message_text)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [project_id, sender_id, message_text]
        );
        return result.rows[0];
    }

    // Получить все сообщения проекта
    static async findByProjectId(projectId) {
        const result = await pool.query(
            `SELECT m.*, u.first_name, u.last_name, u.role
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE project_id = $1
             ORDER BY created_at ASC`,
            [projectId]
        );
        return result.rows;
    }

    // Получить непрочитанные сообщения для пользователя (от операторов)
    static async findUnreadByUserId(userId) {
        const result = await pool.query(
            `SELECT m.*, p.title AS project_title
             FROM messages m
             JOIN projects p ON m.project_id = p.id
             WHERE p.user_id = $1 AND m.is_read = false AND m.sender_id != $1
             ORDER BY m.created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    // Отметить сообщение как прочитанное
    static async markAsRead(messageId) {
        await pool.query(
            `UPDATE messages SET is_read = true WHERE id = $1`,
            [messageId]
        );
    }

    static async markProjectMessagesAsRead(projectId, userId) {
        await pool.query(
            `UPDATE messages
             SET is_read = true
             WHERE project_id = $1 AND sender_id != $2`,
            [projectId, userId]
        );
    }
}

module.exports = Message;
