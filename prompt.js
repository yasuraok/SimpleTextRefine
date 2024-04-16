const vscode = require('vscode')
const path = require('path')
const jsyaml = require('js-yaml')

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

async function exists(uri){
    return await vscode.workspace.fs.stat(uri).then(() => true, () => false)
}

// プロンプトを記載したファイルを探して返す。優先順位は以下の通り
// 1. workspace直下の.vscode/simple-text-refine/.prompt,
// 2. {ファイル名}.prompt,
// 3. (同じディレクトリの).prompt,
// 4. (親フォルダを再帰的に探索).prompt (workspace直下まで)
async function findPromptPath(filePath) {
    // 1の条件
    const wf = vscode.workspace.workspaceFolders
    if(wf){
        const wfPromptPath = vscode.Uri.joinPath(wf[0].uri, '.vscode', EXT_NAME, '.prompt')
        if (await exists(wfPromptPath)) {
            return wfPromptPath
        } else {
            // promptファイルが無いことを通知しつつ、作成を促す
            const selection = await vscode.window.showErrorMessage('.prompt not found', 'Create')
            if (selection === 'Create') {
                await vscode.workspace.fs.writeFile(wfPromptPath, Buffer.from(TEMPLATE))
                await openFileAbove(wfPromptPath)
                // promptを開いたのでその後の処理は中止
                throw new Error('Canceled (no notification)')
            }
        }
    }

    // 2の条件
    const promptFile = vscode.Uri.file(`${filePath}.prompt`)
    if (await exists(promptFile)) {
        return promptFile
    }

    // 3, 4の条件
    async function recursion(dir){
        const promptFile = vscode.Uri.file(path.join(dir, '.prompt'))
        const promptFileExists = await exists(promptFile)
        if (promptFileExists) {
            return promptFile
        } else {
            const parentDir = path.dirname(dir)
            return dir === parentDir ? null : recursion(parentDir)
        }
    }

    return recursion(path.dirname(filePath))
}

// promptファイルの中からQuickPickで使いたいプロンプトを選択するUIを出す
async function selectPrompt(srcPath) {
    const promptPath = await findPromptPath(srcPath)
    if(! promptPath) {
        throw new Error(`.prompt not found`)
    }
    const promptYaml = await vscode.workspace.openTextDocument(promptPath).then(doc => doc.getText())

    // yaml配列になっているのでそれをパース
    const prompts = jsyaml.load(promptYaml)
    if (!Array.isArray(prompts)) {
        throw new Error(`.prompt is not an YAML format array`)
    }

    // 選択肢をVSCodeのQuickPickで表示する
    const items = prompts.map(p => {
        // pは文字列か{label, description}のオブジェクト
        if (typeof p === 'string') {
            return {label: "", description: p}
        } else {
            let {label, description} = p
            if (typeof label !== 'string') label = ""
            if (typeof description !== 'string') description = ""
            return {label, description}
        }
    })
    const result = await vscode.window.showQuickPick(items);
    if (result) {
        return result.description
    } else {
        throw new Error('Canceled');
    }
}

async function openFileAbove(file){
    // 既に開かれているか調べる → 開かれていればそのファイルにフォーカスを移動する
    const allEditors = vscode.window.visibleTextEditors
    const openedEditor = allEditors.find(editor => editor.document.uri.fsPath === file.fsPath)
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
        const doc = await vscode.workspace.openTextDocument(file)
        await vscode.window.showTextDocument(doc)
    }
}

// promptファイルをエディタ画面で開く
async function openPrompt(textEditor, textEditorEdit) {
    const promptFile = await findPromptPath(textEditor.document.uri.fsPath)
    if (! promptFile) {
        vscode.window.showErrorMessage('.prompt not found')
        return
    }
    if (promptFile) {
        await openFileAbove(promptFile)
    }
}

module.exports = { openPrompt, selectPrompt }
