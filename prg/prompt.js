const vscode = require('vscode')
const jsyaml = require('js-yaml')

const { exists, showBothCurrentAndNewFile } = require('./common')
const { validate, PromptOption } = require('./type')

const EXT_NAME = "simple-text-refine"

const TEMPLATE = `
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

// デフォルトプロンプトのパスを返す。具体的にはworkspace直下の.vscode/simple-text-refine/.prompt,
function getDefaultPromptPath() {
    const wf = vscode.workspace.workspaceFolders
    if (!wf || !wf.length) return null
    return vscode.Uri.joinPath(wf[0].uri, '.vscode', EXT_NAME, '.prompt')
}

// プロンプトのパスを取得する。指定されたパスが存在しない場合は作成を促す
async function resolvePromptPath(configPath) {
    // configで指定があればそれを、そうでなければdefaultを取得
    const requestedPath = configPath ? vscode.Uri.file(configPath) : getDefaultPromptPath()

    if (! requestedPath) {
        // promptファイルのpath自体が決定不能
        throw new Error('Failed to open prompt file: workspace is not selected.')
    }

    if (! await exists(requestedPath)) {
        // promptファイルが無い: 通知しつつ作成を促す
        const selection = await vscode.window.showErrorMessage(`Prompt not found [${requestedPath}]`, 'Create')
        if (selection === 'Create') {
            await vscode.workspace.fs.writeFile(requestedPath, Buffer.from(TEMPLATE))
            await showBothCurrentAndNewFile(requestedPath, 'Above', false)
        }
        // promptを開いたかどうかに関わらずその後の処理は中止 (通知は済んでるのでnotificationなし)
        throw new Error('Canceled')
    }

    return requestedPath
}

async function selectPromptObj(promptYaml) {
    // Parse and check if it's array
    const prompts = jsyaml.load(promptYaml)
    if (!Array.isArray(prompts)) {
        throw new Error(`.prompt is not an YAML format array`)
    }

    // Display the choices at VSCode QuickPick
    const items = prompts.map(p => {
        // p is either a string or an object with {label, description}
        if (typeof p === 'string') {
            return {label: "", description: p}
        } else {
            // force convert string
            if (typeof p.label !== 'string') p.label = p.label?.toString() || ""
            if (typeof p.description !== 'string') p.description = p.description?.toString() || ""
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
 * @param {string} settingPromptPath
 * @param {string} text
 * @param {string} apiKey
 */
async function getPrompt(settingPromptPath, apiKey, text) {
    // Find and open prompt file
    const promptPath = await resolvePromptPath(settingPromptPath)
    const promptYaml = await vscode.workspace.openTextDocument(promptPath).then(doc => doc.getText())
    // Display a UI to select the desired prompt from within the .prompt file for use with QuickPick
    const promptObj = await selectPromptObj(promptYaml)

    const option = validate(PromptOption, promptObj)
    return {text:promptObj.description, option}
}

// promptファイルをエディタ画面で開く
async function openPromptFile(config) {
    const promptPath = await resolvePromptPath(config.prompt_path)
    await showBothCurrentAndNewFile(promptPath, 'Above', false)
}

module.exports = { openPromptFile, getPrompt }
