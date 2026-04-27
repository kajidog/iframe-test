# CloudFront

hub と service-ui それぞれに **独立した CloudFront ディストリビューション** を 1 本ずつ作る。

## なぜ 1 本にまとめないか

- service-ui は CSP `frame-ancestors` で hub の origin だけを許可する必要があり、hub は `frame-ancestors 'none'` を返したい。同一ディストリビューションでパス別にレスポンスヘッダを切り替える運用は、ビヘイビア＋関数で実現できるが煩雑になる。
- Lambda@Edge を片方（service-ui）だけに付けたい。
- hub と service-ui は別々の責務でリリースサイクルを独立させたい。
- 万一片方の不具合で全停止しないようにしたい。

## ディストリビューション設計（共通）

| 項目 | 値 |
|---|---|
| Origin | S3 バケット（OAC 経由） |
| Origin Access | **Origin Access Control (OAC)**。レガシー OAI は使わない |
| Viewer Protocol Policy | Redirect HTTP to HTTPS |
| Allowed HTTP Methods | GET, HEAD, OPTIONS |
| Cached HTTP Methods | GET, HEAD |
| Compress objects automatically | ON |
| Minimum TLS | TLSv1.2_2021 |
| HTTP/2, HTTP/3 | 有効 |
| Price Class | 配信地域に合わせて選択（日本想定なら "Use only North America, Europe, Asia, Middle East, and Africa"） |
| WAF | 推奨。少なくとも AWS Managed Rules Common Rule Set を有効化 |
| Logging | S3 / CloudWatch どちらかへ standard log を出す |
| Custom Domain | ACM 証明書（**us-east-1 で発行**）を関連付け |

## SPA fallback

React SPA なので、`/foo/bar` のような直接アクセスでも `/index.html` を返す必要がある。

CloudFront の Custom Error Response で:

| HTTP Error Code | Response Page Path | Response Code | Caching |
|---|---|---|---|
| 403 | /index.html | 200 | 0 sec |
| 404 | /index.html | 200 | 0 sec |

※ S3 を OAC で privateにしている場合、存在しないキーには 403 が返る。両方を 200 + index.html にマップする。

## Cache Policy

ビヘイビアごとに使い分ける。

### `/index.html`（および `/`）専用ビヘイビア

- Cache Policy: **CachingDisabled**（または独自に min/max/default を 0 秒）
- Origin Request Policy: なし
- Response Headers Policy: 後述
- 理由: index.html はデプロイのたびに差し替わるが、サブリソースの hash 名が更新されるため index.html 自体が古いとアプリが起動しない。常に最新を取りに行かせる。

### `/assets/*` 等（ハッシュ付きファイル）デフォルトビヘイビア

- Cache Policy: **CachingOptimized**
- Origin Request Policy: なし
- 各ファイルは Vite が `name-[hash].ext` で出すため、内容が変われば URL も変わる。長期キャッシュ可。
- S3 へ sync する際に `Cache-Control: public,max-age=31536000,immutable` を付ける（[s3.md](./s3.md) 参照）。

## Response Headers Policy

静的に決まるセキュリティヘッダはここで配る。動的に環境別の値が要るもの（特に CSP）は Lambda@Edge へ寄せる（[lambda-edge.md](./lambda-edge.md) 参照）。

両ディストリビューション共通で付けたい:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `X-Frame-Options` は **設定しない**（CSP `frame-ancestors` の方が強い・新しい仕様。両方付けると古い値が優先されることがある）

CSP は環境別なので Lambda@Edge で:

- hub: `Content-Security-Policy: default-src 'self'; frame-src https://service-ui.example.com; frame-ancestors 'none'; ...`
- service-ui: `Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.example.com; frame-ancestors https://hub.example.com; ...`

## ディストリビューション差異まとめ

|  | hub | service-ui |
|---|---|---|
| Origin S3 | hub-bucket | service-ui-bucket |
| Lambda@Edge | あり（CSP `frame-ancestors 'none'` 等） | あり（CSP `frame-ancestors <hub origin>` 等） |
| Custom Domain | hub.example.com | service-ui.example.com |
| 主な静的ヘッダ | 同上 | 同上 |
| アクセス想定 | ユーザ直接アクセス | hub の iframe 経由が主、直接アクセスは standalone モード |

## デプロイ後の確認

```sh
curl -I https://hub.example.com/
# HTTP/2 200
# content-security-policy: ...frame-ancestors 'none'...
# strict-transport-security: ...
# x-content-type-options: nosniff

curl -I https://service-ui.example.com/
# HTTP/2 200
# content-security-policy: ...frame-ancestors https://hub.example.com...
```

`/foo` のような存在しないパスでも `index.html` が返ること（SPA fallback）も忘れず確認する。
