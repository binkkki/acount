const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth'); // берем только функцию auth
const Project = require('../models/Project');
const Notification = require('../models/Notification');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Настройка multer для загрузки файлов
const upload = multer({ dest: 'uploads/' });

function removeUploadedFile(filePath) {
    if (!filePath) return;
    const absolutePath = path.resolve(filePath);
    const uploadsRoot = path.resolve('uploads');
    if (!absolutePath.startsWith(uploadsRoot)) return;
    fs.unlink(absolutePath, err => {
        if (err && err.code !== 'ENOENT') console.error('Ошибка удаления файла с диска:', err);
    });
}

// Получить список файлов проекта
router.get('/:projectId', auth, async (req, res) => {
    const projectId = req.params.projectId;
    try {
        const project = await Project.findByIdForRole(projectId, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const result = await pool.query(
            `SELECT pf.id, pf.file_name, pf.file_path, pf.file_type, pf.file_size, pf.uploaded_at, pf.uploaded_by,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id', fc.id,
                                'comment_text', fc.comment_text,
                                'created_at', fc.created_at,
                                'user_name', TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))
                            )
                        ) FILTER (WHERE fc.id IS NOT NULL),
                        '[]'
                    ) AS comments
             FROM project_files pf
             LEFT JOIN file_comments fc ON fc.file_id = pf.id
             LEFT JOIN users u ON u.id = fc.user_id
             WHERE pf.project_id = $1
             GROUP BY pf.id
             ORDER BY pf.uploaded_at DESC`,
            [projectId]
        );
        res.json({ files: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения файлов' });
    }
});

// Загрузить файл
router.post('/:projectId', auth, upload.single('file'), async (req, res) => {
    const projectId = req.params.projectId;
    const uploadedBy = req.user.id;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'Файл не выбран' });

    const filePath = path.join('uploads', file.filename);

    try {
        const project = await Project.findByIdForRole(projectId, req.user);
        if (!project) {
            removeUploadedFile(filePath);
            return res.status(404).json({ error: 'Проект не найден' });
        }

        const result = await pool.query(
            `INSERT INTO project_files (project_id, uploaded_by, file_name, file_path, file_type, file_size)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [projectId, uploadedBy, file.originalname, filePath, file.mimetype, file.size]
        );

        if (req.user.role === 'admin') {
            await Notification.create({
                user_id: project.user_id,
                project_id: project.id,
                actor_id: req.user.id,
                type: 'file',
                title: `Новый файл по проекту "${project.title}"`,
                body: `Администратор загрузил файл: ${file.originalname}`
            });
        } else {
            const admins = await pool.query(
                `SELECT id FROM users WHERE role = 'admin' AND id != $1`,
                [req.user.id]
            );

            await Promise.all(admins.rows.map(admin => Notification.create({
                user_id: admin.id,
                project_id: project.id,
                actor_id: req.user.id,
                type: 'file',
                title: `Клиент загрузил файл по проекту "${project.title}"`,
                body: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim()
                    ? `${req.user.first_name || ''} ${req.user.last_name || ''} загрузил файл: ${file.originalname}`
                    : `Загружен файл: ${file.originalname}`
            })));
        }

        res.json({ file: result.rows[0] });
    } catch (err) {
        removeUploadedFile(filePath);
        console.error(err);
        res.status(500).json({ error: 'Ошибка загрузки файла' });
    }
});

router.post('/:fileId/comments', auth, async (req, res) => {
    const { comment } = req.body;
    if (!comment || !comment.trim()) {
        return res.status(400).json({ error: 'Комментарий не может быть пустым' });
    }

    try {
        const fileResult = await pool.query(
            `SELECT pf.id, pf.project_id, pf.file_name
             FROM project_files pf
             WHERE pf.id = $1`,
            [req.params.fileId]
        );
        if (!fileResult.rows.length) return res.status(404).json({ error: 'Файл не найден' });

        const file = fileResult.rows[0];
        const project = await Project.findByIdForRole(file.project_id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const result = await pool.query(
            `INSERT INTO file_comments (file_id, user_id, comment_text)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [file.id, req.user.id, comment.trim()]
        );

        const notifyUserId = req.user.role === 'admin' ? project.user_id : project.assigned_admin_id;
        if (notifyUserId && Number(notifyUserId) !== Number(req.user.id)) {
            await Notification.create({
                user_id: notifyUserId,
                project_id: project.id,
                actor_id: req.user.id,
                type: 'file',
                title: `Комментарий к файлу "${file.file_name}"`,
                body: comment.trim()
            });
        }

        res.status(201).json({ comment: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка добавления комментария' });
    }
});

// Скачать файл
router.get('/download/:fileId', auth, async (req, res) => {
    const fileId = req.params.fileId;
    try {
        const result = await pool.query(
            `SELECT pf.file_path, pf.file_name, pf.project_id
             FROM project_files pf
             WHERE pf.id = $1`,
            [fileId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });
        const file = result.rows[0];
        const project = await Project.findByIdForRole(file.project_id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });
        res.download(file.file_path, file.file_name);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка скачивания файла' });
    }
});

// Удалить файл проекта
router.delete('/:fileId', auth, async (req, res) => {
    const fileId = req.params.fileId;
    try {
        const result = await pool.query(
            `SELECT id, file_path, project_id
             FROM project_files
             WHERE id = $1`,
            [fileId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Файл не найден' });

        const file = result.rows[0];
        const project = await Project.findByIdForRole(file.project_id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        await pool.query('DELETE FROM project_files WHERE id = $1', [fileId]);
        removeUploadedFile(file.file_path);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка удаления файла' });
    }
});

module.exports = router;
