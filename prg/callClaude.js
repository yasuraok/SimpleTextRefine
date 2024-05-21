const vscode = require('vscode')

const Anthropic = require("@anthropic-ai/sdk")

const MAX_TOKENS = 4096 // https://docs.anthropic.com/claude/docs/models-overview

function makeUserMsg(text) {
    return {
        role: 'user',
        content: text,
    }
}

// openAI GPT APIを使って文章を添削する
async function callClaudeStream(text, systemPrompt, apiKey, model, callback) {
    const anthropic = new Anthropic({apiKey})

    vscode.window.showInformationMessage(`calling ${model}...: ${systemPrompt}`)

    const stream = await anthropic.messages.stream({
        model,
        system: systemPrompt,
        messages: [makeUserMsg(text)],
        max_tokens: MAX_TOKENS,
    }).on('text', async (text) => {
        await callback(text) // コールバックで通知
    })
    const message = await stream.finalMessage()

    return message.content.text
}

module.exports = { callClaudeStream }
