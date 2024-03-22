const vscode = require('vscode')
const { selectPrompt, openPrompt } = require('./prompt')
const { callGPTStream } = require('./callGPT')
const { callClaudeStream } = require('./callClaude')

const EXT_NAME = "simple-text-refine-with-gpt"

const DEFAULT_MODEL = "openai/gpt-3.5-turbo"

const MODELS = [
    DEFAULT_MODEL,
    "openai/gpt-4-turbo-preview",
    "anthropic/claude-3-opus-20240229",
    "anthropic/claude-3-sonnet-20240229",
    "anthropic/claude-3-haiku-20240307",
].map(label => ({label, description: ""}))

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

async function setupParam(uri){
    const providerModel = getConfigValue('model') || DEFAULT_MODEL
    const [provider, model] = providerModel.split('/')

    // apiKeyの取得
    const apiKey = getConfigValue(`api_key_${provider}`)
    if (! apiKey) {
        // 設定画面を開くリンクを含むnotificationを表示する
        vscode.window.showErrorMessage('API Key is not set', 'Open Settings').then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', EXT_NAME)
            }
        })
    }

    // promptの取得
    const promptText = await selectPrompt(uri.fsPath)

    return {promptText, apiKey, model, provider}
}

async function openDiff(textEditor, textEditorEdit){
    // GPTの応答は*.gptという名前のファイルに書き込まれている
    const uri = textEditor.document.uri
    const newUri = uri.with({path: uri.path + '.gpt'})
    // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、gptExampleの結果をleftに表示する
    await vscode.commands.executeCommand('vscode.diff', newUri, uri)
}

async function showGPTResult(gptText, uri, selectedText, wholeText, openDiff) {
    // 選択範囲をGPT応答に差し替えて、*.gptという名前のファイルに書き込む
    const newUri = uri.with({path: uri.path + '.gpt'})
    const newFile = vscode.Uri.file(newUri.path)
    const gptWholeText = wholeText.replace(selectedText, gptText)
    await vscode.workspace.fs.writeFile(newFile, Buffer.from(gptWholeText))

    // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、gptExampleの結果をleftに表示する
    if (openDiff){
        await vscode.commands.executeCommand('vscode.diff', newUri, uri)
    }
}


const FUNC_TABLE = {
    "openai": callGPTStream,
    "anthropic": callClaudeStream,
}

async function callGPTAndOpenDiff(textEditor, textEditorEdit) {
    const wholeText = textEditor.document.getText()
    const selectedText = textEditor.document.getText(textEditor.selection)
    if(selectedText.length === 0) {
        vscode.window.showErrorMessage('No text selected')
        return
    }
    const uri = textEditor.document.uri
    const {promptText, apiKey, model, provider} = await setupParam(uri)

    const callLLMStream = FUNC_TABLE[provider]

    // callbackでgptの結果を受け取るが、頻度が高すぎるので
    // 5秒おきにcontentの内容をエディタに反映する周期処理を横で走らせる
    let lastUpdated = null
    let diffShown = false
    let gptText = ""
    await callLLMStream(selectedText, promptText, apiKey, model, (delta) => {
        gptText += delta

        // ステータスバーには直近50文字だけ表示する
        const statusText = gptText.slice(-50).replace(/\n/g, ' ')
        vscode.window.setStatusBarMessage(statusText, 5000)

        // 2秒経過した場合に限りエディタ内も更新
        if (lastUpdated === null || Date.now() - lastUpdated > 2000) {
            showGPTResult(gptText + "\n", uri, selectedText, wholeText, !diffShown)
            diffShown = true
            lastUpdated = Date.now()
        }
    })
    showGPTResult(gptText, uri, selectedText, wholeText, !diffShown)

    vscode.window.setStatusBarMessage('finished.', 5000)
}

function makeNotifyable(func){
    return async function (textEditor, textEditorEdit){
        try{
            await func(textEditor, textEditorEdit)
        } catch (e) {
            if(e.message.startsWith('Canceled')) {
                // noop
            }else{
                vscode.window.showErrorMessage(e.message)
            }
        }
    }
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

    // 選択範囲のテキストのみをGPTに添削させる
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.callGPTSelected`,
        makeNotifyable(callGPTAndOpenDiff)
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
