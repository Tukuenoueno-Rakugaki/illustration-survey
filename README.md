# イラスト印象評価アンケート

## 使い方

1. `assets` フォルダに以下の名前で画像を入れます。
   - `illustration1.png`
   - `illustration2.png`
   - `illustration3.png`
   - `illustration4.png`
2. `python3 server.py` を実行します。
3. PCでは `http://127.0.0.1:8087/` を開きます。
4. スマホでは、同じWi-Fiにつないで `http://MacのIPアドレス:8087/` を開きます。
5. 参加者は名前を入力し、1〜30の番号を選択して開始します。
6. 回答完了後、結果は `data/responses.json` に保存されます。
7. `http://127.0.0.1:8087/results.html` で結果を確認できます。

## スマホで開く

MacのIPアドレスは、システム設定のWi-Fi詳細、またはターミナルで `ipconfig getifaddr en0` を実行すると確認できます。

例: MacのIPアドレスが `192.168.1.23` の場合、スマホでは `http://192.168.1.23:8087/` を開きます。

スマホとMacは同じWi-Fiに接続してください。開けない場合は、macOSのファイアウォール設定でPythonからの受信接続を許可してください。

## ネットでいつでも回答できるリンクにする

Mac上で動かす方法は、Macを閉じたりWi-Fiが変わったりすると止まります。いつでも回答できる公開リンクにする場合は、サイト本体をVercelなどに置き、回答データはGoogleスプレッドシートに保存します。

## Googleスプレッドシート保存にする

1. Googleスプレッドシートを新規作成します。
2. `拡張機能` → `Apps Script` を開きます。
3. `google-apps-script.gs` の中身をApps Scriptに貼り付けます。
4. 必要なら、Apps Script上部の `ADMIN_TOKEN` に結果ページ用の管理キーを設定します。
5. `デプロイ` → `新しいデプロイ` → 種類は `ウェブアプリ` を選びます。
6. 実行ユーザーは `自分`、アクセスできるユーザーは `全員` にします。
7. デプロイ後に発行されるウェブアプリURLをコピーします。
8. `config.js` の `googleScriptUrl` にそのURLを貼り付けます。

```js
window.SURVEY_CONFIG = {
  googleScriptUrl: "https://script.google.com/macros/s/xxxxx/exec",
};
```

この形では、サイト側には回答データを保存しません。回答はGoogleスプレッドシートに保存されます。

公開後は、発行されたURLのトップページを参加者に共有します。例: `https://your-survey.vercel.app/`

## Vercelで公開する

GitHubにpushしたあと、VercelでこのリポジトリをImportします。フレームワーク設定は不要です。

- Framework Preset: `Other`
- Build Command: 空欄
- Output Directory: 空欄

Vercelへ反映する前に、`config.js` にGoogle Apps ScriptのURLを入れてcommit/pushしてください。

## 条件割り当て

| 画像 | 実際の制作者 | A群での説明 | B群での説明 |
| --- | --- | --- | --- |
| イラスト1 | human | human | ai |
| イラスト2 | ai | ai | human |
| イラスト3 | human | human | ai |
| イラスト4 | ai | ai | human |

CSVには、実際の制作者を `actualCreator`、参加者に提示した制作者情報を `displayedCreator` として保存します。

参加者番号は奇数がA群、偶数がB群です。開始ボタンを押した時点では名前だけを予約します。同じ名前がすでに予約済み・回答済みの場合は、アンケート画面へ進まず回答済みとして表示します。番号は回答が保存されたあとに使用済みになります。
