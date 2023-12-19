const vscode = require('vscode')

const { Buffer } = require('buffer')
const OpenAI = require('openai')

const path = require('path')

const EXT_NAME = "simple-text-refine-with-gpt"

const MODEL = "gpt-3.5-turbo-1106"

// vscode APIの設定としてAPI_KEYを設定・取得する
function getAPIKey() {
    const config = vscode.workspace.getConfiguration(EXT_NAME)
    return config.get('api_key')
}

function helloWorld() {
    vscode.window.showInformationMessage('Hello, world!')
}

// workspace直下にある.propt.txtというファイルの中身を読み込む
async function readPropTxt() {
    if(vscode.workspace.workspaceFolders){
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, '.prompt.txt');
        return (await vscode.workspace.openTextDocument(uri)).getText();
    }
}

async function makeSystem(prompt) {
    return {
        "role": "system",
        "content": prompt,
    }
}

function makeUserMessage(situation, text) {
    const content = [
        "## 背景事情",
        situation,
        "<!-- 背景事情ここまで -->",
        "## 投稿下書き",
        text,
        "<!-- 投稿下書きここまで -->",
    ].join('\n')

    return {
        role: 'user',
        content,
    }
}

// openAI GPT APIを使って文章を添削する
// 使うエンドポイントはclient.chat.completions.create
async function gptExample(wholeText, filePath) {
    const apiKey = getAPIKey()
    if (! apiKey) {
        // 設定画面を開くリンクを含むnotificationを表示する
        vscode.window.showErrorMessage('API Key is not set', 'Open Settings').then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', EXT_NAME)
            }
        })
    }
    const openai = new OpenAI({apiKey})

    const promptFile = await findPrompt(filePath)
    if(! promptFile) {
        vscode.window.showErrorMessage('.prompt not found')
    }
    const prompt = await vscode.workspace.openTextDocument(promptFile).then(doc => doc.getText())

    const messages = [await makeSystem(prompt), makeUserMessage("", wholeText)]
    console.log({messages})
    vscode.window.showInformationMessage(`calling GPT...: ${messages}`)

    const res = await openai.chat.completions.create({
        model: MODEL,
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

async function callGPT(textEditor, textEditorEdit) {
    const wholeText = textEditor.document.getText()

    // gptExampleを使って文章を添削する
    const newText = await gptExample(wholeText, textEditor.document.uri.fsPath)

    // ファイルファイルの複製を*.gptという名前で作り、newTextの内容を書き込む
    const newUri = textEditor.document.uri.with({path: textEditor.document.uri.path + '.gpt'})
    const newFile = vscode.Uri.file(newUri.path)
    await vscode.workspace.fs.writeFile(newFile, Buffer.from(newText))

    // そのファイルをvscode.diffで表示する。現時点ではleft -> right方向だけdiffを適用できるので、gptExampleの結果をleftに表示する
    await vscode.commands.executeCommand('vscode.diff', newUri, textEditor.document.uri)

    // // そのファイルを別タブとして開く
    // const doc = await vscode.workspace.openTextDocument(newUri)
    // await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside)
}

///////////////////////////////////////////////////////////////////////////////
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand(`${EXT_NAME}.helloWorld`, helloWorld))
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(`${EXT_NAME}.callGPT`, callGPT))
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(`${EXT_NAME}.openPrompt`, openPrompt))
}

function deactivate() {
    return undefined
}

module.exports = { activate, deactivate }