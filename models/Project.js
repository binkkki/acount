// models/Project.js
const { pool } = require('../config/database');

class Project {
    // Создать новый проект
    static async create(projectData) {
        const { user_id, title, description, budget, deadline, brief = {} } = projectData;
        if (!title || title.trim().length === 0) {
            throw new Error('Название проекта обязательно');
        }
        const result = await pool.query(
            `INSERT INTO projects (user_id, title, description, budget, deadline, brief)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [user_id, title.trim(), description?.trim(), budget, deadline, brief]
        );
        await Project.ensureDefaultApprovals(result.rows[0].id);
        return result.rows[0];
    }

    // Получить все проекты пользователя
    static async findByUserId(userId) {
        const result = await pool.query(
            `SELECT p.*,
                    COUNT(DISTINCT m.id)::int AS messages_count,
                    COUNT(DISTINCT m.id) FILTER (WHERE m.is_read = false AND m.sender_id != $1)::int AS unread_messages,
                    COALESCE(STRING_AGG(DISTINCT m.message_text, ' '), '') AS messages_text,
                    COALESCE(
                        json_agg(
                            DISTINCT jsonb_build_object(
                                'id', pf.id,
                                'file_name', pf.file_name,
                                'file_type', pf.file_type,
                                'file_size', pf.file_size,
                                'uploaded_at', pf.uploaded_at,
                                'uploaded_by', pf.uploaded_by
                            )
                        ) FILTER (WHERE pf.id IS NOT NULL),
                        '[]'
                    ) AS files
             FROM projects p
             LEFT JOIN messages m ON m.project_id = p.id
             LEFT JOIN project_files pf ON pf.project_id = p.id
             WHERE p.user_id = $1
             GROUP BY p.id
             ORDER BY p.created_at DESC`,
            [userId]
        );
        return result.rows;
    }

    // Получить проект по ID
    static async findById(id, userId) {
        const projectId = parseInt(id, 10);
        if (isNaN(projectId)) throw new Error('Неверный ID проекта');

        const result = await pool.query(
            `SELECT p.*
             FROM projects p
             WHERE p.id = $1 AND p.user_id = $2`,
            [projectId, userId]
        );
        return result.rows[0];
    }

    static async findByIdForRole(id, user) {
        const projectId = parseInt(id, 10);
        if (isNaN(projectId)) throw new Error('Неверный ID проекта');

        const params = user.role === 'admin' ? [projectId] : [projectId, user.id];
        const ownerCondition = user.role === 'admin' ? '' : 'AND p.user_id = $2';
        const result = await pool.query(
            `SELECT p.*, u.first_name, u.last_name, u.email AS user_email
             FROM projects p
             JOIN users u ON p.user_id = u.id
             WHERE p.id = $1 ${ownerCondition}`,
            params
        );
        return result.rows[0];
    }

    // Обновить проект
    static async update(id, userId, projectData) {
        const { title, description, budget, deadline } = projectData;
        const result = await pool.query(
            `UPDATE projects
             SET title=$1, description=$2, budget=$3, deadline=$4, updated_at=CURRENT_TIMESTAMP
             WHERE id=$5 AND user_id=$6
             RETURNING *`,
            [title, description, budget, deadline, id, userId]
        );
        return result.rows[0];
    }

    // Удалить проект
    static async delete(id, userId) {
        await pool.query(
            'DELETE FROM projects WHERE id=$1 AND user_id=$2',
            [id, userId]
        );
    }

    // Получить все проекты (для админа)
    static async findAll() {
        const query = `
            SELECT p.*,
                   u.first_name,
                   u.last_name,
                   u.email AS user_email,
                   CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                   COUNT(DISTINCT m.id)::int AS messages_count,
                   COUNT(DISTINCT m.id) FILTER (WHERE m.is_read = false AND m.sender_id != u.id)::int AS unread_messages,
                   COUNT(DISTINCT pf.id)::int AS files_count,
                   COALESCE(STRING_AGG(DISTINCT m.message_text, ' '), '') AS messages_text,
                   admin.first_name AS assigned_admin_first_name,
                   admin.last_name AS assigned_admin_last_name,
                   COALESCE(
                       json_agg(
                           DISTINCT jsonb_build_object(
                               'id', pf.id,
                               'file_name', pf.file_name,
                               'file_type', pf.file_type,
                               'file_size', pf.file_size,
                               'uploaded_at', pf.uploaded_at,
                               'uploaded_by', pf.uploaded_by
                           )
                       ) FILTER (WHERE pf.id IS NOT NULL),
                       '[]'
                   ) AS files
            FROM projects p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN users admin ON p.assigned_admin_id = admin.id
            LEFT JOIN messages m ON m.project_id = p.id
            LEFT JOIN project_files pf ON pf.project_id = p.id
            GROUP BY p.id, u.id, admin.id
            ORDER BY p.created_at DESC
        `;
        const { rows } = await pool.query(query);
        return rows;
    }

    static async updateStatus(id, status) {
        const allowedStatuses = ['new', 'in_progress', 'completed', 'rejected'];
        if (!allowedStatuses.includes(status)) {
            throw new Error('Недопустимый статус проекта');
        }

        const result = await pool.query(
            `UPDATE projects
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING *`,
            [status, id]
        );
        return result.rows[0];
    }

    static async assignAdmin(projectId, adminId) {
        const result = await pool.query(
            `UPDATE projects
             SET assigned_admin_id = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING *`,
            [adminId || null, projectId]
        );
        return result.rows[0];
    }

    static async ensureDefaultApprovals(projectId) {
        const stages = [
            ['brief', 'Бриф'],
            ['design', 'Дизайн'],
            ['development', 'Разработка'],
            ['launch', 'Запуск']
        ];

        await Promise.all(stages.map(([stageKey, stageTitle]) => pool.query(
            `INSERT INTO project_approvals (project_id, stage_key, stage_title)
             VALUES ($1, $2, $3)
             ON CONFLICT (project_id, stage_key) DO NOTHING`,
            [projectId, stageKey, stageTitle]
        )));
    }

    static async getApprovals(projectId) {
        await Project.ensureDefaultApprovals(projectId);
        const result = await pool.query(
            `SELECT *
             FROM project_approvals
             WHERE project_id = $1
             ORDER BY id ASC`,
            [projectId]
        );
        return result.rows;
    }

    static async updateApproval(projectId, stageKey, status, comment, userId) {
        const allowedStatuses = ['pending', 'approved', 'changes'];
        if (!allowedStatuses.includes(status)) throw new Error('Недопустимый статус согласования');

        await Project.ensureDefaultApprovals(projectId);
        const result = await pool.query(
            `UPDATE project_approvals
             SET status = $1, comment = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
             WHERE project_id = $4 AND stage_key = $5
             RETURNING *`,
            [status, comment || null, userId, projectId, stageKey]
        );
        return result.rows[0];
    }

    static async getActivity(projectId) {
        const result = await pool.query(
            `SELECT 'created' AS type, 'Проект создан' AS title, p.title AS body, p.created_at AS created_at
             FROM projects p
             WHERE p.id = $1
             UNION ALL
             SELECT 'message', 'Сообщение', LEFT(m.message_text, 120), m.created_at
             FROM messages m
             WHERE m.project_id = $1
             UNION ALL
             SELECT 'file', 'Файл загружен', pf.file_name, pf.uploaded_at
             FROM project_files pf
             WHERE pf.project_id = $1
             UNION ALL
             SELECT 'approval', 'Согласование обновлено', pa.stage_title || ': ' || pa.status, pa.updated_at
             FROM project_approvals pa
             WHERE pa.project_id = $1
             UNION ALL
             SELECT 'notification', n.title, COALESCE(n.body, ''), n.created_at
             FROM notifications n
             WHERE n.project_id = $1
             ORDER BY created_at DESC
             LIMIT 80`,
            [projectId]
        );
        return result.rows;
    }

    static async getFiles(projectId) {
        const result = await pool.query(
            `SELECT id, file_name, file_type, file_size, uploaded_at, uploaded_by
             FROM project_files
             WHERE project_id = $1
             ORDER BY uploaded_at DESC`,
            [projectId]
        );
        return result.rows;
    }
}

module.exports = Project;
