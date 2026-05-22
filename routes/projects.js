// routes/projects.js
const express = require('express');
const { auth, adminAuth } = require('../middleware/auth');
const Project = require('../models/Project');
const Notification = require('../models/Notification');
const router = express.Router();


// router.get('/', auth, async (req, res) => {
//     try {
//         // Получаем уведомления пользователя:
//         // 1. Сообщения операторов по проектам пользователя
//         const messages = await Message.findUnreadByUserId(req.user.id);

//         // 2. Изменения статуса проектов
//         const statusChanges = await Project.findStatusChanges(req.user.id);

//         // Формируем общий массив уведомлений
//         const notifications = [
//             ...messages.map(m => ({
//                 type: 'message',
//                 text: `Новое сообщение по проекту "${m.project_title}"`,
//                 timestamp: m.created_at
//             })),
//             ...statusChanges.map(p => ({
//                 type: 'status',
//                 text: `Статус проекта "${p.title}" изменился на ${p.status}`,
//                 timestamp: p.updated_at
//             }))
//         ];

//         res.json({ notifications });
//     } catch(err) {
//         console.error(err);
//         res.status(500).json({ error: 'Ошибка получения уведомлений' });
//     }
// });

// =======================
// Админ: получить все проекты
// =======================
router.get('/all', adminAuth, async (req, res) => {
    try {
        const projects = await Project.findAll();
        res.json({ projects });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения всех проектов' });
    }
});

router.patch('/:id/status', adminAuth, async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Статус обязателен' });
        }

        const project = await Project.findByIdForRole(req.params.id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const updatedProject = await Project.updateStatus(project.id, status);

        await Notification.create({
            user_id: updatedProject.user_id,
            project_id: updatedProject.id,
            actor_id: req.user.id,
            type: 'status',
            title: `Статус проекта "${updatedProject.title}" изменен`,
            body: `Новый статус: ${statusToText(updatedProject.status)}`
        });

        res.json({ message: 'Статус проекта обновлен', project: updatedProject });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message || 'Ошибка обновления статуса' });
    }
});

router.patch('/:id/assign', adminAuth, async (req, res) => {
    try {
        const { adminId } = req.body;
        const project = await Project.findByIdForRole(req.params.id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const updatedProject = await Project.assignAdmin(project.id, adminId || null);
        res.json({ message: 'Ответственный обновлен', project: updatedProject });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка назначения ответственного' });
    }
});

router.get('/:id/details', auth, async (req, res) => {
    try {
        const project = await Project.findByIdForRole(req.params.id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const [approvals, activity, files] = await Promise.all([
            Project.getApprovals(project.id),
            Project.getActivity(project.id),
            Project.getFiles(project.id)
        ]);

        project.files = files;
        res.json({ project, approvals, activity });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка загрузки проекта' });
    }
});

router.patch('/:id/approvals/:stageKey', auth, async (req, res) => {
    try {
        const { status, comment } = req.body;
        const project = await Project.findByIdForRole(req.params.id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const approval = await Project.updateApproval(project.id, req.params.stageKey, status, comment, req.user.id);
        const notifyUserId = req.user.role === 'admin' ? project.user_id : project.assigned_admin_id;
        if (notifyUserId && Number(notifyUserId) !== Number(req.user.id)) {
            await Notification.create({
                user_id: notifyUserId,
                project_id: project.id,
                actor_id: req.user.id,
                type: 'approval',
                title: `Обновлено согласование по проекту "${project.title}"`,
                body: `${approval.stage_title}: ${approvalStatusToText(approval.status)}`
            });
        }

        res.json({ approval });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message || 'Ошибка согласования' });
    }
});

router.post('/:id/notes', adminAuth, async (req, res) => {
    try {
        const { note } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ error: 'Текст заметки обязателен' });
        }

        const project = await Project.findByIdForRole(req.params.id, req.user);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const notification = await Notification.create({
            user_id: project.user_id,
            project_id: project.id,
            actor_id: req.user.id,
            type: 'note',
            title: `Новая заметка администратора по проекту "${project.title}"`,
            body: note.trim()
        });

        res.status(201).json({ message: 'Заметка отправлена клиенту', notification });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка отправки заметки' });
    }
});

// =======================
// Создать проект
// =======================
router.post('/', auth, async (req, res) => {
    try {
        const { title, description, budget, deadline, brief = {} } = req.body;
        if (!title || title.trim().length === 0) {
            return res.status(400).json({ error: 'Название проекта обязательно' });
        }

        const parsedBudget = parseBudget(budget);
        if (budget && parsedBudget === null) {
            return res.status(400).json({ error: 'Укажите бюджет числом, например 12500 или 12 500,50' });
        }

        const project = await Project.create({
            user_id: req.user.id,
            title: title.trim(),
            description: description?.trim(),
            budget: parsedBudget,
            deadline: deadline || null,
            brief
        });
        await notifyAdminsAboutNewProject(project, req.user);

        res.status(201).json({ message: 'Проект успешно создан', project });
    } catch (error) {
        console.error('Ошибка создания проекта:', error);
        res.status(500).json({ error: 'Ошибка создания проекта: ' + error.message });
    }
});

// =======================
// Получить проект по ID
// =======================
router.get('/', auth, async (req, res) => {
    try {
        const projects = await Project.findByUserId(req.user.id);
        res.json({ projects });

    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения проектов и уведомлений' });
    }
});

// =======================
// Обновить проект
// =======================
router.put('/:id', auth, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId)) return res.status(400).json({ error: 'Неверный ID проекта' });

        const project = await Project.update(projectId, req.user.id, req.body);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        res.json({ message: 'Проект обновлен', project });
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Ошибка обновления проекта' });
    }
});

// =======================
// Удалить проект
// =======================
router.delete('/:id', auth, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId)) return res.status(400).json({ error: 'Неверный ID проекта' });

        await Project.delete(projectId, req.user.id);
        res.json({ message: 'Проект удален' });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Ошибка удаления проекта' });
    }
});

function statusToText(status) {
    const map = {
        new: 'Новый',
        in_progress: 'В работе',
        completed: 'Завершен',
        rejected: 'Отклонен'
    };
    return map[status] || status;
}

function approvalStatusToText(status) {
    const map = {
        pending: 'ожидает согласования',
        approved: 'согласовано',
        changes: 'нужны правки'
    };
    return map[status] || status;
}

function parseBudget(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value)
        .trim()
        .replace(/\s/g, '')
        .replace(',', '.')
        .replace(/[^\d.]/g, '');
    if (!normalized) return null;

    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

async function notifyAdminsAboutNewProject(project, user) {
    try {
        const clientName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
        const details = [
            `Клиент: ${clientName}`,
            `Email: ${user.email}`,
            project.description ? `Описание: ${project.description}` : null,
            project.budget ? `Бюджет: ${project.budget}` : null,
            project.deadline ? `Срок: ${new Date(project.deadline).toLocaleDateString('ru-RU')}` : null
        ].filter(Boolean).join('\n');

        await Notification.createForAdmins({
            project_id: project.id,
            actor_id: user.id,
            type: 'admin_new_project',
            title: `Создан новый проект "${project.title}"`,
            body: details,
            excludeUserId: user.role === 'admin' ? user.id : null
        });
    } catch (error) {
        console.error('Admin new project notification error:', error);
    }
}

module.exports = router;
