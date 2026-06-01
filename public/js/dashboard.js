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
        this.projectTagFilter = 'all';
        this.showArchiveProjects = false;
        this.projectDetails = null;
        this.currentNotificationId = null;
        this.liveUpdateInterval = null;
        this.previousUnreadNotificationsCount = null;
        this.soundEnabled = false;
        this.audioContext = null;
        this.language = localStorage.getItem('language') || 'ru';
        this.translationMap = this.buildTranslationMap();
        this.profileInitialState = '';
        this.profileInitialDataState = '';
        this.profileVerificationPending = false;
        this.notificationsPanelCollapsed = true;
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
        this.initNotificationSound();
        this.initLanguageSelector();

        await this.loadUserData();
        await this.loadProjects();
        await this.loadPayments();
        await this.loadNotifications();
        await this.loadFiles();
        if (this.currentProjectId) await this.loadChat();
        this.applyLanguage();
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
        this.setValue('updatePhone', this.formatPhoneInput(user.phone || ''));
        this.setValue('updateCompany', user.company || '');
        this.setChecked('notifyEmail', user.notify_email === true);
        this.setChecked('notifyMessages', user.notify_messages !== false);
        this.setChecked('notifyStatus', user.notify_status !== false);
        this.setChecked('notifyNotes', user.notify_notes !== false);
        this.profileInitialState = this.getProfileFormState();
        this.profileInitialDataState = this.getProfileDataState();
        this.profileVerificationPending = false;
        this.hideProfileVerification();
        this.clearFieldErrors('updateEmail', 'updatePhone');
        this.updateProfileSaveState();

        const adminLink = document.getElementById('adminLink');
        if (adminLink) adminLink.style.display = user.role === 'admin' ? 'block' : 'none';
        const filesNavItem = document.getElementById('filesNavItem');
        if (filesNavItem) filesNavItem.style.display = user.role === 'admin' ? 'none' : 'block';
        document.body.classList.toggle('is-admin', user.role === 'admin');
        this.applyLanguage();
    }

    async updateProfile(event) {
        event.preventDefault();
        if (!this.validateProfileForm()) return;

        const payload = this.getProfilePayload();
        const profileDataChanged = this.isProfileDataChanged();

        if (profileDataChanged && !this.profileVerificationPending) {
            await this.sendProfileVerificationCode(payload);
            return;
        }

        if (profileDataChanged) {
            const verificationCode = document.getElementById('profileVerificationCode')?.value.trim() || '';
            if (!/^\d{6}$/.test(verificationCode)) {
                this.setFieldError('profileVerificationCode', 'Введите 6-значный код из письма');
                this.showMessage('Введите код подтверждения', 'error');
                return;
            }
            payload.verificationCode = verificationCode;
        }

        try {
            await this.request('/api/users/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            await this.loadUserData();
            this.hideProfileVerification();
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
        this.applyLanguage();
    }

    displayProjects() {
        const container = document.getElementById('projectsGrid');
        if (!container) return;

        this.renderProjectTags();
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
                    <p>Попробуйте изменить поиск, статус или выбранный тег.</p>
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
        const tags = this.getProjectTagsForProject(project);

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
                ${tags.length ? `<div class="project-card-tags">${tags.map(tag => `<span>${this.escapeHtml(tag)}</span>`).join('')}</div>` : ''}
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
        if (!this.validateProjectForm()) return;

        const payload = {
            title: document.getElementById('projectTitle')?.value.trim(),
            description: document.getElementById('projectDescription')?.value.trim(),
            budget: this.normalizeMoneyInput(document.getElementById('projectBudget')?.value),
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
            this.clearFieldErrors('projectBudget', 'projectDeadline');
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
            this.applyLanguage();
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
        this.applyLanguage();
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
            this.applyLanguage();
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
        this.applyLanguage();
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
        this.applyLanguage();
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
            this.applyLanguage();
        } catch (err) {
            chatContainer.innerHTML = '<p class="empty-state">Ошибка загрузки сообщений</p>';
            this.applyLanguage();
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
            this.applyLanguage();
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
            this.applyLanguage();
        } catch (err) {
            filesList.innerHTML = '<div class="empty-state">Ошибка загрузки файлов</div>';
            this.applyLanguage();
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
            this.handleUnreadNotificationsChange(data.unreadCount || 0);
            this.notifications = data.notifications || [];
            this.renderNotifications();
            this.updateWidgets(data.unreadCount);
            this.applyLanguage();
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
        document.getElementById('updateProfileForm')?.addEventListener('input', event => this.handleProfileFormInput(event));
        document.getElementById('updateProfileForm')?.addEventListener('change', () => this.updateProfileSaveState());
        document.getElementById('resendProfileCodeBtn')?.addEventListener('click', () => this.sendProfileVerificationCode(this.getProfilePayload()));
        document.getElementById('changePasswordForm')?.addEventListener('submit', event => this.changePassword(event));
        document.getElementById('openDeleteAccountModal')?.addEventListener('click', () => this.showModal('deleteAccountModal'));
        document.getElementById('deleteAccountForm')?.addEventListener('submit', event => this.deleteAccount(event));
        document.getElementById('cancelDeleteAccountBtn')?.addEventListener('click', () => this.hideModal('deleteAccountModal'));
        document.getElementById('newProjectBtn')?.addEventListener('click', () => this.showModal('projectModal'));
        document.getElementById('newProjectForm')?.addEventListener('submit', event => this.createProject(event));
        document.getElementById('projectBudget')?.addEventListener('input', event => this.handleBudgetInput(event));
        document.getElementById('projectDeadline')?.addEventListener('change', () => this.validateProjectDateField());
        document.getElementById('cancelProjectBtn')?.addEventListener('click', () => this.hideModal('projectModal'));
        document.getElementById('chatForm')?.addEventListener('submit', event => this.sendMessage(event));
        document.getElementById('uploadForm')?.addEventListener('submit', event => this.uploadFile(event));
        document.getElementById('markProfileNotificationsReadBtn')?.addEventListener('click', () => this.markAllNotificationsRead());
        document.getElementById('openNotificationsPanelBtn')?.addEventListener('click', event => {
            event.stopPropagation();
            this.toggleNotificationsPanel();
        });
        document.getElementById('notificationsWidget')?.addEventListener('click', () => this.openNotificationsPanel());
        document.getElementById('resetProjectTagFilter')?.addEventListener('click', () => {
            this.projectTagFilter = 'all';
            this.displayProjects();
        });
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
        this.setProjectDateMin();
        this.updateNotificationsPanelState();
    }

    handleProfileFormInput(event) {
        if (event.target?.id === 'updatePhone') {
            event.target.value = this.formatPhoneInput(event.target.value);
        }
        if (event.target?.id === 'profileVerificationCode') {
            event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
            this.clearFieldErrors('profileVerificationCode');
        }
        if (event.target?.id === 'updateEmail') this.clearFieldErrors('updateEmail');
        if (event.target?.id === 'updatePhone') this.clearFieldErrors('updatePhone');
        if (!this.isProfileDataChanged()) this.hideProfileVerification();
        this.updateProfileSaveState();
    }

    getProfilePayload() {
        return {
            firstName: document.getElementById('updateFirstName')?.value.trim(),
            lastName: document.getElementById('updateLastName')?.value.trim(),
            email: document.getElementById('updateEmail')?.value.trim(),
            phone: this.normalizePhoneForSave(document.getElementById('updatePhone')?.value.trim()),
            company: document.getElementById('updateCompany')?.value.trim(),
            notifyEmail: document.getElementById('notifyEmail')?.checked === true,
            notifyMessages: document.getElementById('notifyMessages')?.checked !== false,
            notifyStatus: document.getElementById('notifyStatus')?.checked !== false,
            notifyNotes: document.getElementById('notifyNotes')?.checked !== false
        };
    }

    getProfileFormState() {
        const fields = ['updateFirstName', 'updateLastName', 'updateEmail', 'updatePhone', 'updateCompany'];
        const values = fields.map(id => document.getElementById(id)?.value.trim() || '');
        const checks = ['notifyEmail', 'notifyMessages', 'notifyStatus', 'notifyNotes']
            .map(id => document.getElementById(id)?.checked === true ? '1' : '0');
        return JSON.stringify([...values, ...checks]);
    }

    getProfileDataState() {
        const fields = ['updateFirstName', 'updateLastName', 'updateEmail', 'updatePhone', 'updateCompany'];
        return JSON.stringify(fields.map(id => document.getElementById(id)?.value.trim() || ''));
    }

    isProfileDataChanged() {
        return this.getProfileDataState() !== this.profileInitialDataState;
    }

    async sendProfileVerificationCode(payload = this.getProfilePayload()) {
        if (!this.validateProfileForm()) return;
        if (!this.isProfileDataChanged()) {
            this.hideProfileVerification();
            this.showMessage('Код не нужен: личные данные не изменены', 'success');
            return;
        }

        try {
            const data = await this.request('/api/users/profile/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (data.requiresCode === false) {
                this.hideProfileVerification();
                this.showMessage(data.message || 'Код подтверждения не требуется', 'success');
                return;
            }
            this.showProfileVerification();
            this.showMessage(data.message || 'Код подтверждения отправлен на email', 'success');
        } catch (err) {
            this.showMessage(err.message, 'error');
        }
    }

    showProfileVerification() {
        const block = document.getElementById('profileVerificationBlock');
        const input = document.getElementById('profileVerificationCode');
        const button = document.getElementById('profileSaveBtn');

        this.profileVerificationPending = true;
        if (block) block.hidden = false;
        if (input) {
            input.required = true;
            input.focus();
        }
        if (button) button.textContent = 'Подтвердить и сохранить';
        this.applyLanguage();
    }

    hideProfileVerification() {
        const block = document.getElementById('profileVerificationBlock');
        const input = document.getElementById('profileVerificationCode');
        const button = document.getElementById('profileSaveBtn');

        this.profileVerificationPending = false;
        if (block) block.hidden = true;
        if (input) {
            input.required = false;
            input.value = '';
        }
        this.clearFieldErrors('profileVerificationCode');
        if (button) button.textContent = 'Сохранить изменения';
        this.applyLanguage();
    }

    updateProfileSaveState() {
        const button = document.getElementById('profileSaveBtn');
        if (!button) return;
        const changed = this.getProfileFormState() !== this.profileInitialState;
        button.disabled = !changed;
        button.classList.toggle('is-ready', changed);
    }

    validateProfileForm() {
        this.clearFieldErrors('updateEmail', 'updatePhone');
        let isValid = true;
        const email = document.getElementById('updateEmail')?.value.trim() || '';
        const phone = document.getElementById('updatePhone')?.value.trim() || '';

        if (!this.isValidEmail(email)) {
            this.setFieldError('updateEmail', 'Введите корректный email, например name@example.com');
            isValid = false;
        }

        if (phone && !this.isValidPhone(phone)) {
            this.setFieldError('updatePhone', 'Введите телефон в формате +7 (999) 123-45-67');
            isValid = false;
        }

        if (!isValid) this.showMessage('Проверьте email и телефон в настройках', 'error');
        return isValid;
    }

    isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || '').trim());
    }

    formatPhoneInput(value) {
        let digits = String(value || '').replace(/\D/g, '');
        if (!digits) return '';
        if (digits[0] === '8') digits = `7${digits.slice(1)}`;
        if (digits[0] !== '7') digits = `7${digits}`;
        digits = digits.slice(0, 11);

        const parts = ['+7'];
        if (digits.length > 1) parts.push(` (${digits.slice(1, 4)}`);
        if (digits.length >= 4) parts[1] += ')';
        if (digits.length > 4) parts.push(` ${digits.slice(4, 7)}`);
        if (digits.length > 7) parts.push(`-${digits.slice(7, 9)}`);
        if (digits.length > 9) parts.push(`-${digits.slice(9, 11)}`);
        return parts.join('');
    }

    normalizePhoneForSave(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) return '';
        const normalized = digits[0] === '8' ? `7${digits.slice(1)}` : digits;
        return normalized.length === 11 && normalized[0] === '7'
            ? `+${normalized}`
            : value;
    }

    isValidPhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        return digits.length === 11 && digits[0] === '7';
    }

    handleBudgetInput(event) {
        const input = event.target;
        input.value = this.formatMoneyInput(input.value);
        this.clearFieldErrors('projectBudget');
    }

    formatMoneyInput(value) {
        const raw = String(value || '').replace(/[^\d,.]/g, '').replace(',', '.');
        if (!raw) return '';
        const [integerPart, decimalPart = ''] = raw.split('.');
        const integer = integerPart.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        const formattedInteger = integer ? Number(integer).toLocaleString('ru-RU') : '';
        const decimal = decimalPart.replace(/\D/g, '').slice(0, 2);
        return decimalPart.length || raw.includes('.') ? `${formattedInteger || '0'},${decimal}` : formattedInteger;
    }

    validateProjectForm() {
        this.clearFieldErrors('projectBudget', 'projectDeadline');
        let isValid = true;
        const budget = this.normalizeMoneyInput(document.getElementById('projectBudget')?.value);
        const deadline = document.getElementById('projectDeadline')?.value || '';

        if (budget !== null) {
            const amount = Number(budget);
            if (!Number.isFinite(amount) || amount < 0) {
                this.setFieldError('projectBudget', 'Укажите бюджет числом, например 1 000 или 1 000 000');
                isValid = false;
            } else if (amount > 999999999999.99) {
                this.setFieldError('projectBudget', 'Укажите сумму не больше 999 999 999 999,99 ₽');
                isValid = false;
            }
        }

        if (deadline && this.isPastDate(deadline)) {
            this.setFieldError('projectDeadline', 'Дата проекта не может быть раньше сегодняшнего дня');
            isValid = false;
        }

        if (!isValid) this.showMessage('Проверьте бюджет и срок проекта', 'error');
        return isValid;
    }

    validateProjectDateField() {
        this.clearFieldErrors('projectDeadline');
        const deadline = document.getElementById('projectDeadline')?.value || '';
        if (deadline && this.isPastDate(deadline)) {
            this.setFieldError('projectDeadline', 'Дата проекта не может быть раньше сегодняшнего дня');
            this.showMessage('Выберите сегодняшнюю или будущую дату', 'error');
            return false;
        }
        return true;
    }

    setProjectDateMin() {
        const input = document.getElementById('projectDeadline');
        if (input) input.min = this.getTodayISO();
    }

    getTodayISO() {
        const today = new Date();
        return [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, '0'),
            String(today.getDate()).padStart(2, '0')
        ].join('-');
    }

    isPastDate(value) {
        if (!value) return false;
        return value < this.getTodayISO();
    }

    setFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const error = document.getElementById(`${fieldId}Error`);
        field?.classList.add('field-invalid');
        if (error) error.textContent = message;
    }

    clearFieldErrors(...fieldIds) {
        fieldIds.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            const error = document.getElementById(`${fieldId}Error`);
            field?.classList.remove('field-invalid');
            if (error) error.textContent = '';
        });
    }

    openNotificationsPanel() {
        const panel = document.querySelector('.notifications-panel');
        panel?.classList.add('is-open');
        panel?.classList.remove('is-hidden');
        this.notificationsPanelCollapsed = false;
        this.updateNotificationsPanelState();
    }

    closeNotificationsPanel() {
        this.notificationsPanelCollapsed = true;
        this.updateNotificationsPanelState();
    }

    toggleNotificationsPanel() {
        this.notificationsPanelCollapsed = !this.notificationsPanelCollapsed;
        this.updateNotificationsPanelState();
    }

    updateNotificationsPanelState() {
        const panel = document.querySelector('.notifications-panel');
        const toggle = document.getElementById('openNotificationsPanelBtn');
        panel?.classList.toggle('is-collapsed', this.notificationsPanelCollapsed);
        toggle?.classList.toggle('is-collapsed', this.notificationsPanelCollapsed);
        toggle?.setAttribute('aria-expanded', String(!this.notificationsPanelCollapsed));
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
            this.runThemeTransition();
            document.body.classList.toggle('dark-theme', theme === 'dark');
            document.body.classList.toggle('light-theme', theme === 'light');
            localStorage.setItem('theme', theme);
        });
    }

    runThemeTransition() {
        document.body.classList.add('theme-transitioning');
        window.clearTimeout(this.themeTransitionTimer);
        this.themeTransitionTimer = window.setTimeout(() => {
            document.body.classList.remove('theme-transitioning');
        }, 340);
    }

    initLanguageSelector() {
        document.documentElement.lang = this.language;
        const select = document.getElementById('languageSelect');
        if (select) select.value = this.language;

        select?.addEventListener('change', () => {
            this.language = select.value === 'en' ? 'en' : 'ru';
            localStorage.setItem('language', this.language);
            document.documentElement.lang = this.language;
            this.applyLanguage();
        });
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

    initBot() {
        const botButton = document.getElementById('botChatButton');
        const botWindow = document.getElementById('botChatWindow');
        const botClose = document.getElementById('botCloseBtn');
        const botForm = document.getElementById('botChatForm');
        const botMessages = document.getElementById('botMessages');
        const botInput = document.getElementById('botInput');
        if (!botButton || !botWindow || !botForm || !botMessages || !botInput) return;

        this.initBotResize(botWindow);

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
                const reply = data.reply || this.getBotReply(text);
                this.addBotMessage('bot', reply, this.getBotActions(text, reply));
            } catch (err) {
                const reply = this.getBotReply(text);
                this.addBotMessage('bot', reply, this.getBotActions(text, reply));
            } finally {
                botInput.disabled = false;
                botInput.focus();
            }
        });
    }

    initBotResize(botWindow) {
        const handle = document.getElementById('botResizeHandle');
        if (!handle || !botWindow) return;

        const sizeKey = 'pranaBotChatSize';
        const clampSize = (width, height) => {
            const maxWidth = Math.min(760, window.innerWidth - 28);
            const maxHeight = Math.min(780, window.innerHeight - 108);
            return {
                width: Math.max(320, Math.min(width, maxWidth)),
                height: Math.max(380, Math.min(height, maxHeight))
            };
        };
        const applySize = ({ width, height }) => {
            botWindow.style.setProperty('--bot-width', `${width}px`);
            botWindow.style.setProperty('--bot-height', `${height}px`);
        };
        const getCurrentSize = () => {
            const rect = botWindow.getBoundingClientRect();
            return {
                width: parseFloat(botWindow.style.getPropertyValue('--bot-width')) || rect.width || 430,
                height: parseFloat(botWindow.style.getPropertyValue('--bot-height')) || rect.height || 570
            };
        };

        try {
            const savedSize = JSON.parse(localStorage.getItem(sizeKey) || 'null');
            if (savedSize?.width && savedSize?.height) {
                applySize(clampSize(savedSize.width, savedSize.height));
            }
        } catch (error) {
            try {
                localStorage.removeItem(sizeKey);
            } catch (storageError) {
                console.warn('Bot chat size storage is unavailable:', storageError);
            }
        }

        let dragState = null;

        handle.addEventListener('pointerdown', event => {
            if (window.matchMedia('(max-width: 768px)').matches) return;
            event.preventDefault();
            handle.setPointerCapture?.(event.pointerId);
            const rect = botWindow.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startWidth: rect.width,
                startHeight: rect.height
            };
            botWindow.classList.add('is-resizing');
            document.body.classList.add('bot-chat-resizing');
        });

        handle.addEventListener('pointermove', event => {
            if (!dragState) return;
            const width = dragState.startWidth - (event.clientX - dragState.startX);
            const height = dragState.startHeight - (event.clientY - dragState.startY);
            applySize(clampSize(width, height));
        });

        const stopResize = event => {
            if (!dragState) return;
            if (typeof event?.pointerId === 'number' && event.pointerId !== dragState.pointerId) return;
            const rect = botWindow.getBoundingClientRect();
            const size = clampSize(rect.width, rect.height);
            applySize(size);
            try {
                localStorage.setItem(sizeKey, JSON.stringify(size));
            } catch (error) {
                console.warn('Bot chat size was not saved:', error);
            }
            dragState = null;
            botWindow.classList.remove('is-resizing');
            document.body.classList.remove('bot-chat-resizing');
        };

        handle.addEventListener('pointerup', stopResize);
        handle.addEventListener('pointercancel', stopResize);

        window.addEventListener('resize', () => {
            const size = getCurrentSize();
            applySize(clampSize(size.width, size.height));
        });
    }

    addBotMessage(sender, text, actions = []) {
        const botMessages = document.getElementById('botMessages');
        if (!botMessages) return;
        const row = document.createElement('div');
        row.className = `chat-row ${sender === 'user' ? 'chat-row-user' : 'chat-row-operator'}`;
        const actionsHtml = sender !== 'user' && actions.length
            ? `<div class="bot-actions">
                ${actions.map(action => `
                    <button type="button"
                            class="bot-action"
                            data-bot-action="${this.escapeHtml(action.type)}"
                            data-bot-target="${this.escapeHtml(action.target || '')}"
                            data-bot-section="${this.escapeHtml(action.section || '')}"
                            data-bot-modal="${this.escapeHtml(action.modal || '')}"
                            data-bot-url="${this.escapeHtml(action.url || '')}">
                        ${this.escapeHtml(action.label)}
                    </button>
                `).join('')}
            </div>`
            : '';
        row.innerHTML = `
            <div class="chat-bubble">
                <span class="chat-text">${this.escapeHtml(text)}</span>
                ${actionsHtml}
            </div>
            <time>${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
        `;
        row.querySelectorAll('[data-bot-action]').forEach(button => {
            button.addEventListener('click', () => this.handleBotAction(button.dataset));
        });
        botMessages.appendChild(row);
        botMessages.scrollTop = botMessages.scrollHeight;
    }

    handleBotAction(dataset) {
        const { botAction, botTarget, botSection, botModal, botUrl } = dataset;
        if (botAction === 'section' && botTarget) {
            this.switchSection(botTarget);
            this.scrollDashboardIntoView();
        }
        if (botAction === 'project' && botTarget) {
            this.openProjectFromBot(botTarget, botSection || 'projectDetail');
        }
        if (botAction === 'modal' && botModal) {
            this.switchSection(botTarget || 'projects');
            setTimeout(() => this.showModal(botModal), 120);
            this.scrollDashboardIntoView();
        }
        if (botAction === 'external' && botUrl) {
            window.open(botUrl, '_blank', 'noopener,noreferrer');
        }
    }

    openProjectFromBot(projectId, sectionName = 'projectDetail') {
        const project = this.projects.find(item => Number(item.id) === Number(projectId));
        if (!project) {
            this.showMessage('Проект не найден в вашем кабинете', 'error');
            return;
        }

        this.currentProjectId = Number(project.id);
        this.renderProjectSelect();
        this.switchSection(sectionName);
        this.scrollDashboardIntoView();
    }

    scrollDashboardIntoView() {
        document.querySelector('.content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    getBotActions(text, reply = '') {
        const query = String(text || '').toLowerCase();
        const lower = `${text || ''} ${reply || ''}`.toLowerCase();
        const matchedProject = this.findProjectFromBotText(query);
        const actions = [];
        const has = words => words.some(word => lower.includes(word));
        const add = action => {
            if (!actions.some(item => item.type === action.type && item.target === action.target && item.section === action.section && item.modal === action.modal && item.url === action.url)) {
                actions.push(action);
            }
        };

        if (matchedProject) {
            add({
                label: `Открыть: ${matchedProject.title}`,
                type: 'project',
                target: String(matchedProject.id),
                section: 'projectDetail'
            });
        }

        if (has(['создать проект', 'новый проект', 'оставить заявку', 'заявк'])) {
            add({ label: 'Создать проект', type: 'modal', target: 'projects', modal: 'projectModal' });
        }

        if (has(['файл', 'документ', 'загруз', 'скач'])) {
            if (matchedProject) {
                add({ label: 'Файлы проекта', type: 'project', target: String(matchedProject.id), section: 'files' });
            } else {
                add({ label: 'Открыть файлы', type: 'section', target: 'files' });
            }
        }

        if (has(['сообщ', 'чат', 'переписк', 'оператор', 'админ', 'менеджер', 'написать'])) {
            if (matchedProject) {
                add({ label: 'Чат проекта', type: 'project', target: String(matchedProject.id), section: 'chat' });
            } else {
                add({ label: 'Открыть сообщения', type: 'section', target: 'chat' });
            }
        }

        if (has(['оплат', 'платеж', 'счет', 'транзакц', 'деньги'])) {
            add({ label: 'Открыть платежи', type: 'section', target: 'payments' });
        }

        if (has(['настрой', 'парол', 'язык', 'уведомл', 'сменить пароль', 'удалить аккаунт', 'телефон', 'email'])) {
            add({ label: 'Открыть настройки', type: 'section', target: 'settings' });
        }

        if (has(['профил', 'данные', 'телефон', 'почт', 'email'])) {
            add({ label: 'Открыть профиль', type: 'section', target: 'profile' });
        }

        if (has(['контакт', 'связь', 'сайт', 'главн'])) {
            add({ label: 'Сайт PRANA IT', type: 'external', url: 'https://pranait.ru/' });
        }

        if (has(['проект', 'статус', 'этап', 'соглас', 'правк', 'дедлайн', 'срок', 'бриф'])) {
            add({ label: 'Открыть проекты', type: 'section', target: 'projects' });
            if (this.currentProjectId) {
                add({ label: 'Текущий проект', type: 'section', target: 'projectDetail' });
            }
        }

        return actions.slice(0, 3);
    }

    findProjectFromBotText(text) {
        const source = String(text || '').toLowerCase();
        if (!source || !this.projects.length) return null;

        const idMatch = source.match(/(?:проект(?:\s*№|\s*#)?|#|id\s*)\s*(\d+)/i) || source.match(/\b(\d{1,8})\b/);
        if (idMatch) {
            const byId = this.projects.find(project => Number(project.id) === Number(idMatch[1]));
            if (byId) return byId;
        }

        const quotedMatch = source.match(/[«"]([^»"]{3,})[»"]/);
        if (quotedMatch) {
            const quoted = quotedMatch[1].trim();
            const byQuote = this.projects.find(project => String(project.title || '').toLowerCase().includes(quoted));
            if (byQuote) return byQuote;
        }

        const normalized = source
            .replace(/где|найди|открой|покажи|перейди|проект|проекта|по|мне|нужен|нужна|нужно|чат|файлы|статус|срок|дедлайн/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (normalized.length < 3) return null;

        return this.projects.find(project => {
            const title = String(project.title || '').toLowerCase();
            return title.includes(normalized) || normalized.includes(title);
        }) || null;
    }

    getBotReply(text) {
        const lower = text.toLowerCase();
        const replies = [
            { keys: ['создать проект', 'новый проект', 'заявк'], reply: 'Новый проект можно создать во вкладке "Проекты". Я добавил кнопку быстрого перехода.' },
            { keys: ['файл', 'документ', 'загруз', 'скач'], reply: 'Файлы доступны во вкладке "Файлы проекта". Если указан конкретный проект, я добавлю переход сразу к его файлам.' },
            { keys: ['сообщение', 'чат', 'переписк', 'админ', 'оператор', 'менеджер'], reply: 'Для общения с командой откройте "Сообщения". Если в вопросе есть проект, можно перейти сразу в его чат.' },
            { keys: ['оплат', 'платеж', 'счет', 'транзакц'], reply: 'История платежей находится во вкладке "Платежи". Там отображаются дата, сумма, статус и номер транзакции.' },
            { keys: ['парол', 'телефон', 'email', 'язык', 'уведомл', 'удалить аккаунт'], reply: 'Эти действия находятся в настройках профиля. Я добавил кнопку перехода в настройки.' },
            { keys: ['статус', 'соглас', 'правк', 'этап', 'дедлайн', 'срок', 'бриф', 'проект'], reply: 'Информация по проектам находится во вкладке "Проекты". Если вы указали номер или название проекта, я добавлю прямой переход.' },
            { keys: ['контакт', 'связь', 'сайт', 'главн'], reply: 'Связаться можно по info@pranait.ru или 8 800 500 81 54. Также можно открыть основной сайт PRANA IT.' }
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
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.add('modal-open');
        modal.setAttribute('aria-hidden', 'false');
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('modal-open');
        modal.setAttribute('aria-hidden', 'true');
    }

    logout() {
        localStorage.removeItem('token');
        window.location.href = '/';
    }

    showMessage(text, type) {
        const message = document.getElementById('message');
        if (!message) return;
        window.clearTimeout(this.messageTimer);
        message.textContent = text;
        message.className = `message ${type} show`;
        message.setAttribute('role', type === 'error' ? 'alert' : 'status');
        message.style.display = 'block';
        this.messageTimer = setTimeout(() => {
            message.classList.remove('show');
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
            const projectTags = this.getProjectTagsForProject(project).map(tag => tag.toLowerCase());
            const matchesTag = this.projectTagFilter === 'all' || projectTags.includes(this.projectTagFilter.toLowerCase());
            const showArchived = this.showArchiveProjects || project.status !== 'completed';
            const filesHaystack = Array.isArray(project.files) ? project.files.map(file => file.file_name).join(' ') : '';
            const haystack = `${project.title || ''} ${project.description || ''} ${project.user_email || ''} ${project.messages_text || ''} ${filesHaystack} ${projectTags.join(' ')}`.toLowerCase();
            const matchesProjectSearch = !this.projectSearchQuery || haystack.includes(this.projectSearchQuery);
            const matchesGlobalSearch = !this.globalSearchQuery || haystack.includes(this.globalSearchQuery);
            return matchesStatus && matchesTag && showArchived && matchesProjectSearch && matchesGlobalSearch;
        });
    }

    renderProjectTags() {
        const toolbar = document.getElementById('projectTagsToolbar');
        const container = document.getElementById('projectTags');
        if (!toolbar || !container) return;

        const tags = this.getProjectTags();
        toolbar.hidden = tags.length === 0;
        container.innerHTML = tags.map(tag => `
            <button type="button" class="project-tag ${this.projectTagFilter === tag ? 'active' : ''}" data-project-tag="${this.escapeHtml(tag)}">
                ${this.escapeHtml(tag)}
            </button>
        `).join('');

        container.querySelectorAll('[data-project-tag]').forEach(button => {
            button.addEventListener('click', () => {
                this.projectTagFilter = button.dataset.projectTag;
                this.displayProjects();
            });
        });

        const reset = document.getElementById('resetProjectTagFilter');
        if (reset) reset.hidden = this.projectTagFilter === 'all';
    }

    getProjectTags() {
        const tags = new Set();
        this.projects.forEach(project => {
            this.getProjectTagsForProject(project).forEach(tag => tags.add(tag));
        });
        return [...tags].sort((a, b) => a.localeCompare(b, 'ru'));
    }

    getProjectTagsForProject(project) {
        const tags = new Set();
        const brief = project.brief && typeof project.brief === 'object' ? project.brief : {};
        const typeSource = [brief.type, project.type].filter(Boolean).join(' ');
        typeSource.split(/[,\n;/|]+/).map(tag => tag.trim()).filter(Boolean).forEach(tag => tags.add(tag));
        if (project.status) tags.add(this.getStatusText(project.status));
        return [...tags].slice(0, 5);
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

    normalizeMoneyInput(value) {
        const normalized = String(value || '').trim()
            .replace(/\s/g, '')
            .replace(',', '.')
            .replace(/[^\d.]/g, '');
        if (!normalized) return null;
        const [integerPart, decimalPart = ''] = normalized.split('.');
        const amount = `${integerPart || '0'}${decimalPart ? `.${decimalPart.slice(0, 2)}` : ''}`;
        return Number.isFinite(Number(amount)) ? amount : null;
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

    buildTranslationMap() {
        const ruToEn = {
            'PRANA IT / Личный кабинет': 'PRANA IT / Account',
            'Меню': 'Menu',
            'Поиск': 'Search',
            'Проекты, файлы, сообщения': 'Projects, files, messages',
            'Профиль': 'Profile',
            'Настройки': 'Settings',
            'Проекты': 'Projects',
            'Платежи': 'Payments',
            'Сообщения': 'Messages',
            'Файлы проекта': 'Project files',
            'Админ панель': 'Admin panel',
            'На главный экран': 'Main website',
            'Мой профиль': 'My profile',
            'Имя:': 'First name:',
            'Фамилия:': 'Last name:',
            'Email:': 'Email:',
            'Телефон:': 'Phone:',
            'Компания:': 'Company:',
            'Роль:': 'Role:',
            'Дата регистрации:': 'Registration date:',
            'Уведомления': 'Notifications',
            'Прочитано': 'Mark read',
            'Свернуть': 'Collapse',
            'Развернуть': 'Expand',
            'Активные проекты': 'Active projects',
            'в работе и новых': 'new and in progress',
            'непрочитанных': 'unread',
            'Новые сообщения': 'New messages',
            'в проектах': 'in projects',
            'Настройки профиля': 'Profile settings',
            'Имя': 'First name',
            'Фамилия': 'Last name',
            'Телефон': 'Phone',
            'Компания': 'Company',
            'Настройки уведомлений': 'Notification settings',
            'Email-уведомления': 'Email notifications',
            'Новые сообщения от оператора': 'New messages from operator',
            'Изменения статуса проектов': 'Project status changes',
            'Заметки администратора': 'Admin notes',
            'Язык интерфейса': 'Interface language',
            'Язык': 'Language',
            'Русский': 'Russian',
            'Сохранить изменения': 'Save changes',
            'Подтвердить и сохранить': 'Confirm and save',
            'Подтверждение изменений': 'Confirm changes',
            'Код подтверждения отправляется на текущий email аккаунта. Введите его, чтобы сохранить измененные данные профиля.': 'A verification code is sent to the current account email. Enter it to save changed profile data.',
            'Код из письма': 'Email code',
            'Отправить код повторно': 'Send code again',
            'Смена пароля': 'Change password',
            'Текущий пароль': 'Current password',
            'Новый пароль': 'New password',
            'Подтверждение нового пароля': 'Confirm new password',
            'Изменить пароль': 'Change password',
            'Удаление аккаунта': 'Delete account',
            'Удаление необратимо: вместе с аккаунтом будут удалены проекты, сообщения, уведомления, файлы и платежная история.': 'Deletion is permanent: projects, messages, notifications, files, and payment history will be removed with the account.',
            'Удалить аккаунт': 'Delete account',
            '+ Новый проект': '+ New project',
            'Статус': 'Status',
            'Все статусы': 'All statuses',
            'Новый': 'New',
            'В работе': 'In progress',
            'Завершен': 'Completed',
            'Отклонен': 'Rejected',
            'Показать архив': 'Show archive',
            'Сбросить тег': 'Reset tag',
            'Создать новый проект': 'Create new project',
            'Название проекта': 'Project title',
            'Описание': 'Description',
            'Тип проекта': 'Project type',
            'Сайт, CRM, дизайн': 'Website, CRM, design',
            'Цель': 'Goal',
            'Что должен решить проект': 'What should the project solve',
            'Бюджет, ₽': 'Budget, RUB',
            'Например: 12 500': 'For example: 12 500',
            'Срок': 'Deadline',
            'Отмена': 'Cancel',
            'Создать проект': 'Create project',
            'История платежей': 'Payment history',
            'Платежей пока нет': 'No payments yet',
            'Когда появятся счета или оплаты по проектам, они отобразятся здесь.': 'Invoices and project payments will appear here.',
            'Дата': 'Date',
            'Сумма': 'Amount',
            'Способ оплаты': 'Payment method',
            'Номер транзакции': 'Transaction number',
            'Проект': 'Project',
            'К списку': 'Back to list',
            'Введите сообщение...': 'Type a message...',
            'Отправить': 'Send',
            'Сначала выберите проект': 'Choose a project first',
            'Загрузить': 'Upload',
            'Удалить аккаунт?': 'Delete account?',
            'Это действие необратимо. Вместе с аккаунтом будут удалены связанные данные: проекты, сообщения, уведомления, файлы и история платежей.': 'This action is permanent. Related data will be deleted with the account: projects, messages, notifications, files, and payment history.',
            'Введите слово УДАЛИТЬ': 'Type УДАЛИТЬ',
            'Помощник PRANA IT': 'PRANA IT assistant',
            'Напишите сообщение...': 'Write a message...',
            'Выйти': 'Log out',
            'Пользователь': 'User',
            'Администратор': 'Administrator',
            'Бюджет не указан': 'Budget not specified',
            'Срок не указан': 'Deadline not specified',
            'Файлов пока нет': 'No files yet',
            'Новых уведомлений нет': 'No new notifications',
            'Проектов пока нет': 'No projects yet',
            'Создайте первый проект, чтобы начать работу.': 'Create your first project to start working.',
            'Текущий проект': 'Current project',
            'Создайте проект, чтобы отслеживать следующий шаг, статус и коммуникации.': 'Create a project to track the next step, status, and communication.',
            'Ничего не найдено': 'Nothing found',
            'Попробуйте изменить поисковый запрос или статус.': 'Try changing the search query or status.',
            'Попробуйте изменить поиск, статус или выбранный тег.': 'Try changing search, status, or selected tag.',
            'Описание не указано': 'No description',
            'Открыть чат': 'Open chat',
            'Чат': 'Chat',
            'Файлы': 'Files',
            'Бриф': 'Brief',
            'Тип': 'Type',
            'Не указан': 'Not specified',
            'Не указана': 'Not specified',
            'Согласование этапов': 'Stage approvals',
            'Документы и файлы': 'Documents and files',
            'Счета и платежи': 'Invoices and payments',
            'История действий': 'Activity history',
            'История пока пустая': 'History is empty',
            'Ожидает': 'Pending',
            'Согласовано': 'Approved',
            'Нужны правки': 'Changes needed',
            'Согласовать': 'Approve',
            'Правки': 'Changes',
            'Дата неизвестна': 'Unknown date',
            'Ошибка загрузки сообщений': 'Failed to load messages',
            'Ошибка загрузки файлов': 'Failed to load files',
            'Выберите проект для просмотра файлов': 'Choose a project to view files',
            'Комментарий к файлу': 'File comment',
            'Удалить файл': 'Delete file',
            'Ожидает оплаты': 'Pending payment',
            'Оплачен': 'Paid',
            'Ошибка': 'Error',
            'Возврат': 'Refund',
            'Неизвестно': 'Unknown'
        };

        const enToRu = Object.fromEntries(Object.entries(ruToEn).map(([ru, en]) => [en, ru]));
        return { ruToEn, enToRu };
    }

    applyLanguage() {
        const dictionary = this.language === 'en' ? this.translationMap.ruToEn : this.translationMap.enToRu;
        document.documentElement.lang = this.language;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: node => {
                const parent = node.parentElement;
                if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });

        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            const original = node.nodeValue;
            const trimmed = original.trim();
            const translated = dictionary[trimmed];
            if (!translated) return;
            node.nodeValue = original.replace(trimmed, translated);
        });

        document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(element => {
            const translated = dictionary[element.placeholder];
            if (translated) element.placeholder = translated;
        });

        const select = document.getElementById('languageSelect');
        if (select) select.value = this.language;
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
