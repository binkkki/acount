require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/admin.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/register.html'));
});

// Добавляем в импорты
const projectRoutes = require('./routes/projects');

// Добавляем после других роутов
app.use('/api/projects', projectRoutes);

// Инициализация базы данных и запуск сервера
const startServer = async () => {
    try {
        await initDatabase(); // Теперь должно работать
        app.listen(PORT, () => {
            console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
};

const messagesRoutes = require('./routes/messages');
const projectFilesRoutes = require('./routes/project_files');
const notificationsRoutes = require('./routes/notifications');

app.use('/api/messages', messagesRoutes);
app.use('/api/project_files', projectFilesRoutes);
app.use('/api/notifications', notificationsRoutes);

const botRoutes = require('./routes/bot');
app.use('/api/bot', botRoutes);

startServer();
