const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

const DEFAULT_TTL_MINUTES = Number(process.env.EMAIL_CODE_TTL_MINUTES || 10);
const MAX_ATTEMPTS = Number(process.env.EMAIL_CODE_MAX_ATTEMPTS || 5);

class VerificationError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

class EmailVerification {
    static generateCode() {
        return crypto.randomInt(100000, 1000000).toString();
    }

    static async create({ email, purpose, userId = null }) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const code = this.generateCode();
        const codeHash = await bcrypt.hash(code, 10);
        const ttlMinutes = Number.isFinite(DEFAULT_TTL_MINUTES) && DEFAULT_TTL_MINUTES > 0
            ? DEFAULT_TTL_MINUTES
            : 10;

        await pool.query(
            `UPDATE email_verifications
             SET consumed_at = CURRENT_TIMESTAMP
             WHERE LOWER(email) = LOWER($1)
               AND purpose = $2
               AND consumed_at IS NULL
               AND (user_id = $3 OR ($3 IS NULL AND user_id IS NULL))`,
            [normalizedEmail, purpose, userId]
        );

        await pool.query(
            `INSERT INTO email_verifications (email, user_id, purpose, code_hash, expires_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 * INTERVAL '1 minute'))`,
            [normalizedEmail, userId, purpose, codeHash, ttlMinutes]
        );

        return { code, ttlMinutes };
    }

    static async verify({ email, purpose, code, userId = null }) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedCode = String(code || '').replace(/\D/g, '');

        if (!normalizedCode) {
            throw new VerificationError('Введите код подтверждения из письма');
        }

        const result = await pool.query(
            `SELECT id, code_hash, attempts
             FROM email_verifications
             WHERE LOWER(email) = LOWER($1)
               AND purpose = $2
               AND consumed_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP
               AND (user_id = $3 OR ($3 IS NULL AND user_id IS NULL))
             ORDER BY created_at DESC
             LIMIT 1`,
            [normalizedEmail, purpose, userId]
        );

        const verification = result.rows[0];
        if (!verification) {
            throw new VerificationError('Код не найден или срок его действия истек');
        }

        if (Number(verification.attempts) >= MAX_ATTEMPTS) {
            throw new VerificationError('Слишком много попыток. Запросите новый код');
        }

        const isValid = await bcrypt.compare(normalizedCode, verification.code_hash);
        if (!isValid) {
            await pool.query(
                'UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1',
                [verification.id]
            );
            throw new VerificationError('Неверный код подтверждения');
        }

        await pool.query(
            'UPDATE email_verifications SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1',
            [verification.id]
        );

        return true;
    }
}

module.exports = { EmailVerification, VerificationError };
