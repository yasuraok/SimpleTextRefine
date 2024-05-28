const vscode = require('vscode')

const { Buffer } = require('buffer')
const OpenAI = require('openai')

function makeSystemMsg(prompt) {
    return {
        role: "system",
        content: prompt,
    }
}

function makeUserMsg(text) {
    return {
        role: 'user',
        content: text,
    }
}

// openAI GPT APIを使って文章を添削する
async function callGPTStream(text, systemPrompt, apiKey, model, callback) {
    const openai = new OpenAI({apiKey})

    const messages = [makeSystemMsg(systemPrompt), makeUserMsg(text)]

    const responses = await openai.chat.completions.create({
        model,
        messages,
        stream: true,
    });

    // ストリーミング処理
    let content = "";
    for await (const response of responses) {
        const delta = response.choices[0].delta;
        if (delta.content) {
            content += delta.content;
            await callback(delta.content) // コールバックで通知
        } else {
            // 終わり
        }
    }

    return content;
}

module.exports = { callGPTStream }
