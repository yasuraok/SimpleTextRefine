const vscode = require('vscode')

const { Buffer } = require('buffer')
const OpenAI = require('openai')

const { diff_match_patch } = require('diff-match-patch')

const EXT_NAME = "simple-text-refine-with-gpt"

const MODEL = "gpt-3.5-turbo-1106"

// vscode APIの設定としてAPI_KEYを設定・取得する
function getAPIKey() {
    const config = vscode.workspace.getConfiguration(EXT_NAME)
    const apikey = config.get('api_key')
    if (apikey === undefined) {
        vscode.window.showErrorMessage('API Key is not set')
        return
    }
    return apikey
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
// openaiが提供するライブラリがあるならそれを使う
async function gptExample(wholeText) {
    const apiKey = getAPIKey()
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

    // そのファイルを別タブとして開く
    const doc = await vscode.workspace.openTextDocument(newUri)
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside)
}

///////////////////////////////////////////////////////////////////////////////
// https://qiita.com/yoshi389111/items/8dca20680eb79f01cb2c

const decorationTypeA = vscode.window.createTextEditorDecorationType({
    color: "#FFB6B6",
});
const decorationTypeB = vscode.window.createTextEditorDecorationType({
    color: "#CCFFCC",
});

function diffToPosition(diff) {
    const pos_a = [], pos_b = []
    let last_a = 0
    let last_b = 0
    diff.forEach(chunk => {
        const [op, s] = chunk
        const l = s.length

        if(op < 0){ pos_a.push([last_a, last_a + l]) }
        if(op > 0){ pos_b.push([last_b, last_b + l]) }
        if(op <= 0){ last_a += l }
        if(op >= 0){ last_b += l }
    })
    return [pos_a, pos_b]
}

const setDecorations = (editor, positions, decorationType) => {
    editor.setDecorations(decorationType, positions.map(p => {
        const [bgn, end] = p
        return new vscode.Range(
            editor.document.positionAt(bgn),
            editor.document.positionAt(end)
        )
    }))
}

async function updateDecorationsIfPossible() {
    const editor = vscode.window.activeTextEditor;
    if (! editor) return
    const text = editor.document.getText()

    // editorのファイル名の末尾に.gptをつけたファイルがあればそれを開く
    const gptUri = editor.document.uri.with({path: editor.document.uri.path + '.gpt'})

    // gptUriのファイルが実在するかチェック
    try {
        await vscode.workspace.fs.stat(gptUri)
    } catch (e) {
        return
    }

    const gptText = (await vscode.workspace.openTextDocument(gptUri)).getText()

    const dmp = new diff_match_patch()
    // console.log({dmp})
    const diff = dmp.diff_main(text, gptText)
    dmp.diff_cleanupSemantic(diff)
    // console.log({diff})

    // diff_match_patchの結果は差分のある文字列のリストだが、
    // それを元文書の位置情報に変換する
    const [pos_a, pos_b] = diffToPosition(diff)
    console.log({pos_a})

    setDecorations(editor, pos_a, decorationTypeA)

    vscode.window.visibleTextEditors.forEach(editor => {
        if( editor.document.uri.toString() === gptUri.toString() ){
            setDecorations(editor, pos_b, decorationTypeB)
        }
    })
}

let timeout = undefined;
function triggerUpdateDecorations(throttle = false) {
    if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
    }
    if (throttle) {
        timeout = setTimeout(updateDecorationsIfPossible, 100);
    } else {
        updateDecorationsIfPossible();
    }
}


///////////////////////////////////////////////////////////////////////////////
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand(`${EXT_NAME}.helloWorld`, helloWorld))
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(`${EXT_NAME}.callGPT`, callGPT))

    triggerUpdateDecorations();

    vscode.window.onDidChangeActiveTextEditor(_editor => {
        console.log("onDidChangeActiveTextEditor");
        triggerUpdateDecorations();
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        console.log("onDidChangeTextDocument");
        if (event.document === vscode.window.activeTextEditor?.document) {
            triggerUpdateDecorations(true);
        }
    }, null, context.subscriptions);
}

function deactivate() {
    return undefined
}

module.exports = { activate, deactivate }