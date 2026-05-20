require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/projects');
const messagesRoutes = require('./routes/messages');
const projectFilesRoutes = require('./routes/project_files');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
let databaseReady;

function ensureDatabase() {
    if (!databaseReady) {
        databaseReady = initDatabase().catch(error => {
            databaseReady = null;
            throw error;
        });
    }

    return databaseReady;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

app.use('/api', async (req, res, next) => {
    try {
        await ensureDatabase();
        next();
    } catch (error) {
        console.error('Database connection error:', error.message);
        res.status(500).json({
            error: 'Ошибка подключения к базе данных. Проверьте переменные окружения на сервере.'
        });
    }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/project_files', projectFilesRoutes);
app.use('/api/notifications', notificationsRoutes);

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'html/login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicDir, 'html/dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'html/admin.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(publicDir, 'html/register.html'));
});

const startServer = async () => {
    try {
        await ensureDatabase();
        app.listen(PORT, () => {
            console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error.message);
        process.exit(1);
    }
};

if (require.main === module && !process.env.VERCEL) {
    startServer();
}

module.exports = app;
