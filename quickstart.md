# クイックスタート
可能な限り設定を除外してすぐに使えるようにしたもの。  
初期値ですぐ使えるOpenAI/gpt-3.5-turboを使用する。

## 1. (初回のみ) 各サービスの API Key を設定する。
設定画面を開き (Ctrl + ,)、simple-text-refine で絞り込むと、以下の2つの設定項目があるので、必要に応じて入力する。(注意: API Keyを設定に記録するのは最善でない。将来的に改善予定)

- simple-text-refine.api_key_openai

<img width="1130" alt="image" src="https://github.com/shimajima-eiji/SimpleTextRefine/assets/15845907/4abf8a96-81aa-4e5a-b862-63c3ea97397d">

## 2. prompt を作成する
コマンドパレット (Ctrl + Shift + P) で「prompt」と入力すると「Simple Text Refine: open prompt file」という項目が現れるので、選択する。  
初回はファイルが無い旨のエラーが出るが、その通知中の Create ボタンを押すことで雛型を作成できる。  
prompt ファイルは `(当該ワークスペース)/.vscode/.prompt`に保存される。

<img width="1233" alt="image" src="https://github.com/shimajima-eiji/SimpleTextRefine/assets/15845907/d857a3da-b25c-480f-8747-82399d1085ec">

## 3. workspace 以下の適当なフォルダの適当なファイルを開き、適当な文章を記入する。
ここでは、sample.mdというファイルを新規作成する。

```
平素よりお世話になっております。
◯◯商事の△△でございます。

本日お問い合わせいただいた☆☆について、以下の通り回答申し上げます。
```

## 4. LLM を呼び出す。
まずは開いているファイルのうち、LLM に渡したいテキスト部分をエディタ内で選択状態にする。  
（クイックスタートでは、sample.mdの内容を全選択する）

### コマンドパレットを開き「call LLM」と入力すると「Simple Text Refine: call LLM with selected text」という項目が現れるので、選択する。
<img width="1230" alt="image" src="https://github.com/shimajima-eiji/SimpleTextRefine/assets/15845907/8007d966-c4ae-4f29-8e93-1418a8e8dd56">

クイックスタートでは「メール」を選択する。

### 作成したプロンプトを選択するダイアログが表示されるので、目的のプロンプトを選択する。
LLM の呼び出しが開始する。応答がリアルタイムにテンポラリファイルに書き出され、そのファイルとの diff 表示画面が開く。  
（結果はスクリーンショットと異なる場合がある）

<img width="1376" alt="image" src="https://github.com/shimajima-eiji/SimpleTextRefine/assets/15845907/037c9408-844b-434c-8132-59b20c00d5c1">

## 5. LLM 応答を見て、必要に応じて元ファイルを編集する
diff 画面上の左が LLM 応答で、セパレータ部分にある→を使うことで元ファイルに LLM 応答を流し込むことができる

<img width="1377" alt="image" src="https://github.com/shimajima-eiji/SimpleTextRefine/assets/15845907/f59a57cc-8b3a-4417-9b1d-39c545882f32">

プロンプトは以下のようなyaml形式で記載すること。  

- 初期状態では `(当該ワークスペース)/.vscode/.prompt`に保存されている
- スクリーンショットのような状態になっている場合、`.prompt`ファイルのタブが該当する。

```yml
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

よく分からない場合は、description内のコメント（プロンプト）だけを変更すること。
