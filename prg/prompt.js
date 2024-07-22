const vscode = require('vscode')
const jsyaml = require('js-yaml')

const { exists, showBothCurrentAndNewFile } = require('./common')
const { parse, PromptArray, Prompt } = require('./type')

const EXT_NAME = "simple-text-refine"

const TEMPLATE = `
- label: チャット
  description: |
    質問にできるだけ技術的に正確に回答してください。
    明確に質問がある場合はそれに対する回答を、何かしら情報を整理していると思われる文章の場合は、その続きに相当する情報を返答してください。
    長くても500字くらいに収めてください。
  output:
    type: append
- label: 添削
  description: |
    作成中の技術文書を添削し修正案を返してください。
    文中で<<と>>で囲まれた部分はあなたへの指示であり、またXXXと書かれた部分はあなたに埋めて欲しい箇所です。
    メモ書きのようになっている箇所に対しては、自然な文章になるように補正してください。
    その際、箇条書きを地の文に変更したり、適当な見出しを追加するなどの形式変更もしてかまいません。
- label: メール
  description: |
    メールやチャットの投稿下書きを書いているユーザーから作成中の文章が与えられるので、添削し修正案を返してください。
    書き始めで文章が不足していたり不連続と思われる場合はそれを補完し、ほぼ完成している場合は文体の改善などをメインに修正してください。
`.trimStart()

const PROMPT_PTAH_NOT_CONFIGURED = 'workspace is unselected and the default prompt path is not configured.'

/**
 * プロンプトのパスを取得する。
 * @returns {vscode.Uri | null}
 */
function resolvePromptPath(configPath) {
    if (configPath){
        // configで指定があればそれを取得
        return vscode.Uri.file(configPath)

    } else {
        // デフォルトプロンプトのパスを返す。具体的にはworkspace直下の.vscode/simple-text-refine/.prompt,
        const wf = vscode.workspace.workspaceFolders
        if (!wf || !wf.length) return null
        return vscode.Uri.joinPath(wf[0].uri, '.vscode', EXT_NAME, '.prompt')
    }
}

/**
 * 指定されたパスにプロンプトを作成する
 * @param {vscode.Uri} requestedPath
 */
async function createAndOpenPromptFile(requestedPath) {
    await vscode.workspace.fs.writeFile(requestedPath, Buffer.from(TEMPLATE))
    await showBothCurrentAndNewFile(requestedPath, 'Above', false)
}

async function selectPromptObj(promptYaml) {
    // Parse and check if it's array
    const prompts = parse(PromptArray, jsyaml.load(promptYaml))

    // Display the choices at VSCode QuickPick
    const items = prompts.map(p => {
        // p is either a string or an object with {label, description}
        if (typeof p === 'string') {
            return parse(Prompt, {label: "", description: p})
        } else {
            return p
        }
    })
    const result = await vscode.window.showQuickPick(items);
    if (result) {
        return result
    } else {
        throw new Error('Canceled');
    }
}

/**
 * askになっているオプションを選択する
 * @param { import('./type').PromptType} prompt
 */
async function resolvePromptOption(prompt) {
    let outputType = /** @type {string} */ (prompt.output.type)

    // askの場合quickpickで都度選択
    if (outputType === 'ask'){
        const options = ['normal', 'diff', 'append']
        const selected = await vscode.window.showQuickPick(options)
        if (!selected) throw new Error('Canceled')
        outputType = selected
    }

    return {
        ...prompt,
        output: { ...prompt.output,
            type: /**@type {'normal'|'diff'|'append'} */ (outputType)
        }
    }
}


/**
 * @param {string} settingPromptPath
 * @return {Promise<{description: string, output: {backup: boolean, type: 'normal'|'diff'|'append'}}>}
 */
async function getPrompt(settingPromptPath) {
    // Find and open prompt file
    const promptPath = await resolvePromptPath(settingPromptPath)

    if (!promptPath) {
        // prompt fileのパスが定まらない → 最もデフォルトで動作させようとした場合の設定で続行
        vscode.window.showWarningMessage(`No system prompt provided: ${PROMPT_PTAH_NOT_CONFIGURED}`)
        return { description: '', output: { type: 'append', backup: false } }

    } else if (! (await exists(promptPath))){
        // prompt fileがない → 作成を促しつつ実行 (LLM呼び出しは続行するのでawaitしない)
        vscode.window.showWarningMessage(`No system prompt provided: file not found [${promptPath}]`, 'Create').then(selection => {
            if (selection === 'Create') return createAndOpenPromptFile(promptPath)
        })
        return { description: '', output: { type: 'append', backup: false } }

    } else {
        // prompt fileがある → 選択して実行
        const promptYaml = await vscode.workspace.openTextDocument(promptPath).then(doc => doc.getText())
        // Display a UI to select the desired prompt from within the .prompt file for use with QuickPick
        const promptObj = await selectPromptObj(promptYaml)
        return await resolvePromptOption(promptObj)
    }
}

// promptファイルをエディタ画面で開く
async function openPromptFile(config) {
    const promptPath = await resolvePromptPath(config.prompt_path)

    if(!promptPath) {
        // prompt fileのパスが定まらない → エラー表示
        throw new Error(`Failed to open prompt file: ${PROMPT_PTAH_NOT_CONFIGURED}`)

    } else if (! await exists(promptPath)) {
        // promptファイルが無い: 通知しつつ作成を促す
        const selection = await vscode.window.showErrorMessage(`Prompt not found [${promptPath}]`, 'Create')
        if (selection === 'Create') await createAndOpenPromptFile(promptPath)

    } else {
        // promptファイルがある: 開く
        await showBothCurrentAndNewFile(promptPath, 'Above', false)
    }
}

module.exports = { openPromptFile, getPrompt }
