const vscode = require('vscode')
const { exists, modifiedDate, executeCommandToEditor, showBothCurrentAndNewFile, getEditorEndPos } = require('./common')
const { getPrompt, openPromptFile } = require('./prompt')
const { callGPTStream } = require('./callGPT')
const { callClaudeStream } = require('./callClaude')

const EXT_NAME = "simple-text-refine"

const DEFAULT_MODEL = "openai/gpt-3.5-turbo"

const MODELS = [
    "openai/gpt-4o",
    "openai/gpt-4-turbo",
    DEFAULT_MODEL,
    "anthropic/claude-3-opus-20240229",
    "anthropic/claude-3-sonnet-20240229",
    "anthropic/claude-3-haiku-20240307",
]

/**
 * vscode APIの設定を取得する
 * @param {string} key
 */
function getConfigValue(key) {
    return vscode.workspace.getConfiguration(EXT_NAME).get(key)
}
function getConfig(keys){
    const config = vscode.workspace.getConfiguration(EXT_NAME)
    return Object.fromEntries(keys.map(key => [key, config.get(key)]))
}

async function changeModel() {
    const list = MODELS.map(model => ({
        label: model,
        description: model === getConfigValue('model') ? '(current)' : ''
    }))
    const result = await vscode.window.showQuickPick(list);
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

    /** @type string */ // prompt_pathの取得
    const settingPromptPath = getConfigValue('prompt_path')

    return {settingPromptPath, apiKey, model, provider}
}

function makeCachePath(uri){
    const wf = vscode.workspace.workspaceFolders
    if(!wf){
        throw new Error('Error: workspace is not selected.')
    }
    const relPath = vscode.workspace.asRelativePath(uri)
    const cachePath = vscode.Uri.joinPath(wf[0].uri, '.vscode', EXT_NAME, 'cache', relPath)
    // mkdir
    vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(cachePath, '..'))
    return cachePath
}

async function openDiff(textEditor, textEditorEdit){
    const newUri = makeCachePath(textEditor.document.uri)
    if(!newUri) return

    // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、LLM応答をleftに表示する
    await vscode.commands.executeCommand('vscode.diff', newUri, textEditor.document.uri)
}

/**
 * @param {vscode.Uri} uri
 * @param {boolean} backup
 */
async function prepareResultFile(uri, backup) {
    const llmUri = makeCachePath(uri)

    if (backup && await exists(llmUri)) {
        // {llmUrl}.{modified time} にバックアップを取る
        const dateStr = await modifiedDate(llmUri)
        const backupUri = vscode.Uri.file(`${llmUri.path}.${dateStr}`)
        // renameだと既にエディタで開いている場合に追従してくる。それよりも最新ファイルを表示し続ける方が良いはずなので、copy
        await vscode.workspace.fs.copy(llmUri, backupUri, { overwrite: true })
    }

    const llmFile = vscode.Uri.file(llmUri.path)

    return [llmUri, llmFile]
}

/**
 * LLM応答を別ファイルに書き込み、vscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、LLM応答をleftに表示する
 * diffとして見えるように、元ファイルの選択範囲をLLM応答で置き換える形をとる
 * @param {vscode.TextEditor} editor
 * @param {boolean} backup
 * @param {string} selectedText
 * @param {string} wholeText
 */
async function prepareDiffWriter(editor, backup, selectedText, wholeText) {
    const uri = editor.document.uri
    const [llmUri, llmFile] = await prepareResultFile(uri, backup)
    const writer = async (llmText) => {
        const gptWholeText = wholeText.replace(selectedText, llmText)
        await vscode.workspace.fs.writeFile(llmFile, Buffer.from(gptWholeText))
    }
    await writer('')
    await vscode.commands.executeCommand('vscode.diff', llmUri, uri)
    return writer
}

/**
 * LLM応答を別ファイルに書き込み、通常のエディタ画面で表示する。diffに合わせて、左側に表示する
 * @param {vscode.TextEditor} editor
 * @param {boolean} backup
 */
async function prepareNormalWriter(editor, backup) {
    const uri = editor.document.uri
    const [llmUri, llmFile] = await prepareResultFile(uri, backup)
    const writer = async (llmText) => {
        await vscode.workspace.fs.writeFile(llmFile, Buffer.from(llmText))
    }
    await writer('')
    await showBothCurrentAndNewFile(llmUri, 'Left')
    return writer
}

/**
 * もとのファイルの選択範囲直後にLLM応答をappendする
 * 編集中のファイルなのでwriteFileではなくeditor.editを駆使して何とかする
 * LLM応答中に人間が編集してもLLM応答を書き込んでいる範囲を追跡して、正しく追記できるようにする
 * @param {vscode.TextEditor} editor
 */
