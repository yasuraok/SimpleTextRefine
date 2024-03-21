const vscode = require('vscode')

const { Buffer } = require('buffer')
const OpenAI = require('openai')
const jsyaml = require('js-yaml')

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

async function getSystemPrompt(promptText) {
    // yaml配列になっているのでそれをパース
    const promptYaml = jsyaml.load(promptText)
    if (!Array.isArray(promptYaml)) {
        throw new Error(`.prompt is not an YAML format array`)
    }

    // 選択肢をVSCodeのQuickPickで表示する
    const items = promptYaml.map(item => {
        return {
            label: item,
            description: "",
        }
    })

    const result = await vscode.window.showQuickPick(items);
    if (result) {
        return result.label
    } else {
        throw new Error('Canceled');
    }
}

// openAI GPT APIを使って文章を添削する
async function callGPTStream(text, promptText, apiKey, model, callback) {
    const openai = new OpenAI({apiKey})

    const systemPrompt = await getSystemPrompt(promptText)
    const messages = [makeSystemMsg(systemPrompt), makeUserMsg(text)]

    vscode.window.showInformationMessage(`calling ${model}...: ${systemPrompt}`)

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
            callback(delta.content) // コールバックで通知
        } else {
            // 終わり
        }
    }

    return content;
}

module.exports = { callGPTStream }
