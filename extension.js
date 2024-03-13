const vscode = require('vscode')

const { Buffer } = require('buffer')
const OpenAI = require('openai')
const path = require('path')
const jsyaml = require('js-yaml')

const EXT_NAME = "simple-text-refine-with-gpt"

const DEFAULT_MODEL = "gpt-3.5-turbo"

// vscode APIの設定を取得する
function getConfigValue(key) {
    const config = vscode.workspace.getConfiguration(EXT_NAME)
    return config.get(key)
}

function helloWorld() {
    vscode.window.showInformationMessage('Hello, world!')
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

async function getSystemPrompt(promptPath) {
    if(! promptPath) {
        vscode.window.showErrorMessage('.prompt not found')
    }
    const promptText = await vscode.workspace.openTextDocument(promptPath).then(doc => doc.getText())

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
async function gptExample(text, promptPath) {
    const apiKey = getConfigValue('api_key')
    const model = getConfigValue('model') || DEFAULT_MODEL
    if (! apiKey) {
        // 設定画面を開くリンクを含むnotificationを表示する
        vscode.window.showErrorMessage('API Key is not set', 'Open Settings').then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', EXT_NAME)
            }
        })
    }
    const openai = new OpenAI({apiKey})

    const systemPrompt = await getSystemPrompt(promptPath)

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

// プロンプトを記載したファイルを探して返す。優先順位は以下の通り
// 1. {ファイル名}.prompt,
// 2. (同じディレクトリの).prompt,
// 3. (親フォルダを再帰的に探索).prompt (workspace直下まで)
async function findPrompt(filePath) {
    // 1の条件
    const promptFile = vscode.Uri.file(`${filePath}.prompt`)
    if (await vscode.workspace.fs.stat(promptFile).then(() => true, () => false)) {
        return promptFile
    }

    // 2, 3の条件
    async function recursion(dir){
        const promptFile = vscode.Uri.file(path.join(dir, '.prompt'))
        const promptFileExists = await vscode.workspace.fs.stat(promptFile).then(() => true, () => false)
        if (promptFileExists) {
            return promptFile
        } else {
            const parentDir = path.dirname(dir)
            return dir === parentDir ? null : recursion(parentDir)
        }
    }

    return recursion(path.dirname(filePath))
}

async function openPrompt(textEditor, textEditorEdit) {
    console.log({textEditor, textEditorEdit})
    const promptFile = await findPrompt(textEditor.document.uri.fsPath)
    if (! promptFile) {
        vscode.window.showErrorMessage('.prompt not found')
        return
    }
    if (promptFile) {
        // 既に開かれているか調べる → 開かれていればそのファイルにフォーカスを移動する
        const allEditors = vscode.window.visibleTextEditors
        const openedEditor = allEditors.find(editor => editor.document.uri.fsPath === promptFile.fsPath)
        if (openedEditor) {
            console.log({openedEditor})
            await vscode.window.showTextDocument(openedEditor.document, {viewColumn: openedEditor.viewColumn})

        } else {
            // New Editor Group Above
            await vscode.commands.executeCommand('workbench.action.newGroupAbove', {ratio: 0.2})
            // Decrease Editor Height
            await vscode.commands.executeCommand('workbench.action.decreaseViewHeight')
            await vscode.commands.executeCommand('workbench.action.decreaseViewHeight')

            // 上部に作ったグループにdocを表示する (フォーカスも移動)
            const doc = await vscode.workspace.openTextDocument(promptFile)
            await vscode.window.showTextDocument(doc)
        }
    }

}

// inputTextをGPTに添削させ、結果をVSCode上に表示する
async function callGPTAndOpenEditor(inputText, uri, promptPath) {
    // gptExampleを使って文章を添削する
    const newText = await gptExample(inputText, promptPath)

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

// ファイル全体をGPTに添削させる
async function callGPTWhole(textEditor, textEditorEdit) {
    const wholeText = textEditor.document.getText()
    const uri = textEditor.document.uri
    const promptPath = await findPrompt(uri.fsPath)
    return await callGPTAndOpenEditor(wholeText, uri, promptPath)
}

// 選択範囲のテキストのみをGPTに添削させる
async function callGPTSelected(textEditor, textEditorEdit) {
    const selectedText = textEditor.document.getText(textEditor.selection)
    const uri = textEditor.document.uri
    const promptPath = await findPrompt(uri.fsPath)
    return await callGPTAndOpenEditor(selectedText, uri, promptPath)
}

///////////////////////////////////////////////////////////////////////////////
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand(`${EXT_NAME}.helloWorld`, helloWorld))
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(`${EXT_NAME}.callGPT`, callGPTWhole))
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(`${EXT_NAME}.callGPTSelected`, callGPTSelected))
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(`${EXT_NAME}.openPrompt`, openPrompt))
}

function deactivate() {
    return undefined
}

module.exports = { activate, deactivate }