async function prepareAppendWriter(editor) {
    // LLM応答の書き込み位置 (ファイル先頭からの文字数) を追従させる。初期値は選択範囲の最後
    let llmStartOffset = editor.document.offsetAt(editor.selection.end)
    let llmEndOffset = llmStartOffset

    // 人間の編集を検知してllmStart/EndOffsetを動かすイベンドハンドラを登録
    const handler = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document != editor.document) return;

        for (const change of event.contentChanges) {
            const diff = change.text.length - change.rangeLength

            if (change.rangeOffset < llmStartOffset) {
                // llmText部分を巻き込んで削除した場合、その分を補正する
                const deletedLlmTextLen = Math.max(change.rangeOffset + change.rangeLength - llmStartOffset, 0)
                llmStartOffset += diff + deletedLlmTextLen
            }

            if (change.rangeOffset < llmEndOffset) {
                // llmText部分を巻き込んで削除した場合、その分を補正する
                const deletedUserTextLen = Math.max(change.rangeOffset + change.rangeLength - llmEndOffset, 0)
                llmEndOffset += diff + deletedUserTextLen
            }
        }
    })

    // LLM応答を書き込む関数を作る
    const writer = async (llmText, last = false) => {
        // LLMテキストを更新。この操作でもイベントハンドラが呼ばれるが、if文に入らずoffsetは更新されない
        await editor.edit(editBuilder => {
            const start = editor.document.positionAt(llmStartOffset)
            const end   = editor.document.positionAt(llmEndOffset)
            editBuilder.replace(new vscode.Range(start, end), llmText)
        })

        // LLMテキストが挿入されたので、その分だけEndOffsetを更新
        const crlf = editor.document.eol === vscode.EndOfLine.CRLF
        const length = crlf ? llmText.replace(/\n/g, '\r\n').length : llmText.length
        llmEndOffset = llmStartOffset + length

        // イベントハンドラを解除
        if (last) handler.dispose()
    }

    return writer
}

/**
 * LLM書き込み先のファイルをEditorで開きつつ、LLM応答を書き込む関数を返す
 * @param {vscode.TextEditor} editor
 * @param {{backup: boolean, type: 'normal'|'diff'|'append'}} outputOpt
 * @param {string} selectedText
 * @param {string} wholeText
 */
async function prepareResultWriter(editor, outputOpt, selectedText, wholeText) {
    switch (outputOpt.type) {
        case 'diff':   return await prepareDiffWriter(editor, outputOpt.backup, selectedText, wholeText)
        case 'normal': return await prepareNormalWriter(editor, outputOpt.backup)
        case 'append': return await prepareAppendWriter(editor)
    }
}

const FUNC_TABLE = {
    "openai": callGPTStream,
    "anthropic": callClaudeStream,
}

/**
 * @param {vscode.TextEditor} textEditor
 * @param {vscode.TextEditorEdit} textEditorEdit
 * @returns
 */
async function callGPTAndOpenDiff(textEditor, textEditorEdit) {
    const wholeText = textEditor.document.getText()
    const selectedText = textEditor.document.getText(textEditor.selection)
    if(selectedText.length === 0) {
        vscode.window.showErrorMessage('No text selected')
        return
    }
    const uri = textEditor.document.uri
    const {settingPromptPath, apiKey, model, provider} = await setupParam(uri)

    const {description, output} = await getPrompt(settingPromptPath)

    const callLLMStream = FUNC_TABLE[provider]

    // LLM応答を格納するファイルを用意し表示する。diff表示か否かによって書き込む内容が変わるので、関数を作っておく
    const resultWriter = await prepareResultWriter(textEditor, output, selectedText, wholeText)

    let lastUpdated = null
    let gptText = ""
    let aborted = false

    await vscode.window.withProgress({
        title: `calling ${model}...: ${description}`,
        location: vscode.ProgressLocation.Notification,
        cancellable: true
    },
    async (progress, token) => {
        token.onCancellationRequested(() => { aborted = true })

        await callLLMStream(selectedText, description, apiKey, model, async (delta) => {
            if (aborted) throw new Error('Canceled')
            gptText += delta

            // ステータスバーには直近50文字だけ表示する
            const statusText = gptText.slice(-50).replace(/\n/g, ' ')
            vscode.window.setStatusBarMessage(statusText, 5000)

            // 2秒経過した場合に限りエディタ内も更新
            if (lastUpdated === null || Date.now() - lastUpdated > 2000) {
                await resultWriter(gptText + "\n")
                lastUpdated = Date.now()
            }
        })

        await resultWriter(gptText + "\n", true)
    })



    vscode.window.setStatusBarMessage('finished.', 5000)
}

async function openPrompt(textEditor, textEditorEdit){
    await openPromptFile(getConfig(['prompt_path']))
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

    // プロンプトファイルを開く
    context.subscriptions.push(vscode.commands.registerCommand(
        `${EXT_NAME}.openPrompt`,
        makeNotifyable(openPrompt)
    ))

    // 選択範囲のテキストのみをGPTに添削させる
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.callLLMSelected`,
        makeNotifyable(callGPTAndOpenDiff)
    ))

    // diffを表示する
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(
        `${EXT_NAME}.openDiff`,
        makeNotifyable(openDiff)
    ))
}

function deactivate() {
    return undefined
}

module.exports = { activate, deactivate }
