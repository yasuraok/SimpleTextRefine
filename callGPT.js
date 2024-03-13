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
async function gptExample(text, promptText, apiKey, model) {
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

// inputTextをGPTに添削させ、結果をVSCode上に表示する
async function callGPTAndOpenEditor(inputText, uri, promptText, apiKey, model) {
    // gptExampleを使って文章を添削する
    const newText = await gptExample(inputText, promptText, apiKey, model)

    // GPTの応答を*.gptという名前のファイルに書き込む
    const newUri = uri.with({path: uri.path + '.gpt'})
    const newFile = vscode.Uri.file(newUri.path)
    await vscode.workspace.fs.writeFile(newFile, Buffer.from(newText))

    // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、gptExampleの結果をleftに表示する
    await vscode.commands.executeCommand('vscode.diff', newUri, uri)

    // // そのファイルを別タブとして開く
    // const doc = await vscode.workspace.openTextDocument(newUri)
    // await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside)
}

module.exports = { callGPTAndOpenEditor }
