const vscode = require('vscode')
const { callGPTAndOpenEditor } = require('./callGPT')
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

async function callGPT(text, uri){
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

    return await callGPTAndOpenEditor(text, uri, promptText, apiKey, model)
}

///////////////////////////////////////////////////////////////////////////////
function activate(context) {
    // テスト
    context.subscriptions.push(vscode.commands.registerCommand(
        `${EXT_NAME}.helloWorld`, () => {
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
            return await callGPTAndOpenEditor(wholeText, uri)
        }
    ))

    // 選択範囲のテキストのみをGPTに添削させる
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.callGPTSelected`,
        async (textEditor, textEditorEdit) => {
            const selectedText = textEditor.document.getText(textEditor.selection)
            const uri = textEditor.document.uri
            return await callGPT(selectedText, uri)
        }
    ))

    // プロンプトファイルを開く
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.openPrompt`,
        openPrompt
    ))
}

function deactivate() {
    return undefined
}

module.exports = { activate, deactivate }
