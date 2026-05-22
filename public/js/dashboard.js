class Dashboard {
    constructor() {
        this.token = localStorage.getItem('token');
        this.user = null;
        this.userId = null;
        this.userRole = 'user';
        this.projects = [];
        this.notifications = [];
        this.payments = [];
        this.currentProjectId = null;
        this.projectSearchQuery = '';
        this.globalSearchQuery = '';
        this.projectStatusFilter = 'all';
        this.showArchiveProjects = false;
        this.projectDetails = null;
        this.currentNotificationId = null;
        this.liveUpdateInterval = null;
        this.init();
    }

    async init() {
        if (!this.token) {
            window.location.href = '/';
            return;
        }

        this.initThemeToggle();
        this.initEvents();
        this.initModals();
        this.initBot();

        await this.loadUserData();
        await this.loadProjects();
        await this.loadPayments();
        await this.loadNotifications();
        await this.loadFiles();
        if (this.currentProjectId) await this.loadChat();
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
        if (response.status === 401) this.logout();
        if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
        return data;
    }

    async loadUserData() {
        const data = await this.request('/api/users/profile');
        this.user = data.user;
        this.userId = data.user.id;
        this.userRole = data.user.role || 'user';
        this.displayUserData(data.user);
    }

    displayUserData(user) {
        this.setText('userName', `${user.first_name || ''} ${user.last_name || ''}`.trim());
        this.setText('profileFirstName', user.first_name || '-');
        this.setText('profileLastName', user.last_name || '-');
        this.setText('profileEmail', user.email || '-');
        this.setText('profilePhone', user.phone || '-');
        this.setText('profileCompany', user.company || '-');
        this.setText('profileRole', user.role === 'admin' ? 'Администратор' : 'Пользователь');
        this.setText('profileCreatedAt', user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '-');

        this.setValue('updateFirstName', user.first_name || '');
        this.setValue('updateLastName', user.last_name || '');
        this.setValue('updateEmail', user.email || '');
        this.setValue('updatePhone', user.phone || '');
        this.setValue('updateCompany', user.company || '');
        this.setChecked('notifyEmail', user.notify_email === true);
        this.setChecked('notifyMessages', user.notify_messages !== false);
        this.setChecked('notifyStatus', user.notify_status !== false);
        this.setChecked('notifyNotes', user.notify_notes !== false);

        const adminLink = document.getElementById('adminLink');
        if (adminLink) adminLink.style.display = user.role === 'admin' ? 'block' : 'none';
        const filesNavItem = document.getElementById('filesNavItem');
        if (filesNavItem) filesNavItem.style.display = user.role === 'admin' ? 'none' : 'block';
        document.body.classList.toggle('is-admin', user.role === 'admin');
    }

    async updateProfile(event) {
        event.preventDefault();
        const payload = {
            firstName: document.getElementById('updateFirstName')?.value.trim(),
            lastName: document.getElementById('updateLastName')?.value.trim(),
            email: document.getElementById('updateEmail')?.value.trim(),
            phone: document.getElementById('updatePhone')?.value.trim(),
            company: document.getElementById('updateCompany')?.value.trim(),
            notifyEmail: document.getElementById('notifyEmail')?.checked === true,
            notifyMessages: document.getElementById('notifyMessages')?.checked !== false,
            notifyStatus: document.getElementById('notifyStatus')?.checked !== false,
            notifyNotes: document.getElementById('notifyNotes')?.checked !== false
        };

        try {
            await this.request('/api/users/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            await this.loadUserData();
            this.showMessage('Настройки сохранены', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async loadProjects() {
        const endpoint = this.userRole === 'admin' ? '/api/projects/all' : '/api/projects';
        const data = await this.request(endpoint);
        this.projects = data.projects || [];

        if (!this.currentProjectId || !this.projects.some(project => project.id === this.currentProjectId)) {
            this.currentProjectId = this.projects[0]?.id || null;
        }

        this.renderProjectSelect();
        this.displayProjects();
        this.renderProjectFocus();
        this.updateWidgets();
    }

    displayProjects() {
        const container = document.getElementById('projectsGrid');
        if (!container) return;

        const visibleProjects = this.getFilteredProjects();

        if (this.projects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>Проектов пока нет</h3>
                    <p>Создайте первый проект, чтобы начать работу.</p>
                </div>
            `;
            return;
        }

        if (visibleProjects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>Ничего не найдено</h3>
                    <p>Попробуйте изменить поисковый запрос или статус.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = visibleProjects.map(project => this.renderProjectCard(project)).join('');

        container.querySelectorAll('.project-card').forEach(card => {
            card.addEventListener('click', event => {
                if (event.target.closest('button, select, textarea, form')) return;
                this.currentProjectId = Number(card.dataset.projectId);
                this.renderProjectSelect();
                this.switchSection('projectDetail');
            });
        });

        container.querySelectorAll('[data-admin-status]').forEach(select => {
            select.addEventListener('change', event => this.updateProjectStatus(event.target.dataset.projectId, event.target.value));
        });

        container.querySelectorAll('[data-admin-note-form]').forEach(form => {
            form.addEventListener('submit', event => this.sendAdminNote(event));
        });
    }

    renderProjectCard(project) {
        const owner = this.userRole === 'admin'
            ? `<p class="project-owner">Клиент: ${this.escapeHtml(project.first_name || '')} ${this.escapeHtml(project.last_name || '')}<br>${this.escapeHtml(project.user_email || '')}</p>`
            : '';

        const adminControls = this.userRole === 'admin' ? `
            <div class="admin-project-controls">
                <label>
                    Статус
                    <select data-admin-status data-project-id="${project.id}">
                        ${['new', 'in_progress', 'completed', 'rejected'].map(status => `
                            <option value="${status}" ${project.status === status ? 'selected' : ''}>${this.getStatusText(status)}</option>
                        `).join('')}
                    </select>
                </label>
                <form data-admin-note-form data-project-id="${project.id}">
                    <textarea name="note" rows="3" placeholder="Заметка для клиента"></textarea>
                    <button type="submit" class="btn-small">Отправить заметку</button>
                </form>
            </div>
        ` : '';

        return `
            <article class="project-card ${project.unread_messages > 0 ? 'has-unread' : ''}" data-project-id="${project.id}">
                <div class="project-card-top">
                    <h3>${this.escapeHtml(project.title)}</h3>
                    <span class="project-status status-${project.status}">${this.getStatusText(project.status)}</span>
                </div>
                <p class="project-description">${this.escapeHtml(project.description || 'Описание не указано')}</p>
                ${owner}
                <div class="project-meta">
                    ${project.budget ? `<span>${Number(project.budget).toLocaleString('ru-RU')} ₽</span>` : '<span>Бюджет не указан</span>'}
                    ${project.deadline ? `<span>До ${new Date(project.deadline).toLocaleDateString('ru-RU')}</span>` : ''}
                </div>
                <div class="project-stats">
                    <span>Сообщения: ${project.messages_count || 0}</span>
                    ${project.unread_messages > 0 ? `<span class="unread-badge">${project.unread_messages} новых</span>` : ''}
                </div>
                ${adminControls}
            </article>
        `;
    }

    renderProjectSelect() {
        const select = document.getElementById('projectSelect');
        const fileSelect = document.getElementById('fileProjectSelect');

        const options = this.projects.map(project => {
            const suffix = this.userRole === 'admin' && project.user_email ? ` · ${project.user_email}` : '';
            return `<option value="${project.id}">${this.escapeHtml(project.title)}${this.escapeHtml(suffix)}</option>`;
        }).join('');

        if (select) {
            select.innerHTML = options || '<option value="">Нет проектов</option>';
            select.value = this.currentProjectId || '';
            select.disabled = this.projects.length === 0;
        }

        if (fileSelect) {
            fileSelect.innerHTML = options || '<option value="">Нет проектов</option>';
            fileSelect.value = this.currentProjectId || '';
            fileSelect.disabled = this.projects.length === 0;
        }
    }

    async createProject(event) {
        event.preventDefault();
        const payload = {
            title: document.getElementById('projectTitle')?.value.trim(),
            description: document.getElementById('projectDescription')?.value.trim(),
            budget: document.getElementById('projectBudget')?.value || null,
            deadline: document.getElementById('projectDeadline')?.value || null,
            brief: {
                type: document.getElementById('projectType')?.value.trim() || '',
                goal: document.getElementById('projectGoal')?.value.trim() || ''
            }
        };

        try {
            await this.request('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            document.getElementById('newProjectForm')?.reset();
            this.hideModal('projectModal');
            await this.loadProjects();
            this.showMessage('Проект создан', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async updateProjectStatus(projectId, status) {
        try {
            await this.request(`/api/projects/${projectId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            await this.loadProjects();
            await this.loadNotifications();
            this.showMessage('Статус обновлен', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async loadPayments() {
        try {
            const data = await this.request('/api/users/payments');
            this.payments = data.payments || [];
            this.renderPayments();
        } catch (err) {
            const container = document.getElementById('paymentsHistory');
            if (container) container.innerHTML = '<div class="empty-state">Не удалось загрузить историю платежей</div>';
        }
    }

    async loadProjectDetail() {
        const container = document.getElementById('projectDetailContent');
        if (!container || !this.currentProjectId) return;
        container.innerHTML = '<div class="empty-state">Загрузка проекта...</div>';

        try {
            const data = await this.request(`/api/projects/${this.currentProjectId}/details`);
            this.projectDetails = data;
            this.renderProjectDetail();
        } catch (err) {
            container.innerHTML = `<div class="empty-state">${this.escapeHtml(err.message)}</div>`;
        }
    }

    renderProjectDetail() {
        const container = document.getElementById('projectDetailContent');
        const title = document.getElementById('projectDetailTitle');
        if (!container || !this.projectDetails) return;

        const { project, approvals = [], activity = [] } = this.projectDetails;
        if (title) title.textContent = project.title || 'Проект';
        const brief = project.brief || {};
        const projectFiles = Array.isArray(project.files) ? project.files : [];
        const projectPayments = this.payments.filter(payment => !payment.project_id || Number(payment.project_id) === Number(project.id));

        container.innerHTML = `
            <div class="project-detail-grid">
                <article class="detail-panel detail-summary">
                    <span class="project-status status-${project.status}">${this.getStatusText(project.status)}</span>
                    <p>${this.escapeHtml(project.description || 'Описание не указано')}</p>
                    <div class="detail-meta">
                        <span>${project.budget ? `${Number(project.budget).toLocaleString('ru-RU')} ₽` : 'Бюджет не указан'}</span>
                        <span>${project.deadline ? `До ${new Date(project.deadline).toLocaleDateString('ru-RU')}` : 'Срок не указан'}</span>
                    </div>
                    <div class="detail-actions">
                        <button type="button" class="btn-secondary" data-section-jump="chat">Чат</button>
                        ${this.userRole === 'admin' ? '' : '<button type="button" class="btn-secondary" data-section-jump="files">Файлы</button>'}
                    </div>
                </article>
                <article class="detail-panel">
                    <h3>Бриф</h3>
                    <dl class="brief-list">
                        <div><dt>Тип</dt><dd>${this.escapeHtml(brief.type || 'Не указан')}</dd></div>
                        <div><dt>Цель</dt><dd>${this.escapeHtml(brief.goal || 'Не указана')}</dd></div>
                    </dl>
                </article>
                <article class="detail-panel detail-wide">
                    <h3>Согласование этапов</h3>
                    <div class="approval-list">
                        ${approvals.map(stage => this.renderApprovalStage(stage)).join('')}
                    </div>
                </article>
                <article class="detail-panel">
                    <h3>Документы и файлы</h3>
                    ${projectFiles.length ? projectFiles.slice(0, 5).map(file => `
                        <div class="detail-file">
                            <span>${this.escapeHtml(file.file_name)}</span>
                            <small>${this.formatDateTime(file.uploaded_at)}</small>
                        </div>
                    `).join('') : '<p class="muted-text">Файлов пока нет</p>'}
                    ${projectPayments.length ? '<h4>Счета и платежи</h4>' : ''}
                    ${projectPayments.slice(0, 4).map(payment => `
                        <div class="detail-file">
                            <span>${Number(payment.amount || 0).toLocaleString('ru-RU')} ₽</span>
                            <small>${this.getPaymentStatusText(payment.status)} · ${payment.transaction_number || 'без номера'}</small>
                        </div>
                    `).join('')}
                </article>
                <article class="detail-panel">
                    <h3>История действий</h3>
                    <div class="activity-list">
                        ${activity.length ? activity.map(item => `
                            <div class="activity-item">
                                <strong>${this.escapeHtml(item.title)}</strong>
                                <p>${this.escapeHtml(item.body || '')}</p>
                                <time>${this.formatDateTime(item.created_at)}</time>
                            </div>
                        `).join('') : '<p class="muted-text">История пока пустая</p>'}
                    </div>
                </article>
            </div>
        `;

        container.querySelectorAll('[data-section-jump]').forEach(button => {
            button.addEventListener('click', () => this.switchSection(button.dataset.sectionJump));
        });
        container.querySelectorAll('[data-approval-action]').forEach(button => {
            button.addEventListener('click', () => this.updateApproval(button.dataset.stageKey, button.dataset.approvalAction));
        });
    }

    renderApprovalStage(stage) {
        const statusText = {
            pending: 'Ожидает',
            approved: 'Согласовано',
            changes: 'Нужны правки'
        }[stage.status] || stage.status;

        return `
            <div class="approval-stage approval-${stage.status}">
                <div>
                    <strong>${this.escapeHtml(stage.stage_title)}</strong>
                    <span>${statusText}</span>
                    ${stage.comment ? `<p>${this.escapeHtml(stage.comment)}</p>` : ''}
                </div>
                <div class="approval-actions">
                    <button type="button" class="btn-small" data-stage-key="${stage.stage_key}" data-approval-action="approved">Согласовать</button>
                    <button type="button" class="btn-small btn-ghost" data-stage-key="${stage.stage_key}" data-approval-action="changes">Правки</button>
                </div>
            </div>
        `;
    }

    async updateApproval(stageKey, status) {
        const comment = status === 'changes' ? prompt('Коротко опишите правки') : '';
        if (status === 'changes' && !comment) return;

        try {
            await this.request(`/api/projects/${this.currentProjectId}/approvals/${stageKey}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, comment })
            });
            await this.loadProjectDetail();
            this.showMessage('Согласование обновлено', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    renderPayments() {
        const container = document.getElementById('paymentsHistory');
        if (!container) return;

        if (!this.payments.length) {
            container.innerHTML = `
                <div class="empty-state payments-empty">
                    <h3>Платежей пока нет</h3>
                    <p>Когда появятся счета или оплаты по проектам, они отобразятся здесь.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="payments-table-wrap">
                <table class="payments-table">
                    <thead>
                        <tr>
                            <th>Дата</th>
                            <th>Сумма</th>
                            <th>Статус</th>
                            <th>Способ оплаты</th>
                            <th>Номер транзакции</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.payments.map(payment => `
                            <tr>
                                <td>${payment.paid_at ? new Date(payment.paid_at).toLocaleDateString('ru-RU') : '-'}</td>
                                <td>${Number(payment.amount || 0).toLocaleString('ru-RU')} ₽</td>
                                <td><span class="payment-status payment-${this.escapeHtml(payment.status || 'pending')}">${this.getPaymentStatusText(payment.status)}</span></td>
                                <td>${this.escapeHtml(payment.payment_method || 'Не указан')}</td>
                                <td>${this.escapeHtml(payment.transaction_number || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderProjectFocus() {
        const container = document.getElementById('projectFocusCard');
        if (!container) return;

        const project = this.projects.find(item => Number(item.id) === Number(this.currentProjectId)) || this.projects[0];
        if (!project) {
            container.innerHTML = `
                <div class="focus-empty">
                    <h3>Текущий проект</h3>
                    <p>Создайте проект, чтобы отслеживать следующий шаг, статус и коммуникации.</p>
                    <button type="button" class="btn-primary" data-focus-action="projects">Создать проект</button>
                </div>
            `;
        } else {
            const nextStep = this.getNextProjectStep(project.status);
            container.innerHTML = `
                <div class="focus-copy">
                    <span class="eyebrow">Текущий проект</span>
                    <h3>${this.escapeHtml(project.title)}</h3>
                    <p>${this.escapeHtml(nextStep)}</p>
                    <div class="project-timeline">
                        ${['new', 'in_progress', 'completed'].map(status => `
                            <span class="${this.isTimelineStepActive(project.status, status) ? 'active' : ''}">${this.getStatusText(status)}</span>
                        `).join('')}
                    </div>
                </div>
                <div class="focus-actions">
                    <span class="project-status status-${project.status}">${this.getStatusText(project.status)}</span>
                    <button type="button" class="btn-secondary" data-focus-action="chat">Открыть чат</button>
                    ${this.userRole === 'admin' ? '' : '<button type="button" class="btn-secondary" data-focus-action="files">Файлы</button>'}
                </div>
            `;
        }

        container.querySelectorAll('[data-focus-action]').forEach(button => {
            button.addEventListener('click', () => this.switchSection(button.dataset.focusAction));
        });
    }

    async changePassword(event) {
        event.preventDefault();
        const currentPassword = document.getElementById('currentPassword')?.value || '';
        const newPassword = document.getElementById('newPassword')?.value || '';
        const confirmPassword = document.getElementById('confirmNewPassword')?.value || '';

        if (!currentPassword || !newPassword || !confirmPassword) {
            this.showMessage('Заполните все поля для смены пароля', 'error');
            return;
        }

        if (newPassword.length < 6) {
            this.showMessage('Новый пароль должен содержать минимум 6 символов', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showMessage('Новый пароль и подтверждение не совпадают', 'error');
            return;
        }

        try {
            await this.request('/api/users/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
            });
            event.currentTarget.reset();
            this.showMessage('Пароль успешно изменен', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async deleteAccount(event) {
        event.preventDefault();
        const currentPassword = document.getElementById('deleteAccountPassword')?.value || '';
        const confirmation = document.getElementById('deleteAccountConfirmation')?.value.trim() || '';

        if (confirmation !== 'УДАЛИТЬ') {
            this.showMessage('Введите слово УДАЛИТЬ для подтверждения', 'error');
            return;
        }

        try {
            await this.request('/api/users/account', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, confirmation })
            });
            localStorage.removeItem('token');
            this.hideModal('deleteAccountModal');
            this.showMessage('Аккаунт удален. Сейчас вы будете перенаправлены на вход.', 'success');
            setTimeout(() => {
                window.location.href = '/';
            }, 1800);
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async sendAdminNote(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const noteField = form.querySelector('textarea[name="note"]');
        const note = noteField?.value.trim();
        if (!note) return;

        try {
            await this.request(`/api/projects/${form.dataset.projectId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note })
            });
            noteField.value = '';
            await this.loadNotifications();
            this.showMessage('Заметка отправлена', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async loadChat() {
        const chatContainer = document.getElementById('chatMessages');
        if (!chatContainer || !this.currentProjectId) return;

        try {
            const data = await this.request(`/api/messages/${this.currentProjectId}`);
            chatContainer.innerHTML = (data.messages || []).map(message => this.renderMessage(message)).join('');
            chatContainer.scrollTop = chatContainer.scrollHeight;
        } catch (err) {
            chatContainer.innerHTML = '<p class="empty-state">Ошибка загрузки сообщений</p>';
        }
    }

    renderMessage(message) {
        const isMine = Number(message.sender_id) === Number(this.userId);
        const isUserMessage = message.role !== 'admin';
        const senderName = message.role === 'admin'
            ? 'Администратор'
            : `${message.first_name || ''} ${message.last_name || ''}`.trim() || 'Оператор';

        return `
            <div class="chat-row ${isUserMessage ? 'chat-row-user' : 'chat-row-operator'} ${!isMine && !message.is_read ? 'chat-row-unread' : ''}">
                <div class="chat-bubble">
                    <span class="chat-author">${this.escapeHtml(isMine ? 'Вы' : senderName)}</span>
                    <span class="chat-text">${this.escapeHtml(message.message_text)}</span>
                </div>
                <time>${new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
        `;
    }

    async sendMessage(event) {
        event.preventDefault();
        const input = document.getElementById('chatInput');
        const text = input?.value.trim();
        if (!text || !this.currentProjectId) return;

        try {
            await this.request(`/api/messages/${this.currentProjectId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message_text: text })
            });
            input.value = '';
            await this.loadChat();
            await this.loadNotifications();
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async loadFiles() {
        const filesList = document.getElementById('filesList');
        if (!filesList || this.userRole === 'admin') return;

        const fileProjectSelect = document.getElementById('fileProjectSelect');
        const projectId = Number(fileProjectSelect?.value || this.currentProjectId);
        if (!projectId) {
            filesList.innerHTML = '<div class="empty-state">Выберите проект для просмотра файлов</div>';
            return;
        }

        try {
            const data = await this.request(`/api/project_files/${projectId}`);
            const files = data.files || [];
            filesList.innerHTML = files.length
                ? files.map(file => `
                    <article class="file-card" data-file-id="${file.id}">
                        <div class="file-card-icon">DOC</div>
                        <div class="file-card-body">
                            <a href="/api/project_files/download/${file.id}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(file.file_name)}</a>
                            <span>${this.formatDateTime(file.uploaded_at)} · ${this.formatBytes(file.file_size)}</span>
                            <div class="file-comments">
                                ${(file.comments || []).map(comment => `
                                    <p><strong>${this.escapeHtml(comment.user_name || 'Пользователь')}</strong>: ${this.escapeHtml(comment.comment_text)}</p>
                                `).join('')}
                                <form data-file-comment="${file.id}">
                                    <input type="text" name="comment" placeholder="Комментарий к файлу">
                                    <button type="submit" class="btn-small">OK</button>
                                </form>
                            </div>
                        </div>
                        <button type="button" class="btn-icon-danger" data-delete-file="${file.id}" title="Удалить файл">×</button>
                    </article>
                `).join('')
                : '<div class="empty-state">Файлов пока нет</div>';

            filesList.querySelectorAll('[data-delete-file]').forEach(button => {
                button.addEventListener('click', event => {
                    event.preventDefault();
                    this.deleteFile(button.dataset.deleteFile);
                });
            });
            filesList.querySelectorAll('[data-file-comment]').forEach(form => {
                form.addEventListener('submit', event => this.addFileComment(event));
            });
        } catch (err) {
            filesList.innerHTML = '<div class="empty-state">Ошибка загрузки файлов</div>';
        }
    }

    async addFileComment(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const input = form.querySelector('input[name="comment"]');
        const comment = input?.value.trim();
        if (!comment) return;

        try {
            await this.request(`/api/project_files/${form.dataset.fileComment}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comment })
            });
            input.value = '';
            await this.loadFiles();
            this.showMessage('Комментарий добавлен', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    async uploadFile(event) {
        event.preventDefault();
        const fileInput = document.getElementById('fileInput');
        const fileProjectSelect = document.getElementById('fileProjectSelect');
        const projectId = Number(fileProjectSelect?.value || this.currentProjectId);
        if (!fileInput?.files.length || !projectId) {
            this.showMessage('Выберите проект и файл для загрузки', 'error');
            return;
        }

        try {
            const uploads = Array.from(fileInput.files).map(file => {
                const formData = new FormData();
                formData.append('file', file);
                return fetch(`/api/project_files/${projectId}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${this.token}` },
                    body: formData
                }).then(async response => {
                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'Ошибка загрузки файла');
                    }
                    return response.json();
                });
            });

            await Promise.all(uploads);
            fileInput.value = '';
            await this.loadFiles();
            this.showMessage('Файлы загружены', 'success');
        } catch (err) {
            this.showMessage(err.message || 'Ошибка загрузки файла', 'error');
        }
    }

    async deleteFile(fileId) {
        try {
            await this.request(`/api/project_files/${fileId}`, { method: 'DELETE' });
            await this.loadFiles();
            this.showMessage('Файл удален', 'success');
        } catch (err) {
            this.showMessage(err.message || 'Ошибка удаления файла', 'error');
        }
    }

    async loadNotifications() {
        try {
            const data = await this.request('/api/notifications');
            this.notifications = data.notifications || [];
            this.renderNotifications();
            this.updateWidgets(data.unreadCount);
        } catch (err) {
            console.error('Ошибка загрузки уведомлений:', err);
        }
    }

    renderNotifications() {
        const containers = [
            document.getElementById('profileNotificationsList')
        ].filter(Boolean);

        const html = this.notifications.length
            ? this.notifications.map(notification => `
                <li class="notification-item ${notification.is_read ? '' : 'notification-unread'}" data-notification-id="${notification.id}">
                    <strong>${this.escapeHtml(notification.title)}</strong>
                    ${notification.body ? `<p>${this.escapeHtml(notification.body)}</p>` : ''}
                    <time>${new Date(notification.created_at).toLocaleString('ru-RU')}</time>
                </li>
            `).join('')
            : '<li class="empty-state">Новых уведомлений нет</li>';

        containers.forEach(container => {
            container.innerHTML = html;
            container.querySelectorAll('[data-notification-id]').forEach(item => {
                item.addEventListener('click', () => this.handleNotificationClick(Number(item.dataset.notificationId)));
            });
        });
    }

    async handleNotificationClick(notificationId) {
        const notification = this.notifications.find(item => Number(item.id) === Number(notificationId));
        if (!notification) return;

        await this.markNotificationAsRead(notificationId);

        if (notification.type === 'status' || notification.type === 'note' || notification.type === 'file') {
            this.switchSection('projects');
            this.currentProjectId = notification.project_id || this.currentProjectId;
            await this.loadProjects();
            this.highlightProject(notification.project_id);
        } else if (notification.type === 'message') {
            this.switchSection('chat');
            this.currentProjectId = notification.project_id || this.currentProjectId;
            this.renderProjectSelect();
            await this.loadChat();
        }

        await this.loadNotifications();
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
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    highlightProject(projectId) {
        if (!projectId) return;
        const card = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!card) return;
        card.classList.add('project-card-highlight');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => card.classList.remove('project-card-highlight'), 2500);
    }

    updateWidgets(unreadNotificationsCount = 0) {
        const active = this.projects.filter(project => ['new', 'in_progress'].includes(project.status)).length;
        this.setTextIn('activeProjects', '.widget-number', active);
        this.setTextIn('notificationsWidget', '.widget-number', unreadNotificationsCount);
        this.setTextIn('unreadMessages', '.widget-number', this.projects.reduce((sum, project) => sum + (project.unread_messages || 0), 0));
    }

    initEvents() {
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
        document.getElementById('updateProfileForm')?.addEventListener('submit', event => this.updateProfile(event));
        document.getElementById('changePasswordForm')?.addEventListener('submit', event => this.changePassword(event));
        document.getElementById('openDeleteAccountModal')?.addEventListener('click', () => this.showModal('deleteAccountModal'));
        document.getElementById('deleteAccountForm')?.addEventListener('submit', event => this.deleteAccount(event));
        document.getElementById('cancelDeleteAccountBtn')?.addEventListener('click', () => this.hideModal('deleteAccountModal'));
        document.getElementById('newProjectBtn')?.addEventListener('click', () => this.showModal('projectModal'));
        document.getElementById('newProjectForm')?.addEventListener('submit', event => this.createProject(event));
        document.getElementById('cancelProjectBtn')?.addEventListener('click', () => this.hideModal('projectModal'));
        document.getElementById('chatForm')?.addEventListener('submit', event => this.sendMessage(event));
        document.getElementById('uploadForm')?.addEventListener('submit', event => this.uploadFile(event));
        document.getElementById('markProfileNotificationsReadBtn')?.addEventListener('click', () => this.markAllNotificationsRead());
        document.getElementById('projectSearchInput')?.addEventListener('input', event => {
            this.projectSearchQuery = event.target.value.trim().toLowerCase();
            this.displayProjects();
        });
        document.getElementById('globalSearchInput')?.addEventListener('input', event => {
            this.globalSearchQuery = event.target.value.trim().toLowerCase();
            this.displayProjects();
        });
        document.getElementById('showArchiveProjects')?.addEventListener('change', event => {
            this.showArchiveProjects = event.target.checked;
            this.displayProjects();
        });
        document.getElementById('projectStatusFilter')?.addEventListener('change', event => {
            this.projectStatusFilter = event.target.value;
            this.displayProjects();
        });

        document.getElementById('projectSelect')?.addEventListener('change', event => {
            this.currentProjectId = Number(event.target.value);
            this.renderProjectSelect();
            this.loadChat();
            this.loadFiles();
        });

        document.getElementById('fileProjectSelect')?.addEventListener('change', event => {
            this.currentProjectId = Number(event.target.value);
            this.renderProjectSelect();
            this.loadFiles();
        });

        document.querySelectorAll('.sidebar a[data-section]').forEach(link => {
            link.addEventListener('click', event => {
                event.preventDefault();
                this.switchSection(link.dataset.section);
            });
        });
        document.querySelectorAll('[data-section-jump]').forEach(button => {
            button.addEventListener('click', () => this.switchSection(button.dataset.sectionJump));
        });
    }

    initModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
        });
        document.querySelectorAll('.modal .close').forEach(button => {
            button.addEventListener('click', event => this.hideModal(event.target.closest('.modal').id));
        });
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', event => {
                if (event.target === modal) this.hideModal(modal.id);
            });
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

    initBot() {
        const botButton = document.getElementById('botChatButton');
        const botWindow = document.getElementById('botChatWindow');
        const botClose = document.getElementById('botCloseBtn');
        const botForm = document.getElementById('botChatForm');
        const botMessages = document.getElementById('botMessages');
        const botInput = document.getElementById('botInput');
        if (!botButton || !botWindow || !botForm || !botMessages || !botInput) return;

        botButton.addEventListener('click', () => {
            botWindow.style.display = 'flex';
            requestAnimationFrame(() => botWindow.classList.add('bot-open'));
        });
        botClose?.addEventListener('click', () => {
            botWindow.classList.remove('bot-open');
            setTimeout(() => {
                if (!botWindow.classList.contains('bot-open')) botWindow.style.display = 'none';
            }, 180);
        });
        botForm.addEventListener('submit', async event => {
            event.preventDefault();
            const text = botInput.value.trim();
            if (!text) return;
            this.addBotMessage('user', text);
            botInput.value = '';
            botInput.disabled = true;
            try {
                const data = await this.request('/api/bot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });
                this.addBotMessage('bot', data.reply || this.getBotReply(text));
            } catch (err) {
                this.addBotMessage('bot', this.getBotReply(text));
            } finally {
                botInput.disabled = false;
                botInput.focus();
            }
        });
    }

    addBotMessage(sender, text) {
        const botMessages = document.getElementById('botMessages');
        if (!botMessages) return;
        const row = document.createElement('div');
        row.className = `chat-row ${sender === 'user' ? 'chat-row-user' : 'chat-row-operator'}`;
        row.innerHTML = `
            <div class="chat-bubble">
                <span class="chat-text">${this.escapeHtml(text)}</span>
            </div>
            <time>${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
        `;
        botMessages.appendChild(row);
        botMessages.scrollTop = botMessages.scrollHeight;
    }

    getBotReply(text) {
        const lower = text.toLowerCase();
        const replies = [
            { keys: ['проект'], reply: 'Проекты находятся во вкладке "Проекты".' },
            { keys: ['файл', 'документ'], reply: 'Файлы доступны во вкладке "Файлы проекта".' },
            { keys: ['сообщение', 'чат'], reply: 'Чат открыт во вкладке "Сообщения".' },
            { keys: ['контакт', 'оператор', 'связь'], reply: 'Связаться можно по info@pranait.ru или 8 800 500 81 54.' }
        ];
        for (const item of replies) {
            if (item.keys.some(key => lower.includes(key))) return item.reply;
        }
        return 'Я помогу с проектами, сообщениями, файлами и уведомлениями.';
    }

    switchSection(sectionName) {
        if (sectionName === 'notifications') sectionName = 'profile';
        if (sectionName === 'files' && this.userRole === 'admin') sectionName = 'projects';
        document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
        document.getElementById(`${sectionName}Section`)?.classList.add('active');
        document.querySelectorAll('.sidebar a[data-section]').forEach(link => link.classList.remove('active'));
        document.querySelector(`.sidebar a[data-section="${sectionName}"]`)?.classList.add('active');

        if (sectionName === 'projects') this.loadProjects();
        if (sectionName === 'projectDetail') this.loadProjectDetail();
        if (sectionName === 'payments') this.loadPayments();
        if (sectionName === 'chat') this.loadChat();
        if (sectionName === 'files') this.loadFiles();
    }

    startLiveUpdates() {
        if (this.liveUpdateInterval) clearInterval(this.liveUpdateInterval);
        this.liveUpdateInterval = setInterval(async () => {
            await this.loadNotifications();
            await this.loadProjects();
            await this.loadPayments();
            if (this.currentProjectId) {
                await this.loadChat();
                await this.loadFiles();
            }
        }, 5000);
    }

    showModal(modalId) {
        document.getElementById(modalId)?.classList.add('modal-open');
    }

    hideModal(modalId) {
        document.getElementById(modalId)?.classList.remove('modal-open');
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

    getStatusText(status) {
        return {
            new: 'Новый',
            in_progress: 'В работе',
            completed: 'Завершен',
            rejected: 'Отклонен'
        }[status] || status;
    }

    getPaymentStatusText(status) {
        return {
            pending: 'Ожидает оплаты',
            paid: 'Оплачен',
            failed: 'Ошибка',
            refunded: 'Возврат'
        }[status] || 'Неизвестно';
    }

    getNextProjectStep(status) {
        return {
            new: 'Мы получили заявку и готовим оценку. Следующий шаг появится после первичного разбора.',
            in_progress: 'Проект в работе. Следите за сообщениями и файлами, там будут вопросы и промежуточные материалы.',
            completed: 'Проект завершен. Проверьте материалы и историю файлов.',
            rejected: 'Проект остановлен. Напишите в чат, если хотите обсудить корректировки.'
        }[status] || 'Следующий шаг уточняется менеджером.';
    }

    isTimelineStepActive(projectStatus, stepStatus) {
        const order = { new: 1, in_progress: 2, completed: 3, rejected: 0 };
        return (order[projectStatus] || 0) >= (order[stepStatus] || 0);
    }

    getFilteredProjects() {
        return this.projects.filter(project => {
            const matchesStatus = this.projectStatusFilter === 'all' || project.status === this.projectStatusFilter;
            const showArchived = this.showArchiveProjects || project.status !== 'completed';
            const filesHaystack = Array.isArray(project.files) ? project.files.map(file => file.file_name).join(' ') : '';
            const haystack = `${project.title || ''} ${project.description || ''} ${project.user_email || ''} ${project.messages_text || ''} ${filesHaystack}`.toLowerCase();
            const matchesProjectSearch = !this.projectSearchQuery || haystack.includes(this.projectSearchQuery);
            const matchesGlobalSearch = !this.globalSearchQuery || haystack.includes(this.globalSearchQuery);
            return matchesStatus && showArchived && matchesProjectSearch && matchesGlobalSearch;
        });
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

    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    setTextIn(id, selector, value) {
        const element = document.getElementById(id)?.querySelector(selector);
        if (element) element.textContent = value;
    }

    setValue(id, value) {
        const element = document.getElementById(id);
        if (element) element.value = value;
    }

    setChecked(id, value) {
        const element = document.getElementById(id);
        if (element) element.checked = value;
    }
}

document.addEventListener('DOMContentLoaded', () => new Dashboard());
