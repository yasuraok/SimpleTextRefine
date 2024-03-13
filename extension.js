const vscode = require('vscode')
const { callGPT } = require('./callGPT')
const { findPrompt, openPrompt } = require('./prompt')

const EXT_NAME = "simple-text-refine-with-gpt"

const DEFAULT_MODEL = "gpt-3.5-turbo"

const MODELS = [
    { label: DEFAULT_MODEL, description: "" },
    { label: "gpt-4-turbo-preview", description: "" },
]

// vscode APIの設定を取得する
function getConfigValue(key) {
    const config = vscode.workspace.getConfiguration(EXT_NAME)
    return config.get(key)
}

async function changeModel() {
    const result = await vscode.window.showQuickPick(MODELS);
    if (result) {
        // vscodeの設定にmodelを保存する
        const config = vscode.workspace.getConfiguration(EXT_NAME)
        config.update('model', result.label, vscode.ConfigurationTarget.Global)
        vscode.window.showInformationMessage(`Changed model to ${result.label}`)
    }
}

async function callGPTAndOpenEditor(text, uri){
    const promptPath = await findPrompt(uri.fsPath)
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

    if(! promptPath) {
        vscode.window.showErrorMessage('.prompt not found')
    }
    const promptText = await vscode.workspace.openTextDocument(promptPath).then(doc => doc.getText())

    return await callGPT(text, promptText, apiKey, model)
}

async function openDiff(textEditor, textEditorEdit){
    // GPTの応答は*.gptという名前のファイルに書き込まれている
    const uri = textEditor.document.uri
    const newUri = uri.with({path: uri.path + '.gpt'})
    // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、gptExampleの結果をleftに表示する
    await vscode.commands.executeCommand('vscode.diff', newUri, uri)
}

///////////////////////////////////////////////////////////////////////////////
function activate(context) {
    // テスト
    context.subscriptions.push(vscode.commands.registerCommand(
        `${EXT_NAME}.helloWorld`,
        () => {
            vscode.window.showInformationMessage('Hello, world!')
        }
    ))

    // モデルを変更する
    context.subscriptions.push(vscode.commands.registerCommand(
        `${EXT_NAME}.changeModel`,
        changeModel
    ))

    // ファイル全体をGPTに添削させる
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.callGPT`,
        async (textEditor, textEditorEdit) => {
            const wholeText = textEditor.document.getText()
            const uri = textEditor.document.uri
            const gptText = await callGPTAndOpenEditor(wholeText, uri)

            // GPTの応答を*.gptという名前のファイルに書き込む
            const newUri = uri.with({path: uri.path + '.gpt'})
            const newFile = vscode.Uri.file(newUri.path)
            await vscode.workspace.fs.writeFile(newFile, Buffer.from(gptText))

            // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、gptExampleの結果をleftに表示する
            await vscode.commands.executeCommand('vscode.diff', newUri, uri)

            // // そのファイルを別タブとして開く
            // const doc = await vscode.workspace.openTextDocument(newUri)
            // await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside)
        }
    ))

    // 選択範囲のテキストのみをGPTに添削させる
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.callGPTSelected`,
        async (textEditor, textEditorEdit) => {
            const selectedText = textEditor.document.getText(textEditor.selection)
            if(selectedText.length === 0) {
                vscode.window.showErrorMessage('No text selected')
                return
            }
            const uri = textEditor.document.uri
            const gptText = await callGPTAndOpenEditor(selectedText, uri)

            // 選択範囲をGPT応答に差し替えて、*.gptという名前のファイルに書き込む
            const newUri = uri.with({path: uri.path + '.gpt'})
            const newFile = vscode.Uri.file(newUri.path)
            const gptWholeText = textEditor.document.getText().replace(selectedText, gptText)
            await vscode.workspace.fs.writeFile(newFile, Buffer.from(gptWholeText))

            // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、gptExampleの結果をleftに表示する
            await vscode.commands.executeCommand('vscode.diff', newUri, uri)

            // // そのファイルを別タブとして開く
            // const doc = await vscode.workspace.openTextDocument(newUri)
            // await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside)
        }
    ))

    // プロンプトファイルを開く
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.openPrompt`,
        openPrompt
    ))

    // diffを表示する
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.openDiff`,
        openDiff
    ))
}

function deactivate() {
    return undefined
}

module.exports = { activate, deactivate }
