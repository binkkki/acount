const { pool } = require('../config/database');

class Notification {
    static async create({ user_id, project_id = null, actor_id = null, type = 'info', title, body = '', text = '' }) {
        const user = await pool.query(
            `SELECT email, notify_email, notify_messages, notify_status, notify_notes FROM users WHERE id = $1`,
            [user_id]
        );

        const settings = user.rows[0];
        if (!settings) return null;
        if (type === 'message' && !settings.notify_messages) return null;
        if (type === 'status' && !settings.notify_status) return null;
        if (type === 'note' && !settings.notify_notes) return null;

        const content = body || text || '';
        const result = await pool.query(
            `INSERT INTO notifications (user_id, project_id, actor_id, type, title, body)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [user_id, project_id, actor_id, type, title, content]
        );

        if (settings.notify_email) {
            console.log(`[email notification] ${settings.email}: ${title} ${content}`);
        }

        return result.rows[0];
    }

    static async findByUserId(userId) {
        const result = await pool.query(
            `SELECT n.*, p.title AS project_title
             FROM notifications n
             LEFT JOIN projects p ON p.id = n.project_id
             WHERE n.user_id = $1
             ORDER BY n.created_at DESC
             LIMIT 50`,
            [userId]
        );
        return result.rows;
    }

    static async unreadCount(userId) {
        const result = await pool.query(
            `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
            [userId]
        );
        return result.rows[0].count;
    }

    static async markAsRead(id, userId) {
        const result = await pool.query(
            `UPDATE notifications
             SET is_read = true
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId]
        );
        return result.rows[0];
    }

    static async markAllAsRead(userId) {
        await pool.query(
            `UPDATE notifications SET is_read = true WHERE user_id = $1`,
            [userId]
        );
    }
}

module.exports = Notification;
