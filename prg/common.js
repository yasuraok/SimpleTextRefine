const vscode = require('vscode')

async function exists(uri){
    return await vscode.workspace.fs.stat(uri).then(() => true, () => false)
}

async function modifiedDate(uri){
    const mtime = (await vscode.workspace.fs.stat(uri)).mtime
    return (new Date(mtime)).toISOString()
}

/**
 * executeCommandはフォーカスが当たっているエディタに対してしかできないので、フォーカス外のエディタに何かする際には
 * フォーカス移動 → 何か操作 → フォーカス戻す という流れになる。この関数はその流れをまとめて行う
 * @param {vscode.TextEditor} editor
 * @param {string} commandString
 */
async function executeCommandToEditor(editor, commandString) {
    const origEditor = vscode.window.activeTextEditor
    if (!origEditor) return false
    await vscode.window.showTextDocument(editor.document, {viewColumn: editor.viewColumn})
    await vscode.commands.executeCommand(commandString)
    await vscode.window.showTextDocument(origEditor.document, {viewColumn: origEditor.viewColumn})
}


///////////////////////////////////////////////////////////////////////////////
// ファイルを開いたりエディタを分割したりは今のAPIだと非常に難解なのでいろいろメモしながらこのファイルにまとめる
// vscode.window.visibleTextEditors = 複数タブグループに分かれているときのそれぞれで今見えているEditor vscode.TextEditor[]
// vscode.window.activeTextEditor = 現在アクティブなエディタ vscode.TextEditor
// vscode.window.tabGroups.all = 分割された全てのタブグループ vscode.TabGroup[]
// vscode.window.tabGroups.activeTabGroup = 現在アクティブなタブグループ vscode.TabGroup
// vscode.window.showTextDocument = ファイルを開き表示する。同じタブグループ内で既に開いている場合はそこにフォーカスする (開いているが別グループの場合は無視され新規に開く)
// 「指定方向にタブグループが既にある場合にそれを使い、なければ作る」という操作がexecuteCommand経由でしかできなさそう
// workbench.action.moveEditorTo${direction}Groupの対象が現在フォーカスしているファイルなので面倒

/**
 * 現在フォーカスが当たっているエディタ (ファイル) を指定方向に移動する
 * @param {'Left'|'Right'|'Above'|'Below'} direction
 * @returns {Promise<boolean>} タブグループが増えたかどうか
 */
async function moveCurrentFileTo(direction){
    const origTabGroupNum = vscode.window.tabGroups.all.length
    await vscode.commands.executeCommand(`workbench.action.moveEditorTo${direction}Group`)
    const newTabGroupNum = vscode.window.tabGroups.all.length
    return newTabGroupNum != origTabGroupNum
}

/**
 * 引数のファイル現在のファイルを見比べられるように表示する
 * 1. 既に開いていて、かつ元ファイルと別のエディタグループにいる場合、そのエディタグループ内で前面に出す
 * 2. 開いていないか、あっても同じタブグループなら、必要に応じてエディタグループを作り、そこに表示する
 * @param {vscode.Uri} newFileUri
 * @param {'Above'|'Left'|'Right'|'Below'} direction
 * @param {boolean} focusOrig
 */
async function showBothCurrentAndNewFile(newFileUri, direction, focusOrig = true){
    // showTextDocumentを呼ぶと変化するので最初に取得しておく
    const origFileUri = vscode.window.activeTextEditor?.document.uri
    const origTabGroup = vscode.window.tabGroups.activeTabGroup

    // 1. そのファイルが別タブグループで開いていたら、それを前面に出して見えるようにする
    for (let tabGroup of vscode.window.tabGroups.all) {
        if (tabGroup === origTabGroup) continue
        for (let tab of tabGroup.tabs) {
            if (! (tab.input instanceof vscode.TabInputText)) continue
            if (tab.input.uri.fsPath === newFileUri.fsPath) {
                const opt =  {viewColumn: tabGroup.viewColumn, preserveFocus: focusOrig}
                return await vscode.window.showTextDocument(newFileUri, opt)
            }
        }
    }

    // 2. 開いていないか、あっても同じタブグループなら、必要に応じてエディタグループを作り、そこに表示する
    const editor = await vscode.window.showTextDocument(newFileUri) // llmUriを開きフォーカスする (元々activeTabGroupで開いている場合も結果は同じ)
    const groupAdded = await moveCurrentFileTo(direction) // そのファイルを別タブグループに動かす

    // フォーカスを維持したかった場合は戻す
    if (origFileUri && focusOrig) {
        // エディタグループが増えた場合はindexがズレているので、補正
        const isLeftOrAbove = ['Above', 'Left'].includes(direction)
        const viewColumn = origTabGroup.viewColumn + (groupAdded && isLeftOrAbove ? 1 : 0)
        await vscode.window.showTextDocument(origFileUri, {viewColumn, preserveFocus: false})
    }

    return editor
}

///////////////////////////////////////////////////////////////////////////////
// TextEditor周り

/**
 * @param {vscode.TextEditor} editor
 */
function getEditorEndPos(editor){
    let document = editor.document;
    let lastLine = document.lineAt(document.lineCount - 1);
    let lastCharPosition = lastLine.text.length;
    return new vscode.Position(document.lineCount - 1, lastCharPosition);
}

module.exports = { exists, modifiedDate, executeCommandToEditor, showBothCurrentAndNewFile, getEditorEndPos }
