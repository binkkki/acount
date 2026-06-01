const nodemailer = require('nodemailer');

function hasSmtpConfig() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && !hasPlaceholderSmtpConfig());
}

function hasPlaceholderSmtpConfig() {
    const values = [
        process.env.SMTP_HOST,
        process.env.SMTP_USER,
        process.env.SMTP_PASSWORD,
        process.env.EMAIL_FROM
    ].filter(Boolean).map(value => String(value).trim().toLowerCase());

    return values.some(value =>
        value.includes('smtp.example.com') ||
        value.includes('example.com') ||
        value.includes('your_email') ||
        value.includes('replace_with') ||
        value.includes('твоя') ||
        value.includes('реальная_почта') ||
        value.includes('пароль_приложения')
    );
}

function createTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD
        }
    });
}

function getPurposeText(purpose) {
    if (purpose === 'register') return 'регистрации в личном кабинете PRANA IT';
    if (purpose === 'profile_update') return 'подтверждения изменений профиля';
    return 'подтверждения действия';
}

async function sendVerificationCode({ to, code, purpose, ttlMinutes }) {
    const subject = 'Код подтверждения PRANA IT';
    const purposeText = getPurposeText(purpose);
    const text = [
        `Ваш код для ${purposeText}: ${code}`,
        `Код действует ${ttlMinutes} минут.`,
        'Если вы не запрашивали код, просто проигнорируйте это письмо.'
    ].join('\n');
    const html = `
        <div style="font-family: Arial, sans-serif; color: #17252f; line-height: 1.5;">
            <h2 style="color: #1d9888;">PRANA IT</h2>
            <p>Ваш код для ${purposeText}:</p>
            <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #1d9888;">${code}</p>
            <p>Код действует ${ttlMinutes} минут.</p>
            <p style="color: #687684;">Если вы не запрашивали код, просто проигнорируйте это письмо.</p>
        </div>
    `;

    if (!hasSmtpConfig()) {
        console.warn(`[email-verification] SMTP не настроен или заполнен примером. Код для ${to}: ${code}`);
        return { sent: false };
    }

    const transporter = createTransporter();
    await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
        html
    });

    return { sent: true };
}

module.exports = { sendVerificationCode };
