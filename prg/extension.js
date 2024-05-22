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
].map(label => ({label, description: ""}))

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

function __throw(e){ throw e }

/**
 * LLM書き込み先のファイルをEditorで開きつつ、LLM応答を書き込む関数を返す
 * @param {vscode.TextEditor} editor
 * @param {{backup: boolean, type: 'normal'|'diff'|'append'}} outputOpt
 * @param {string} selectedText
 * @param {string} wholeText
 * @returns
 */
async function prepareResultWriter(editor, outputOpt, selectedText, wholeText) {
    const uri = editor.document.uri

    switch (outputOpt.type) {
        case 'diff': {
            // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、LLM応答をleftに表示する
            // diffとして見えるように、元ファイルの選択範囲をLLM応答で置き換える形をとる
            const [llmUri, llmFile] = await prepareResultFile(uri, outputOpt.backup)
            const writer = async (llmText) => {
                const gptWholeText = wholeText.replace(selectedText, llmText)
                await vscode.workspace.fs.writeFile(llmFile, Buffer.from(gptWholeText))
            }
            await writer('')
            await vscode.commands.executeCommand('vscode.diff', llmUri, uri)
            return writer
        }
        case 'normal': {
            // そのファイルを通常のエディタ画面で開く
            const [llmUri, llmFile] = await prepareResultFile(uri, outputOpt.backup)
            const writer = async (llmText) => {
                await vscode.workspace.fs.writeFile(llmFile, Buffer.from(llmText))
            }
            await writer('')
            await showBothCurrentAndNewFile(llmUri, 'Left')
            return writer
        }
        case 'append': {
            // もとのファイルの選択範囲直後にLLM応答をappendする
            // 編集中のファイルなのでwriteFileではなくeditor.editを駆使して何とかする
            // LLM応答中に人間が編集できないようにreadonlyにするが、editor.editも効かなくなってしまうので、瞬間的に解除する
            // 隙間のタイミングで一瞬だけ編集できた場合にPositionがズレるので、ファイル全体を置換し続ける

            // 人間が編集しない前提なら、以下のようなコードで変更部分だけを差し替えていくことが可能
            // const prevRange = new vscode.Range(llmStartPos, prevEndPos)
            // await editor.edit(editBuilder => {
            //     editBuilder.replace(prevRange, llmText)
            // })
            // const splitText = llmText.split('\n')
            // prevEndPos = llmStartPos.translate({
            //     lineDelta: splitText.length - 1,
            //     characterDelta: 0
            // })

            await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession')
            const s = new vscode.Position(0, 0)
            const e = getEditorEndPos(editor)
            const beforeText = editor.document.getText(new vscode.Range(s, editor.selection.end))
            const afterText  = editor.document.getText(new vscode.Range(editor.selection.end, e))

            const writer = async (llmText, finished) => {
                await vscode.commands.executeCommand('workbench.action.files.resetActiveEditorReadonlyInSession')
                await editor.edit(editBuilder => {
                    const s = new vscode.Position(0, 0)
                    const e = getEditorEndPos(editor)
                    if (! beforeText && ! afterText) {
                    }
                    editBuilder.replace(new vscode.Range(s, e), beforeText + llmText + afterText)
                })
                if (! finished) {
                    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession')
                }
            }
            return writer
        }
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

            // 直近50文字だけ表示する
            const statusText = gptText.slice(-50).replace(/\n/g, ' ')
            progress.report({ message: statusText });

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
