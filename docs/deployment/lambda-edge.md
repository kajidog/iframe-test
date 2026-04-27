# Lambda@Edge

CloudFront のレスポンスにセキュリティヘッダ（特に CSP `frame-ancestors`）を付与するために使う。

## なぜ Lambda@Edge か（CloudFront Response Headers Policy との比較）

完全に静的なヘッダだけなら **CloudFront Response Headers Policy** で十分。Lambda@Edge は不要。

ただし以下のいずれかに該当するなら Lambda@Edge を選ぶ:

- 環境ごとに `frame-ancestors` の origin を出し分けたい（dev/staging/prod で hub の URL が違う）
- 将来 CSP nonce や per-request の値を埋め込みたい
- 同一の関数を複数ディストリビューションへ流用したい（Stage を関数のアプリ設定経由で切り替えるなど）

このリポでは **2 つ目以降の理由は薄い**ので、本番が「ヘッダが完全静的」運用なら Response Headers Policy だけで構わない。
本ドキュメントでは Lambda@Edge 採用前提で書く。

## 配置

| 項目 | 値 |
|---|---|
| Region | **us-east-1**（Lambda@Edge の必須要件） |
| Runtime | Node.js 20.x |
| Trigger | CloudFront `viewer-response` |
| 関数別 | hub 用 1 つ、service-ui 用 1 つ |
| 名前例 | `myapp-hub-headers-prod` / `myapp-service-ui-headers-prod` |

`viewer-response` を使うのは、`origin-response` だと CloudFront のキャッシュにヘッダが乗ってしまい、別ビューワへも同じヘッダが返るため。今回は静的に近いので origin-response でも実害は出にくいが、将来 nonce を入れるなら viewer-response が安全。

## サンプル: service-ui 用

```js
// service-ui-headers/index.mjs
"use strict";

// 環境ごとに編集する。複数親があれば space 区切りで列挙。
const HUB_ORIGIN = "https://hub.example.com";
const API_ORIGIN = "https://api.example.com";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'", // Vite 出力で許容する場合のみ。要なら 'unsafe-inline' を外す
  "script-src 'self'",
  `connect-src 'self' ${API_ORIGIN}`,
  `frame-ancestors ${HUB_ORIGIN}`,
  "form-action 'self'",
  "frame-src 'none'",
].join("; ");

export const handler = async (event) => {
  const response = event.Records[0].cf.response;
  const headers = response.headers;

  const set = (name, value) => {
    headers[name.toLowerCase()] = [{ key: name, value }];
  };

  set("Content-Security-Policy", CSP);
  set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  set("X-Content-Type-Options", "nosniff");
  set("Referrer-Policy", "no-referrer");
  set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

  return response;
};
```

## サンプル: hub 用

`frame-ancestors 'none'`（hub は埋め込まれない）、`frame-src` で service-ui の origin を許可する。

```js
// hub-headers/index.mjs
"use strict";

const SERVICE_UI_ORIGIN = "https://service-ui.example.com";
const API_ORIGIN = "https://api.example.com";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  `connect-src 'self' ${API_ORIGIN}`,
  `frame-src ${SERVICE_UI_ORIGIN}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const handler = async (event) => {
  const response = event.Records[0].cf.response;
  const headers = response.headers;

  const set = (name, value) => {
    headers[name.toLowerCase()] = [{ key: name, value }];
  };

  set("Content-Security-Policy", CSP);
  set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  set("X-Content-Type-Options", "nosniff");
  set("Referrer-Policy", "no-referrer");
  set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

  return response;
};
```

## デプロイ手順

1. us-east-1 の Lambda コンソールで関数を作成（または `aws lambda create-function`）
2. 上記コードを反映
3. **Publish new version**（`$LATEST` は Lambda@Edge へ関連付けできない）
4. 対象 CloudFront ディストリビューション > Behaviors > Edit > Function associations:
   - Event type: `Viewer response`
   - Function type: `Lambda@Edge`
   - ARN: 発行したバージョンの ARN（`...:function:NAME:1` のように番号付き）
5. ディストリビューション保存。エッジロケーションへの伝播に数分かかる
6. `curl -I` で CSP / HSTS が返ることを確認

## 更新

コード変更時:
1. 関数を編集 → **新しいバージョンを Publish**
2. ディストリビューションのビヘイビアで関連付けを **新しいバージョンの ARN に変更**
3. Save → 数分待つ
4. `curl -I` で確認

ロールバック:
- 関連付けを **以前のバージョンの ARN** に戻すだけ。ロールバック自体は同じ「ビヘイビア更新」操作。

## ハマりどころ

- ハンドラ署名は **CloudFront 用**（`event.Records[0].cf.response`）。API Gateway 用と書き方が違う
- 環境変数は使えない。値を変えるならコード書き換え＋新バージョン発行。`Origin Custom Headers` でディストリビューションごとに切り替える小技はあるが、本番環境で 2 ディストリビューションに別関数を割り当てる方がシンプル
- IAM ロールに `lambda.amazonaws.com` と `edgelambda.amazonaws.com` の両方を信頼ポリシーに含める
- ログは `us-east-1` 含む各エッジリージョンの CloudWatch Logs に飛ぶ。トラブル時は CloudFront のリクエストがどのエッジに着いたかを `x-amz-cf-pop` から特定して該当リージョンの logs を見る
- CSP に `'unsafe-inline'` を残すかは要検討。Vite が CSS で inline style を生成するので、style-src は許容寄り。script-src は許容しない方針
