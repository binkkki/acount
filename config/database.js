// config/database.js
const { Pool } = require('pg');
require('dotenv').config();

let poolInstance;

function getDatabaseConfig() {
    if (process.env.DATABASE_URL) {
        return {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
        };
    }

    const requiredVars = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD'];
    const missingVars = requiredVars.filter(name => !process.env[name]);

    if (missingVars.length > 0) {
        throw new Error(
            `Не заданы переменные окружения базы данных: ${missingVars.join(', ')}. ` +
            'Укажите DATABASE_URL или полный набор DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT.'
        );
    }

    return {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };
}

function getPool() {
    if (!poolInstance) {
        poolInstance = new Pool(getDatabaseConfig());
        poolInstance.on('error', error => {
            console.error('❌ Неожиданная ошибка подключения PostgreSQL:', error.message);
        });
    }

    return poolInstance;
}

const pool = {
    query: (...args) => getPool().query(...args),
    connect: (...args) => getPool().connect(...args),
    end: (...args) => (poolInstance ? poolInstance.end(...args) : Promise.resolve())
};

// Функция для инициализации таблиц
const initDatabase = async () => {
    try {
        await pool.query(`
            -- Существующие таблицы
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                role VARCHAR(50) DEFAULT 'user',
                phone VARCHAR(50),
                company VARCHAR(255),
                accepted_terms BOOLEAN DEFAULT FALSE,
                accepted_terms_at TIMESTAMP,
                notify_email BOOLEAN DEFAULT FALSE,
                notify_messages BOOLEAN DEFAULT TRUE,
                notify_status BOOLEAN DEFAULT TRUE,
                notify_notes BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(255);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms BOOLEAN DEFAULT FALSE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMP;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT FALSE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_messages BOOLEAN DEFAULT TRUE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_status BOOLEAN DEFAULT TRUE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_notes BOOLEAN DEFAULT TRUE;
            
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                token VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- НОВАЯ ТАБЛИЦА ПРОЕКТОВ
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                status VARCHAR(50) DEFAULT 'new',
                budget DECIMAL(10, 2),
                deadline DATE,
                brief JSONB DEFAULT '{}'::jsonb,
                assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief JSONB DEFAULT '{}'::jsonb;
            ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                message_text TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS project_files (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                file_name VARCHAR(255) NOT NULL,
                file_path TEXT NOT NULL,
                file_type VARCHAR(255),
                file_size INTEGER,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS file_comments (
                id SERIAL PRIMARY KEY,
                file_id INTEGER REFERENCES project_files(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                comment_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS project_approvals (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                stage_key VARCHAR(80) NOT NULL,
                stage_title VARCHAR(160) NOT NULL,
                status VARCHAR(40) DEFAULT 'pending',
                comment TEXT,
                updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (project_id, stage_key)
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                body TEXT,
                message VARCHAR(500),
                text TEXT,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                amount DECIMAL(12, 2) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                payment_method VARCHAR(100),
                transaction_number VARCHAR(120),
                paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'info' NOT NULL;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'Уведомление' NOT NULL;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message VARCHAR(500);
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS text TEXT;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

            -- Индексы для быстрого поиска
            CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
            CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
            CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
            CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);
            CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
            CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
            CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
            CREATE INDEX IF NOT EXISTS idx_file_comments_file_id ON file_comments(file_id);
            CREATE INDEX IF NOT EXISTS idx_project_approvals_project_id ON project_approvals(project_id);

            -- Тестовый пользователь
            INSERT INTO users (email, password, first_name, last_name, role)
            SELECT 'admin@example.com', '$2a$10$rOzZbZz7kAq1V2W5Xz3J3.7qjKvL8M9N0O1P2Q3R4S5T6U7V8W9X0Y1Z2', 'Admin', 'User', 'admin'
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@example.com');
        `);
        console.log('✅ База данных инициализирована успешно');
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

module.exports = { pool, initDatabase };
