const vscode = require('vscode')

async function exists(uri){
    return await vscode.workspace.fs.stat(uri).then(() => true, () => false)
}

async function modifiedDate(uri){
    const mtime = (await vscode.workspace.fs.stat(uri)).mtime
    return (new Date(mtime)).toISOString()
}

module.exports = { exists, modifiedDate }
