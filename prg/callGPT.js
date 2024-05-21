const vscode = require('vscode')
const OpenAI = require('openai')

// https://platform.openai.com/docs/guides/rate-limits/usage-tiers?context=tier-one
// https://help.openai.com/en/articles/5955604-how-can-i-solve-429-too-many-requests-errors
async function backoff(func, maxRetries = 5, delay = 30000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await func()
        } catch (error) {
            if (error instanceof OpenAI.RateLimitError) {
                vscode.window.showInformationMessage(`waiting to avoid rate limit...`)
                await new Promise(resolve => setTimeout(resolve, delay))
            } else {
                throw error
            }
        }
    }
    throw new Error('Retry limit exceeded')
}

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

    const arg = {
        model,
        messages,
        stream: true,
    }

    const responses = await backoff(async () => {
        return await openai.chat.completions.create(arg)
    })

    // ストリーミング処理
    let content = "";
    for await (const response of responses) {
        const delta = response.choices[0].delta;
        if (delta.content) {
            content += delta.content;
            callback(delta.content) // コールバックで通知
        } else {
            // 終わり
        }
    }

    return content;
}

module.exports = { callGPTStream }
