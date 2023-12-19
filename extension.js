const vscode = require('vscode')

const { Buffer } = require('buffer')
const OpenAI = require('openai')


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

// テキストエディタの内容を置き換える
function replaceExample(wholeText, textEditor) {
    const newWholeText = wholeText.split(/\r?\n/).map(line => line.replace(/^\s+/,'')).join('\n')

    const wholeRange = new vscode.Range(
        textEditor.document.positionAt(0),
        textEditor.document.positionAt(wholeText.length)
    )
    textEditor.edit(editBuilder => editBuilder.replace(wholeRange, newWholeText))
}

// workspace直下にある.propt.txtというファイルの中身を読み込む
async function readPropTxt() {
    if(vscode.workspace.workspaceFolders){
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, '.prompt.txt');
        return (await vscode.workspace.openTextDocument(uri)).getText();
    }
}

async function makeSystem() {
    const prop = await readPropTxt()
    return {
        "role": "system",
        "content": prop,
    }
}

function makeContent(situation, text) {
    return [
        "## 背景事情",
        situation,
        "<!-- 背景事情ここまで -->",
        "## 投稿下書き",
        text,
        "<!-- 投稿下書きここまで -->",
    ].join('\n')
}

// openAI GPT APIを使って文章を添削する
// 使うエンドポイントはclient.chat.completions.create
async function gptExample(wholeText) {
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

    console.log({apiKey, openai})

    const userMessage = {
        role: 'user',
        content: makeContent("", wholeText)
    }

    const messages = [await makeSystem(), userMessage]
    console.log({messages})

    const res = await openai.chat.completions.create({
        model: MODEL,
        messages,
    })
    console.log(res)
    const content = res.choices[0].message.content
    console.log({content})
    return content
}

async function callGPT(textEditor, textEditorEdit) {
    const wholeText = textEditor.document.getText()

    // gptExampleを使って文章を添削する
    const newText = await gptExample(wholeText)

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
}

function deactivate() {
    return undefined
}

module.exports = { activate, deactivate }