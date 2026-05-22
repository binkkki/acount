class AdminPanel {
    constructor() {
        this.token = localStorage.getItem('token');
        this.projects = [];
        this.users = [];
        this.notifications = [];
        this.projectSearchQuery = '';
        this.projectStatusFilter = 'all';
        this.previousUnreadNotificationsCount = null;
        this.soundEnabled = false;
        this.audioContext = null;
        this.liveUpdateInterval = null;
        this.init();
    }

    async init() {
        if (!this.token) {
            window.location.href = '/';
            return;
        }

        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
        document.getElementById('markAdminNotificationsReadBtn')?.addEventListener('click', () => this.markAllNotificationsRead());
        document.querySelectorAll('[data-close-user-modal]').forEach(element => {
            element.addEventListener('click', () => this.closeUserModal());
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.closeUserModal();
        });
        this.initNotificationSound();
        this.initThemeToggle();
        this.initFilters();
        await this.loadProfile();
        await Promise.all([this.loadUsers(), this.loadProjects(), this.loadNotifications()]);
        this.startLiveUpdates();
    }

    async request(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `Bearer ${this.token}`
            }
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
            this.logout();
            return {};
        }
        if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
        return data;
    }

    async loadProfile() {
        const data = await this.request('/api/users/profile');
        if (data.user?.role !== 'admin') {
            window.location.href = '/dashboard';
            return;
        }
        document.getElementById('userName').textContent = `${data.user.first_name || ''} ${data.user.last_name || ''}`.trim();
    }

    async loadUsers() {
        try {
            const data = await this.request('/api/users');
            this.users = data.users || [];
            const body = document.getElementById('usersTableBody');
            body.innerHTML = this.users.map(user => `
                <tr class="admin-user-row" data-user-id="${user.id}" tabindex="0">
                    <td>${user.id}</td>
                    <td>${this.escapeHtml(`${user.first_name || ''} ${user.last_name || ''}`.trim())}</td>
                    <td>${this.escapeHtml(user.email)}</td>
                    <td>${this.escapeHtml(user.phone || '-')}</td>
                    <td>${user.role === 'admin' ? 'Администратор' : 'Пользователь'}</td>
                    <td>${new Date(user.created_at).toLocaleDateString('ru-RU')}</td>
                </tr>
            `).join('');
            body.querySelectorAll('[data-user-id]').forEach(row => {
                row.addEventListener('click', () => this.openUserModal(row.dataset.userId));
                row.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        this.openUserModal(row.dataset.userId);
                    }
                });
            });
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async loadProjects() {
        try {
            const data = await this.request('/api/projects/all');
            this.projects = data.projects || [];
            this.renderProjects();
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async loadNotifications() {
        try {
            const data = await this.request('/api/notifications');
            this.handleUnreadNotificationsChange(data.unreadCount || 0);
            this.notifications = data.notifications || [];
            this.renderNotifications();
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    renderNotifications() {
        const list = document.getElementById('adminNotificationsList');
        if (!list) return;

        list.innerHTML = this.notifications.length ? this.notifications.map(notification => `
            <li class="notification-item ${notification.is_read ? '' : 'notification-unread'}" data-notification-id="${notification.id}" data-project-id="${notification.project_id || ''}">
                <div class="admin-notification-head">
                    ${this.renderNotificationBadge(notification.type)}
                    <strong>${this.escapeHtml(notification.title)}</strong>
                </div>
                ${notification.body ? `<p>${this.escapeHtml(notification.body)}</p>` : ''}
                <time>${new Date(notification.created_at).toLocaleString('ru-RU')}</time>
            </li>
        `).join('') : '<li class="empty-state">Новых уведомлений нет</li>';

        list.querySelectorAll('[data-notification-id]').forEach(item => {
            item.addEventListener('click', async () => {
                await this.markNotificationAsRead(item.dataset.notificationId);
                if (item.dataset.projectId) this.highlightProject(item.dataset.projectId);
                await this.loadNotifications();
            });
        });
    }

    renderProjects() {
        const grid = document.getElementById('adminProjectsGrid');
        if (!grid) return;

        const visibleProjects = this.getFilteredProjects();

        grid.innerHTML = visibleProjects.length ? visibleProjects.map(project => `
            <article class="project-card" data-project-id="${project.id}">
                <div class="project-card-top">
                    <h3>${this.escapeHtml(project.title)}</h3>
                    <span class="project-status status-${project.status}">${this.getStatusText(project.status)}</span>
                </div>
                <p class="project-description">${this.escapeHtml(project.description || 'Описание не указано')}</p>
                <p class="project-owner">
                    Клиент: ${this.escapeHtml(project.first_name || '')} ${this.escapeHtml(project.last_name || '')}<br>
                    ${this.escapeHtml(project.user_email || '')}
                </p>
                ${this.renderProjectFiles(project)}
                <div class="admin-project-controls">
                    <label>
                        Ответственный
                        <select data-assign="${project.id}">
                            <option value="">Не назначен</option>
                            ${this.users.filter(user => user.role === 'admin').map(user => `
                                <option value="${user.id}" ${Number(project.assigned_admin_id) === Number(user.id) ? 'selected' : ''}>
                                    ${this.escapeHtml(`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email)}
                                </option>
                            `).join('')}
                        </select>
                    </label>
                    <label>
                        Статус
                        <select data-status="${project.id}">
                            ${['new', 'in_progress', 'completed', 'rejected'].map(status => `
                                <option value="${status}" ${project.status === status ? 'selected' : ''}>${this.getStatusText(status)}</option>
                            `).join('')}
                        </select>
                    </label>
                    <form data-note="${project.id}">
                        <textarea name="note" rows="3" placeholder="Заметка для клиента"></textarea>
                        <button type="submit" class="btn-small">Отправить заметку</button>
                    </form>
                </div>
            </article>
        `).join('') : '<div class="empty-state">Проекты не найдены</div>';

        grid.querySelectorAll('[data-status]').forEach(select => {
            select.addEventListener('change', event => this.updateStatus(event.target.dataset.status, event.target.value));
        });
        grid.querySelectorAll('[data-assign]').forEach(select => {
            select.addEventListener('change', event => this.assignProject(event.target.dataset.assign, event.target.value));
        });
        grid.querySelectorAll('[data-note]').forEach(form => {
            form.addEventListener('submit', event => this.sendNote(event));
        });
        grid.querySelectorAll('[data-download-file]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                this.downloadFile(button.dataset.downloadFile, button.dataset.fileName || 'file');
            });
        });
    }

    renderProjectFiles(project) {
        const files = Array.isArray(project.files) ? project.files : [];
        if (!files.length) {
            return '<div class="admin-files empty-admin-files">Файлы еще не загружены</div>';
        }

        return `
            <div class="admin-files">
                <div class="admin-files-title">Файлы клиента (${files.length})</div>
                ${files.map(file => `
                    <button type="button" class="admin-file-link" data-download-file="${file.id}" data-file-name="${this.escapeHtml(file.file_name || 'file')}">
                        <span>${this.escapeHtml(file.file_name || 'Файл')}</span>
                        <small>${this.formatDateTime(file.uploaded_at)} · ${this.formatBytes(file.file_size)}</small>
                    </button>
                `).join('')}
            </div>
        `;
    }

    renderNotificationBadge(type) {
        const labels = {
            admin_new_user: 'Новый пользователь',
            admin_new_project: 'Новый проект',
            file: 'Файл',
            message: 'Сообщение',
            status: 'Статус',
            approval: 'Согласование',
            note: 'Заметка'
        };
        const label = labels[type] || 'Уведомление';
        return `<span class="admin-notification-badge type-${this.escapeHtml(type || 'info')}">${this.escapeHtml(label)}</span>`;
    }

    openUserModal(userId) {
        const user = this.users.find(item => Number(item.id) === Number(userId));
        if (!user) return;

        const modal = document.getElementById('adminUserModal');
        const content = document.getElementById('adminUserModalContent');
        if (!modal || !content) return;

        const userProjects = this.projects.filter(project => Number(project.user_id) === Number(user.id));
        const activeProjects = userProjects.filter(project => project.status !== 'completed' && project.status !== 'rejected').length;
        const filesCount = userProjects.reduce((sum, project) => sum + (Number(project.files_count) || (Array.isArray(project.files) ? project.files.length : 0)), 0);
        const messagesCount = userProjects.reduce((sum, project) => sum + (Number(project.messages_count) || 0), 0);
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Без имени';

        content.innerHTML = `
            <div class="admin-user-modal-header">
                <span class="admin-user-avatar">${this.escapeHtml(this.getInitials(user))}</span>
                <div>
                    <h3 id="adminUserModalTitle">${this.escapeHtml(fullName)}</h3>
                    <p>${this.escapeHtml(user.email)}</p>
                </div>
            </div>
            <div class="admin-user-details-grid">
                ${this.renderUserDetail('Роль', user.role === 'admin' ? 'Администратор' : 'Пользователь')}
                ${this.renderUserDetail('Телефон', user.phone || 'Не указан')}
                ${this.renderUserDetail('Компания', user.company || 'Не указана')}
                ${this.renderUserDetail('Дата регистрации', user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : 'Не указана')}
            </div>
            <div class="admin-user-stats">
                ${this.renderUserStat('Проектов', userProjects.length)}
                ${this.renderUserStat('Активных', activeProjects)}
                ${this.renderUserStat('Файлов', filesCount)}
                ${this.renderUserStat('Сообщений', messagesCount)}
            </div>
            <div class="admin-user-projects">
                <h4>Проекты пользователя</h4>
                ${this.renderUserProjects(userProjects)}
            </div>
        `;

        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        content.querySelectorAll('[data-modal-project-id]').forEach(card => {
            card.addEventListener('click', () => {
                this.closeUserModal();
                this.highlightProject(card.dataset.modalProjectId);
            });
        });
    }

    closeUserModal() {
        const modal = document.getElementById('adminUserModal');
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
    }

    renderUserDetail(label, value) {
        return `
            <div class="admin-user-detail">
                <span>${this.escapeHtml(label)}</span>
                <strong>${this.escapeHtml(value)}</strong>
            </div>
        `;
    }

    renderUserStat(label, value) {
        return `
            <div class="admin-user-stat">
                <strong>${Number(value) || 0}</strong>
                <span>${this.escapeHtml(label)}</span>
            </div>
        `;
    }

    renderUserProjects(projects) {
        if (!projects.length) {
            return '<div class="empty-state">У пользователя пока нет проектов</div>';
        }

        return projects.map(project => `
            <article class="admin-user-project" data-modal-project-id="${project.id}">
                <div>
                    <strong>${this.escapeHtml(project.title)}</strong>
                    <span>${this.escapeHtml(project.description || 'Описание не указано')}</span>
                </div>
                <div class="admin-user-project-meta">
                    <span class="project-status status-${this.escapeHtml(project.status)}">${this.getStatusText(project.status)}</span>
                    <small>${project.created_at ? new Date(project.created_at).toLocaleDateString('ru-RU') : ''}</small>
                </div>
            </article>
        `).join('');
    }

    getInitials(user) {
        const first = (user.first_name || '').trim()[0] || '';
        const last = (user.last_name || '').trim()[0] || '';
        return `${first}${last}`.toUpperCase() || 'П';
    }

    initFilters() {
        document.getElementById('adminProjectSearchInput')?.addEventListener('input', event => {
            this.projectSearchQuery = event.target.value.trim().toLowerCase();
            this.renderProjects();
        });
        document.getElementById('adminProjectStatusFilter')?.addEventListener('change', event => {
            this.projectStatusFilter = event.target.value;
            this.renderProjects();
        });
    }

    initThemeToggle() {
        const toggle = document.getElementById('themeToggleCheckbox');
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.classList.toggle('dark-theme', savedTheme === 'dark');
        document.body.classList.toggle('light-theme', savedTheme !== 'dark');
        if (toggle) toggle.checked = savedTheme === 'dark';

        toggle?.addEventListener('change', () => {
            const theme = toggle.checked ? 'dark' : 'light';
            document.body.classList.toggle('dark-theme', theme === 'dark');
            document.body.classList.toggle('light-theme', theme === 'light');
            localStorage.setItem('theme', theme);
        });
    }

    startLiveUpdates() {
        if (this.liveUpdateInterval) clearInterval(this.liveUpdateInterval);
        this.liveUpdateInterval = setInterval(async () => {
            await this.loadNotifications();
            await this.loadProjects();
        }, 5000);
    }

    initNotificationSound() {
        const enableSound = () => {
            this.soundEnabled = true;
            if (!this.audioContext) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) this.audioContext = new AudioContextClass();
            }
            if (this.audioContext?.state === 'suspended') this.audioContext.resume();
        };

        window.addEventListener('pointerdown', enableSound, { once: true });
        window.addEventListener('keydown', enableSound, { once: true });
    }

    handleUnreadNotificationsChange(unreadCount) {
        if (this.previousUnreadNotificationsCount !== null && unreadCount > this.previousUnreadNotificationsCount) {
            this.playNotificationSound();
        }
        this.previousUnreadNotificationsCount = unreadCount;
    }

    playNotificationSound() {
        if (!this.soundEnabled) return;

        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!this.audioContext && AudioContextClass) this.audioContext = new AudioContextClass();
            const context = this.audioContext;
            if (!context) return;
            if (context.state === 'suspended') context.resume();

            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(740, context.currentTime);
            oscillator.frequency.setValueAtTime(920, context.currentTime + 0.08);
            gain.gain.setValueAtTime(0.001, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start();
            oscillator.stop(context.currentTime + 0.24);
        } catch (error) {
            console.warn('Notification sound is unavailable:', error);
        }
    }

    getFilteredProjects() {
        return this.projects.filter(project => {
            const matchesStatus = this.projectStatusFilter === 'all' || project.status === this.projectStatusFilter;
            const filesText = Array.isArray(project.files) ? project.files.map(file => file.file_name).join(' ') : '';
            const haystack = `${project.title || ''} ${project.description || ''} ${project.user_email || ''} ${project.first_name || ''} ${project.last_name || ''} ${project.messages_text || ''} ${filesText}`.toLowerCase();
            const matchesSearch = !this.projectSearchQuery || haystack.includes(this.projectSearchQuery);
            return matchesStatus && matchesSearch;
        });
    }

    async updateStatus(projectId, status) {
        try {
            await this.request(`/api/projects/${projectId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            await this.loadProjects();
            this.showMessage('Статус обновлен', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async assignProject(projectId, adminId) {
        try {
            await this.request(`/api/projects/${projectId}/assign`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminId: adminId || null })
            });
            await this.loadProjects();
            this.showMessage('Ответственный обновлен', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async sendNote(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const note = form.querySelector('textarea').value.trim();
        if (!note) return;

        try {
            await this.request(`/api/projects/${form.dataset.note}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note })
            });
            form.reset();
            this.showMessage('Заметка отправлена', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async markNotificationAsRead(notificationId) {
        try {
            await this.request(`/api/notifications/${notificationId}/read`, { method: 'PATCH' });
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async markAllNotificationsRead() {
        try {
            await this.request('/api/notifications/read-all', { method: 'PATCH' });
            await this.loadNotifications();
            this.showMessage('Уведомления прочитаны', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    highlightProject(projectId) {
        const card = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('project-card-highlight');
        setTimeout(() => card.classList.remove('project-card-highlight'), 2400);
    }

    async downloadFile(fileId, fileName) {
        try {
            const response = await fetch(`/api/project_files/download/${fileId}`, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            if (!response.ok) throw new Error('Не удалось скачать файл');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    getStatusText(status) {
        return {
            new: 'Новый',
            in_progress: 'В работе',
            completed: 'Завершен',
            rejected: 'Отклонен'
        }[status] || status;
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    formatDateTime(value) {
        return value ? new Date(value).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'Дата неизвестна';
    }

    formatBytes(value) {
        const bytes = Number(value || 0);
        if (bytes < 1024) return `${bytes} байт`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
        return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
    }

    logout() {
        localStorage.removeItem('token');
        window.location.href = '/';
    }

    showMessage(text, type) {
        const message = document.getElementById('message');
        if (!message) return;
        message.textContent = text;
        message.className = `message ${type}`;
        message.style.display = 'block';
        setTimeout(() => {
            message.style.display = 'none';
        }, 4000);
    }
}

document.addEventListener('DOMContentLoaded', () => new AdminPanel());
