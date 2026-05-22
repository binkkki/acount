class Auth {
    constructor() {
        this.token = localStorage.getItem('token');
        this.initEvents();
        this.initNetworkShowcase();
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

        this.initAuthPageTransitions();

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

    initAuthPageTransitions() {
        const page = document.querySelector('.auth-page');
        if (!page) return;

        document.querySelectorAll('.auth-switch a[href="/"], .auth-switch a[href="/register"]').forEach(link => {
            link.addEventListener('click', event => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

                const href = link.getAttribute('href');
                if (!href || href === window.location.pathname) return;

                event.preventDefault();
                if (page.classList.contains('auth-exiting')) return;

                page.classList.add('auth-exiting');
                page.classList.toggle('auth-exiting-to-register', href === '/register');
                page.classList.toggle('auth-exiting-to-login', href === '/');
                window.setTimeout(() => {
                    window.location.href = href;
                }, 620);
            });
        });
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

    initNetworkShowcase() {
        const showcase = document.querySelector('.auth-showcase');
        const canvas = showcase?.querySelector('.network-canvas');
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const ctx = canvas?.getContext('2d');

        if (!showcase || !canvas || !ctx) return;

        const state = {
            width: 0,
            height: 0,
            dpr: 1,
            points: [],
            mouse: {
                x: 0,
                y: 0,
                targetX: 0,
                targetY: 0,
                active: false
            }
        };

        const random = (min, max) => min + Math.random() * (max - min);

        const createPoint = () => ({
            x: random(-30, state.width + 30),
            y: random(-30, state.height + 30),
            vx: random(-0.24, 0.24),
            vy: random(-0.24, 0.24),
            radius: random(1.7, 4.1),
            pulse: random(0, Math.PI * 2)
        });

        const resizeCanvas = () => {
            const rect = showcase.getBoundingClientRect();
            state.width = Math.max(1, rect.width);
            state.height = Math.max(1, rect.height);
            state.dpr = Math.min(window.devicePixelRatio || 1, 2);

            canvas.width = Math.round(state.width * state.dpr);
            canvas.height = Math.round(state.height * state.dpr);
            canvas.style.width = `${state.width}px`;
            canvas.style.height = `${state.height}px`;
            ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

            const density = Math.round((state.width * state.height) / 5600);
            const count = Math.max(52, Math.min(138, density));
            state.points = Array.from({ length: count }, createPoint);
            state.mouse.x = state.width / 2;
            state.mouse.y = state.height / 2;
            state.mouse.targetX = state.mouse.x;
            state.mouse.targetY = state.mouse.y;
        };

        const setTargetFromPointer = (event) => {
            const rect = canvas.getBoundingClientRect();
            state.mouse.targetX = event.clientX - rect.left;
            state.mouse.targetY = event.clientY - rect.top;
            state.mouse.active = true;
        };

        const resetTarget = () => {
            state.mouse.active = false;
        };

        const movePoint = (point) => {
            if (state.mouse.active) {
                const dx = point.x - state.mouse.x;
                const dy = point.y - state.mouse.y;
                const distance = Math.hypot(dx, dy) || 1;
                const radius = Math.min(210, Math.max(145, state.width * 0.24));

                if (distance < radius) {
                    const force = (1 - distance / radius) * 0.032;
                    point.vx += (dx / distance) * force;
                    point.vy += (dy / distance) * force;
                }
            }

            point.x += point.vx;
            point.y += point.vy;
            point.vx *= 0.988;
            point.vy *= 0.988;
            point.pulse += 0.018;

            if (point.x < -40) point.x = state.width + 40;
            if (point.x > state.width + 40) point.x = -40;
            if (point.y < -40) point.y = state.height + 40;
            if (point.y > state.height + 40) point.y = -40;
        };

        const drawLine = (from, to, maxDistance, multiplier = 1) => {
            const distance = Math.hypot(from.x - to.x, from.y - to.y);
            if (distance > maxDistance) return;

            const opacity = (1 - distance / maxDistance) * multiplier;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.strokeStyle = `rgba(67, 210, 210, ${opacity})`;
            ctx.lineWidth = 1.15;
            ctx.stroke();
        };

        const draw = () => {
            ctx.clearRect(0, 0, state.width, state.height);
            state.mouse.x += (state.mouse.targetX - state.mouse.x) * 0.1;
            state.mouse.y += (state.mouse.targetY - state.mouse.y) * 0.1;

            if (!reducedMotion) {
                state.points.forEach(movePoint);
            }

            const connectionDistance = state.width < 520 ? 138 : 188;

            for (let i = 0; i < state.points.length; i += 1) {
                for (let j = i + 1; j < state.points.length; j += 1) {
                    drawLine(state.points[i], state.points[j], connectionDistance, 0.52);
                }
            }

            if (state.mouse.active) {
                state.points.forEach(point => {
                    drawLine(point, state.mouse, 230, 0.86);
                });

                ctx.beginPath();
                ctx.arc(state.mouse.x, state.mouse.y, 5.2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(77, 232, 232, 0.96)';
                ctx.shadowColor = 'rgba(77, 232, 232, 0.88)';
                ctx.shadowBlur = 18;
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            state.points.forEach(point => {
                const glow = 0.74 + Math.sin(point.pulse) * 0.16;
                ctx.beginPath();
                ctx.arc(point.x, point.y, point.radius * glow, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(77, 232, 232, 0.96)';
                ctx.shadowColor = 'rgba(77, 232, 232, 0.82)';
                ctx.shadowBlur = 17;
                ctx.fill();
                ctx.shadowBlur = 0;
            });

            if (!reducedMotion) {
                window.requestAnimationFrame(draw);
            }
        };

        showcase.addEventListener('pointermove', setTargetFromPointer);
        showcase.addEventListener('pointerleave', resetTarget);
        window.addEventListener('resize', resizeCanvas);

        resizeCanvas();
        draw();
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
