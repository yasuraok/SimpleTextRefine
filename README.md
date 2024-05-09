執筆系作業の添削補助ツール。  
テキスト選択範囲を LLM の API に渡して、応答を別ファイルに書き出し、diff viewer で差分表示する。  
システムプロンプトを予めファイルに複数書いておくことができ、LLM 呼び出し時に選択できる。毎回の LLM 呼び出しは独立。

OpenAI GPT と Anthropic Claude 3 に対応している。

![screenshot](assets/screenshot.png)

# 使い方
[クイックスタート](quickstart.md)を参照

## 使い方の補足
- 設定： openaiの他、simple-text-refine.api_key_anthropicに対応している。
- 設定： simple-text-refine.prompt_pathを指定すると、指定箇所のpromptファイルを参照できる。ファイルが存在しない場合は作成できる。
- 対象ファイル全体の記載内容を踏まえて LLM に問い合わせたり、workspace 全体の要約を LLM に付加情報として与えたり、という使い方は未対応。
- チャット UI や Inline Suggestion など他の拡張機能で賄えると思われる機能を実装する予定はない。
- この拡張機能による生成物 (プロンプトファイルと LLM 応答結果のテキストファイル) はすべて .vscode/simple-text-refine 以下に格納されるので、ここを .gitignore すれば git からは見えなくなる。リポジトリトップの .gitignore に書きづらければ、`echo '*' > .vscode/simple-text-refine/.gitignore` とするのがよい。

# 開発
## VSCode のどの機能を使って実現しているか
- editorcommand として各 LLM の API を叩けるようにする
- エディタ中の選択範囲をピックアップする
- GPT, Claude の応答を stream モードで受け、数秒おきにテンポラリファイルに書き込む
- LLM 応答と元ファイルを diffviewer で開く。現在の VSCode では左から右にしか矢印による diff 適用ができないので、元ファイルを右に配置する

選択範囲以外の部分はそのまま応答結果ファイルの方にも流し込んでおくことで、diff viewer とまともに見れるようにしてある。

## テスト実行
- .vscode/launch.json を書いてあるので、F5 を押したときに起動する

## ビルド → 配布
- `npx vsce package`
