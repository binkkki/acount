const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
    // Создание пользователя
    static async create(userData) {
        const { email, password, firstName, lastName, role = 'user', phone = null, company = null, acceptedTerms = false } = userData;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO users (email, password, first_name, last_name, role, phone, company, accepted_terms, accepted_terms_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END)
             RETURNING id, email, first_name, last_name, role, phone, company, notify_email, notify_messages, notify_status, notify_notes`,
            [email, hashedPassword, firstName, lastName, role, phone, company, acceptedTerms]
        );
        return result.rows[0];
    }

    // Поиск пользователя по email
    static async findByEmail(email) {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        return result.rows[0];
    }

    // Поиск пользователя по ID
    static async findById(id) {
        const result = await pool.query(
            `SELECT id, email, first_name, last_name, role, phone, company,
                    notify_email,
                    notify_messages, notify_status, notify_notes, created_at
             FROM users WHERE id = $1`,
            [id]
        );
        return result.rows[0];
    }

    // Проверка пароля
    static async verifyPassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    static async updatePassword(id, newPassword) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query(
            'UPDATE users SET password = $1 WHERE id = $2',
            [hashedPassword, id]
        );
    }

    // Получение всех пользователей
    static async getAll() {
        const result = await pool.query(
            `SELECT id, email, first_name, last_name, role, phone, company,
                    notify_email,
                    notify_messages, notify_status, notify_notes, created_at
             FROM users ORDER BY created_at DESC`
        );
        return result.rows;
    }

    // Обновление пользователя
    static async update(id, userData) {
        const {
            first_name,
            last_name,
            email,
            phone = null,
            company = null,
            notify_email = false,
            notify_messages = true,
            notify_status = true,
            notify_notes = true
        } = userData;
        const result = await pool.query(
            `UPDATE users
             SET first_name = $1,
                 last_name = $2,
                 email = $3,
                 phone = $4,
                 company = $5,
                 notify_email = $6,
                 notify_messages = $7,
                 notify_status = $8,
                 notify_notes = $9
             WHERE id = $10
             RETURNING id, email, first_name, last_name, role, phone, company, notify_email, notify_messages, notify_status, notify_notes`,
            [first_name, last_name, email, phone, company, notify_email, notify_messages, notify_status, notify_notes, id]
        );
        return result.rows[0];
    }

    // Удаление пользователя
    static async delete(id) {
        await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [id]);
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
}

module.exports = User;
