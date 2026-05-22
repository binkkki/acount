const express = require('express');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/', auth, async (req, res) => {
    try {
        const question = String(req.body.message || '').trim();
        if (!question) {
            return res.status(400).json({ error: 'Сообщение не может быть пустым' });
        }

        const reply = process.env.OPENAI_API_KEY
            ? await askOpenAI(question, req.user)
            : getPreparedReply(question);

        res.json({
            reply,
            source: process.env.OPENAI_API_KEY ? 'ai' : 'prepared'
        });
    } catch (error) {
        console.error('Bot reply error:', error);
        res.json({
            reply: getPreparedReply(req.body.message || ''),
            source: 'prepared'
        });
    }
});

async function askOpenAI(question, user) {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            instructions: [
                'Ты помощник в личном кабинете PRANA IT.',
                'Отвечай по-русски, кратко и дружелюбно.',
                'Помогай с проектами, файлами, статусами, оплатой, согласованием и связью с администратором.',
                'Не обещай юридически или финансово значимых действий. Если вопрос требует сотрудника, предложи написать в чат проекта.'
            ].join(' '),
            input: [
                {
                    role: 'user',
                    content: `Пользователь: ${user.first_name || ''} ${user.last_name || ''}, роль: ${user.role}. Вопрос: ${question}`
                }
            ],
            max_output_tokens: 220
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || 'AI request failed');
    }

    return extractResponseText(data) || getPreparedReply(question);
}

function extractResponseText(data) {
    if (data.output_text) return data.output_text.trim();

    const chunks = [];
    for (const item of data.output || []) {
        for (const content of item.content || []) {
            if (content.type === 'output_text' && content.text) chunks.push(content.text);
        }
    }
    return chunks.join('\n').trim();
}

function getPreparedReply(text) {
    const lower = String(text || '').toLowerCase();
    const replies = [
        { keys: ['проект', 'заявк'], reply: 'Проекты находятся во вкладке "Проекты". Там можно посмотреть статус, дедлайн, файлы и согласования.' },
        { keys: ['файл', 'документ', 'загруз'], reply: 'Файлы доступны в выбранном проекте и во вкладке "Файлы проекта". Если файл не отображается, обновите страницу или напишите администратору.' },
        { keys: ['сообщение', 'чат', 'админ', 'оператор'], reply: 'Для связи с командой откройте проект и перейдите во вкладку "Сообщения".' },
        { keys: ['оплат', 'платеж', 'счет'], reply: 'История платежей находится в личном кабинете во вкладке "Платежи".' },
        { keys: ['соглас', 'правк', 'этап'], reply: 'Согласование этапов находится в деталях проекта. Там можно подтвердить этап или отправить правки.' },
        { keys: ['контакт', 'телефон', 'почт'], reply: 'Связаться с PRANA IT можно по info@pranait.ru или 8 800 500-81-54.' }
    ];

    for (const item of replies) {
        if (item.keys.some(key => lower.includes(key))) return item.reply;
    }
    return 'Я помогу с проектами, сообщениями, файлами, оплатой и согласованием. Если вопрос срочный, лучше написать в чат проекта.';
}

module.exports = router;
