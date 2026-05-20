class Auth {
    constructor() {
        this.token = localStorage.getItem('token');
        this.initEvents();
    }

    initEvents() {
        // Обработка формы входа
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        // Обработка формы регистрации
        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }

        document.getElementById('openAgreementBtn')?.addEventListener('click', () => this.showAgreement());
        document.getElementById('closeAgreementBtn')?.addEventListener('click', () => this.hideAgreement());
        document.getElementById('agreementModal')?.addEventListener('click', event => {
            if (event.target.id === 'agreementModal') this.hideAgreement();
        });

        // Проверка авторизации при загрузке страницы
        if (this.token) {
            this.verifyToken();
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                localStorage.setItem('token', this.token);
                this.showMessage('Вход выполнен успешно!', 'success');
                
                // Перенаправление на dashboard через 1 секунду
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 1000);
            } else {
                this.showMessage(data.error || 'Ошибка входа', 'error');
            }
        } catch (error) {
            this.showMessage('Ошибка соединения с сервером', 'error');
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        
        const firstName = document.getElementById('firstName').value;
        const lastName = document.getElementById('lastName').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const acceptedTerms = document.getElementById('agreeTerms')?.checked === true;

        if (!acceptedTerms) {
            this.showMessage('Необходимо принять условия пользовательского договора', 'error');
            return;
        }

        // Валидация паролей
        if (password !== confirmPassword) {
            this.showMessage('Пароли не совпадают', 'error');
            return;
        }

        if (password.length < 6) {
            this.showMessage('Пароль должен содержать минимум 6 символов', 'error');
            return;
        }

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    firstName, 
                    lastName, 
                    email, 
                    password,
                    acceptedTerms
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.showMessage('Регистрация прошла успешно! Теперь вы можете войти.', 'success');
                
                // Очистка формы и перенаправление на страницу входа
                document.getElementById('registerForm').reset();
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            } else {
                this.showMessage(data.error || 'Ошибка регистрации', 'error');
            }
        } catch (error) {
            this.showMessage('Ошибка соединения с сервером', 'error');
        }
    }

    async verifyToken() {
        try {
            const response = await fetch('/api/auth/verify', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            const data = await response.json();

            if (!data.valid) {
                this.logout();
            } else {
                // Если пользователь авторизован и находится на странице входа/регистрации
                // перенаправляем его в личный кабинет
                if (window.location.pathname === '/' || window.location.pathname === '/register') {
                    window.location.href = '/dashboard';
                }
            }
        } catch (error) {
            console.error('Token verification error:', error);
        }
    }

    logout() {
        localStorage.removeItem('token');
        this.token = null;
        window.location.href = '/';
    }

    showMessage(text, type) {
        const messageDiv = document.getElementById('message');
        if (messageDiv) {
            messageDiv.textContent = text;
            messageDiv.className = `message ${type}`;
            messageDiv.style.display = 'block';

            // Автоматическое скрытие сообщения через 5 секунд
            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 5000);
        }
    }

    showAgreement() {
        const modal = document.getElementById('agreementModal');
        if (!modal) return;
        modal.classList.add('agreement-open');
        modal.setAttribute('aria-hidden', 'false');
    }

    hideAgreement() {
        const modal = document.getElementById('agreementModal');
        if (!modal) return;
        modal.classList.remove('agreement-open');
        modal.setAttribute('aria-hidden', 'true');
    }

    // Получение информации о текущем пользователе
    async getCurrentUser() {
        if (!this.token) return null;

        try {
            const response = await fetch('/api/users/profile', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                return data.user;
            }
            return null;
        } catch (error) {
            console.error('Error getting user:', error);
            return null;
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.auth = new Auth();
});
