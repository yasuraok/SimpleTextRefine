執筆系作業の添削補助ツール。編集中ファイルのテキスト選択範囲を LLM の API に渡して、応答を3種類の方法で出力する: 

1. append: そのファイルに追記 (append)
2. diff: 別ファイルに書き出し diff として表示
3. normal: 別ファイルに書き出し diff ではなく独立したエディタで開く

システムプロンプトを予めファイルに複数書いておくことができ、LLM 呼び出し時に選択できる。毎回の LLM 呼び出しは独立。

OpenAI GPT と Anthropic Claude 3 に対応している。VSCode のファイルとして LLM 応答を書き出すようにしているので、[ファイル履歴](https://code.visualstudio.com/updates/v1_66#_local-history) のような VSCode 本体の機能と組み合わせやすい。

![screenshot](assets/screenshot.png)

# 使い方
簡易な使い方は[クイックスタート](quickstart.md)を参照。

## 基本的な使い方
1. (初回のみ) 各サービスの API Key を設定する。設定画面を開き (Ctrl + ,)、simple-text-refine で絞り込むと、以下の2つの設定項目があるので、必要に応じて入力する。(注意: API Keyを設定に記録するのは最善でない。将来的に改善予定)
   - simple-text-refine.api_key_openai
   - simple-text-refine.api_key_anthropic
2. workspace 以下の適当なフォルダの適当なファイルを開き、適当な文章を記入する。
3. prompt を作成する。コマンドパレット (Ctrl + Shift + P) で「prompt」と入力すると「Simple Text Refine: open prompt file」という項目が現れるので、選択する。
   初回はファイルが無い旨のエラーが出るが、その通知中の Create ボタンを押すことで雛型を作成できる。prompt ファイルは .vscode 以下に保存される。
4. LLM のモデルを選択する。コマンドパレットを再度開き「change model」と入力すると、使用するモデルが選択できる。両社の主要モデルが選択可能だが、当然 API Key が必要である。
5. LLM を呼び出す。
   1. 開いているファイルのうち、LLM に渡したいテキスト部分をエディタ内で選択状態にする。
   2. コマンドパレットを開き「call LLM」と入力すると「Simple Text Refine: call LLM with selected text」という項目が現れるので、選択する。
   3. 続いて、3.で作成したプロンプトを選択するダイアログが表示されるので、目的のプロンプトを選択する。
   4. LLM の呼び出しが開始する。応答がリアルタイムにテンポラリファイルに書き出され、そのファイルとの diff 表示画面が開く。
6. LLM 応答を見て、必要に応じて元ファイルを編集する (diff 画面上の左が LLM 応答で、セパレータ部分にある→を使うことで元ファイルに LLM 応答を流し込むことができる)

プロンプトは以下のようなyaml形式で記載すること。

```yml
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
```

## その他補足
- 対象ファイル全体の記載内容を踏まえて LLM に問い合わせたり、workspace 全体の要約を LLM に付加情報として与えたり、という使い方は未対応。
- チャット UI や Inline Suggestion など他の拡張機能で賄えると思われる機能を実装する予定はない。
- この拡張機能による生成物 (プロンプトファイルと LLM 応答結果のテキストファイル) はすべて .vscode/simple-text-refine 以下に格納されるので、ここを .gitignore すれば git からは見えなくなる。リポジトリトップの .gitignore に書きづらければ、`echo '*' > .vscode/simple-text-refine/.gitignore` とするのがよい。


# 開発
## VSCode のどの機能を使って実現しているか
- editorcommand として各 LLM の API を叩けるようにする
- エディタ中の選択範囲をピックアップする
- GPT, Claude の応答を stream モードで受け、数秒おきにテンポラリファイルに書き込む
- LLM 応答と元ファイルを diffviewer で開く。現在の VSCode では左から右にしか矢印による diff 適用ができないので、元ファイルを右に配置する

選択範囲以外の部分はそのまま応答結果ファイルの方にも流し込んでおくことで、diff viewer としてまともに見れるようにしてある。

## テスト実行
- .vscode/launch.json を書いてあるので、F5 を押したときに起動する

## ビルド → 配布
- `npx vsce package`
