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
        vscode.window.showErrorMessage(`.prompt is not an YAML format array`)
        throw new Error()
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
        vscode.window.showInformationMessage(`Got: ${result.label}`);
        return result.label
    } else {
        vscode.window.showWarningMessage(`Failed to get`);
    }
}

// openAI GPT APIを使って文章を添削する
// 使うエンドポイントはclient.chat.completions.create
async function callGPT(text, promptText, apiKey, model) {
    const openai = new OpenAI({apiKey})

    const systemPrompt = await getSystemPrompt(promptText)

    const messages = [makeSystemMsg(systemPrompt), makeUserMsg(text)]
    vscode.window.showInformationMessage(`calling ${model}...: ${systemPrompt}`)

    const res = await openai.chat.completions.create({
        model,
        messages,
    })
    console.log(res)
    const content = res.choices[0].message.content
    console.log({content})
    vscode.window.showInformationMessage(`finished.`)
    return content
}

module.exports = { callGPT }
