const vscode = require('vscode')
const { exists, modifiedDate, executeCommandToEditor, showBothCurrentAndNewFile } = require('./common')
const { getPrompt, openPromptFile } = require('./prompt')
const { encoding_for_model } = require('@dqbd/tiktoken')
const { callGPTStream } = require('./callGPT')
const { callClaudeStream } = require('./callClaude')

const EXT_NAME = "simple-text-refine"

const DEFAULT_MODEL = "openai/gpt-3.5-turbo"
const MAX_TOKENS_EACH_BLOCK = 96000 // < 128k

const MODELS = [
    "openai/gpt-4o",
    "openai/gpt-4-turbo",
    DEFAULT_MODEL,
    "anthropic/claude-3-opus-20240229",
    "anthropic/claude-3-sonnet-20240229",
    "anthropic/claude-3-haiku-20240307",
].map(label => ({label, description: ""}))

const enc = encoding_for_model('gpt-4o')

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

    return llmUri
}

// LLM書き込み先のファイルをEditorで開きつつ、LLM応答を書き込む関数を返す
async function prepareResultWriter(llmUri, uri, openAsDiff, selectedText, wholeText) {
    const llmFile = vscode.Uri.file(llmUri.path)

    if (openAsDiff) {
        // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、LLM応答をleftに表示する
        // diffとして見えるように、元ファイルの選択範囲をLLM応答で置き換える形をとる
        const writer = async (llmText) => {
            const gptWholeText = wholeText.replace(selectedText, llmText)
            await vscode.workspace.fs.writeFile(llmFile, Buffer.from(gptWholeText))
        }
        await writer('')
        await vscode.commands.executeCommand('vscode.diff', llmUri, uri)
        return writer

    } else {
        // そのファイルを通常のエディタ画面で開く
        const writer = async (llmText) => {
            await vscode.workspace.fs.writeFile(llmFile, Buffer.from(llmText))
        }
        await writer('')
        const editor = await showBothCurrentAndNewFile(llmUri, 'Left')
        await executeCommandToEditor(editor, 'workbench.action.files.setActiveEditorReadonlyInSession') // readonlyにしておく
        return writer
    }
}

// token数が多い場合に分割する
function splitByMaxToken(longText, pattern){
    // regexPatternにマッチする文字列の手前を分割点にしてテキストを分ける。全てのマッチで分割する
    function split(longText, pattern){
        const splitted = []
        let lastIndex = 0
        for(const match of longText.matchAll(new RegExp(pattern, 'gm'))){
            splitted.push(longText.slice(lastIndex, match.index))
            lastIndex = match.index
        }
        splitted.push(longText.slice(lastIndex))
        return splitted.filter(b => b.length > 0)
    }

    // maxTokenまでの範囲で
    function merge(splitted){
        let chunks = []
        let currentChunk = ""
        let currentTokens = 0
        for(const str of splitted){
            const numToken = enc.encode(str).length
            if(numToken > MAX_TOKENS_EACH_BLOCK){
                throw new Error('too long token')
            }
            if(currentTokens + numToken > MAX_TOKENS_EACH_BLOCK){
                chunks.push(currentChunk)
                currentChunk = str
                currentTokens = numToken
            } else {
                currentChunk += str
                currentTokens += numToken
            }
        }
        if(currentChunk.length > 0){
            chunks.push(currentChunk)
        }
        return chunks
    }

    return merge(split(longText, pattern))
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

    const prompt = await getPrompt(settingPromptPath, apiKey, selectedText)

    const callLLMStream = FUNC_TABLE[provider]

    // LLM応答を格納するファイルを用意し表示する。diff表示か否かによって書き込む内容が変わるので、関数を作っておく
    const llmUri = await prepareResultFile(uri, prompt.option.output.backup)
    const resultWriter = await prepareResultWriter(llmUri, uri, prompt.option.view.type === 'diff', selectedText, wholeText)

    let lastUpdated = null
    let gptText = ""

    const textChunks = splitByMaxToken(selectedText, '^- id: ')
    for (let chunk of textChunks){
        console.log('chunk:', chunk.length, 'tokens:', enc.encode(chunk).length)

        // callbackでgptの結果を受け取るが、頻度が高すぎるので
        // 5秒おきにcontentの内容をエディタに反映する周期処理を横で走らせる
        await callLLMStream(chunk, prompt.text, apiKey, model, (delta) => {
            gptText += delta

            // ステータスバーには直近50文字だけ表示する
            const statusText = gptText.slice(-50).replace(/\n/g, ' ')
            vscode.window.setStatusBarMessage(statusText, 5000)

            // 2秒経過した場合に限りエディタ内も更新
            if (lastUpdated === null || Date.now() - lastUpdated > 2000) {
                resultWriter(gptText + "\n")
                lastUpdated = Date.now()
            }
        })
    }
    resultWriter(gptText + "\n")

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
