const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

let client;

(async () => {
    const OpenAI = (await import('openai')).default;
    client = new OpenAI({
        apiKey: process.env.YA_CLOUD_API_KEY,
        baseURL: 'https://ai.api.cloud.yandex.net/v1',
        defaultHeaders: {
            'OpenAI-Project': 'b1g4tas5gdkrnpjcvo1i'
        }
    });
})();

router.post('/', auth, async (req, res) => {
    const { message } = req.body;
    if(!message) return res.status(400).json({ error: 'Сообщение пустое' });

    try {
        const response = await client.responses.create({
            prompt: { id: 'fvttkc8el2540sb2j5kp' },
            input: message
        });
        res.json({ reply: response.output_text || 'Бот не смог ответить' });
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка Yandex AI Studio' });
    }
});

module.exports = router;