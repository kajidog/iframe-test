# 本番デプロイ手順

このリポジトリの 3 アプリ（hub / service-ui / backend）を AWS 上で運用するときの構成と
設定をまとめる。dev/staging/prod 各環境ごとに同一手順を繰り返す前提。

## 構成図

```
┌──────────────────────────┐         ┌──────────────────────────┐
│ hub (React SPA)          │         │ service-ui (React SPA)   │
│ ─ S3 (private)           │         │ ─ S3 (private)           │
│ ─ CloudFront dist #1     │         │ ─ CloudFront dist #2     │
│ ─ Lambda@Edge (CSP 等)   │         │ ─ Lambda@Edge (CSP 等)   │
│ ─ ACM 証明書             │         │ ─ ACM 証明書             │
└────────────┬─────────────┘         └────────────┬─────────────┘
             │ iframe                              │ fetch
             │                                     ▼
             │                          ┌──────────────────────┐
             │                          │ backend (Hono)       │
             │                          │ ─ ECS / Lambda 等    │
             │                          │ ─ CORS allow         │
             │                          │   = service-ui のみ  │
             │                          └──────────────────────┘
             ▼
       ブラウザ（同じユーザのタブ内で iframe を表示）
```

ポイント:
- hub / service-ui は **別の CloudFront ディストリビューション**。CSP `frame-ancestors` が異なる、Lambda@Edge を別運用にしたい、リリースを独立させたい、の 3 点が理由。
- backend は **共通 1 本**。CORS allowlist に **service-ui の本番ドメインのみ**を入れる（hub からは backend を直接叩かない）。

## アプリ別 環境変数

| アプリ | 変数 | 例 (prod) | 用途 |
|---|---|---|---|
| hub | `VITE_SERVICE_UI_URL` | `https://service-ui.example.com/` | iframe `src` |
| hub | `VITE_SERVICE_UI_ORIGIN` | `https://service-ui.example.com` | postMessage targetOrigin / CSP frame-src |
| service-ui | `VITE_ALLOWED_PARENT_ORIGINS` | `https://hub.example.com` | postMessage origin allowlist / CSP frame-ancestors。複数は `,` 区切り |
| service-ui | `VITE_API_BASE` | `https://api.example.com` | backend のベース URL / CSP connect-src |
| service-ui | `VITE_DEFAULT_SERVICE_ID` | `service-001` | standalone モードのフォールバック |
| service-ui | `VITE_DEFAULT_API_KEY` | `(Secrets Manager 等から流し込む)` | standalone モード用。本番では削除推奨 |
| backend | `ALLOWED_ORIGINS` | `https://service-ui.example.com` | CORS allowlist |
| backend | `MOCK_API_KEY` | `(本番では削除推奨)` | 学習用 API キー認証 |
| backend | `JWT_SIGNING_KEY` | `(Secrets Manager)` | 本番運用時に追加。詳細は backend.md |

Vite の `VITE_*` はビルド時に **静的に埋め込まれる**ため、シークレットを入れてはいけない。
環境ごとにビルドを分けるか、ビルド後に index.html へ注入する戦略を取る。詳細は [s3.md](./s3.md) 参照。

## デプロイ順序

新規構築時:
1. ACM で各サブドメインの証明書を発行（hub / service-ui / api、すべて us-east-1 でも可だが CloudFront に紐づける証明書は **必ず us-east-1**）
2. backend を先にデプロイ（`ALLOWED_ORIGINS` は service-ui の予定ドメインを設定済みにしておく）
3. S3 バケット 2 つを作成 → [s3.md](./s3.md)
4. CloudFront ディストリビューション 2 本を作成 → [cloudfront.md](./cloudfront.md)
5. Lambda@Edge 関数を作成し、service-ui のディストリビューションへ関連付け → [lambda-edge.md](./lambda-edge.md)
6. Route 53 で CNAME / ALIAS を作成

更新時は S3 sync → CloudFront invalidation のみ。Lambda@Edge を変更したときは新しいバージョンを発行してディストリビューションへ付け替え（数分の伝播待ちあり）。

## ドキュメント一覧

- [cloudfront.md](./cloudfront.md) — ディストリビューション設計、SPA fallback、Cache Policy
- [s3.md](./s3.md) — バケット設定、OAC、ビルド & sync コマンド
- [lambda-edge.md](./lambda-edge.md) — セキュリティヘッダ注入、サンプルコード、ロールアウト
- [backend.md](./backend.md) — CORS、本番での JWT 署名要件、モック JWT を本物に置き換える指針
