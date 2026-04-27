# Backend

`apps/backend` の Hono サーバを本番で動かすときの注意点。インフラ自体は ECS Fargate / Lambda + API Gateway / EC2 のどれでも構わない。ここでは **アプリ側の設定** に絞る。

## CORS allowlist

`apps/backend/src/index.ts` の `ALLOWED_ORIGINS` には **service-ui の本番 origin だけ** を入れる。

```ts
const ALLOWED_ORIGINS = ["https://service-ui.example.com"];
```

理由:
- backend は **service-ui からのみ** 直接呼ばれる（hub は backend を叩かない、`apps/hub/src/App.tsx` 参照）
- iframe 内 fetch の `Origin` は iframe を表示しているページの origin。すなわち hub の origin にはならず、service-ui の origin になる
- 環境ごとに値が変わるため、`process.env.ALLOWED_ORIGINS` から読む実装に置き換え、CSV で複数 origin を許す形にする

許可ヘッダ（既存）:
- `Authorization`
- `X-Service-Id`
- `X-Api-Key`
- `X-App-Id`
- `Content-Type`

許可メソッド: `GET, POST, OPTIONS`

## 本番運用での JWT 署名要件（重要）

現行のサンプルはすべて **モック** で、本番には**そのまま使えない**。

### 何が問題か

| ファイル | 問題 |
|---|---|
| `apps/hub/src/App.tsx:17` の `makeMockHubToken` | `alg: "none"` の JWT をクライアントで生成している。署名がないので任意の `serviceId` / `sub` を詐称できる |
| `apps/backend/src/index.ts:47-56` の decode-only ロジック | 署名検証していない。改ざん検出不可 |
| `apps/backend/src/index.ts` の `MOCK_API_KEY` | ハードコードされた API キー。学習用 |

### あるべき姿

1. **トークン発行は backend で行う**
   - 認証済みユーザに対し `POST /auth/issue-hub-token` のようなエンドポイントから JWT を発行
   - 署名アルゴリズムは HS256（共有鍵）か RS256（公開鍵検証）。鍵長は HS256 で 256bit 以上、RS256 で 2048bit 以上
2. **hub はそのトークンを fetch して受け取る**
   - hub 内のクライアント JWT 生成 (`makeMockHubToken`) は廃止
   - hub は受け取ったトークンを postMessage で iframe に渡す（フロー自体は今回のリファクタで child-initiated になっているのでそのまま流用可能）
3. **backend は受信した JWT を署名検証 + exp + serviceId 整合性で検証**
   - ライブラリは `jose` を推奨
   - 検証順: 署名 → exp（時計ずれ許容は数秒）→ aud / iss → serviceId 整合性
4. **署名鍵は AWS Secrets Manager / SSM Parameter Store**
   - 環境変数に直書きしない
   - ローテーションを設計する。HS256 ならキーバージョン併存期間を作る、RS256 なら JWKS でロールアウト
5. **`MOCK_API_KEY` フォールバックは削除**
   - standalone モードを残すなら、本物の API キー認証スキームに置き換える（hash + rate limit + audit log）

### 移行ステップ（参考、本タスクのスコープ外）

1. backend に `POST /auth/issue-hub-token` を追加し、JWT を `jose.SignJWT` で署名して返す
2. hub に「トークン取得 → state に保存 → child の `service-ui:ready` 受信時に postMessage で渡す」を実装。`makeMockHubToken` を削除
3. backend の `parseHubToken` を `jose.jwtVerify` に差し替え。`alg:"none"` を許可しないように設定
4. `MOCK_API_KEY` 経路を削除、または管理可能な API キー方式へ刷新
5. 鍵を Secrets Manager に格納、IAM で backend のタスクロールにのみ読み取り権限

## 環境変数

| 変数 | 用途 | 例 |
|---|---|---|
| `ALLOWED_ORIGINS` | CORS。CSV で複数可 | `https://service-ui.example.com` |
| `JWT_SIGNING_KEY` | JWT 署名鍵（HS256 の場合）。本番運用で追加 | `(Secrets Manager から流し込み)` |
| `JWT_ISSUER` | JWT の `iss` 期待値 | `https://api.example.com` |
| `JWT_AUDIENCE` | JWT の `aud` 期待値 | `service-ui` |
| `LOG_LEVEL` | アプリログ閾値 | `info` |

## 観測性

- 構造化ログ（JSON）で `requestOrigin` / `serviceId` / `authMethod` / `tokenSubject` を出す（既存実装の延長）
- 失敗系: `auth_failed`（理由付き）、`origin_blocked`、`token_expired` を別カウンタで取れるようにする
- メトリクス: 4xx 率、p99 レイテンシ、CORS 拒否数

## デプロイ実体（参考）

ECS Fargate の場合:
- ALB → ECS Service（Hono を `node dist/index.js` で起動）
- ALB の listener で ACM 証明書を関連付け、API のドメイン（api.example.com）を Route 53 で割り当て
- ALB の Health Check は `/health`（実装する）

Lambda + API Gateway の場合:
- `@hono/node-server` ではなく `hono/aws-lambda` のアダプタへ差し替え
- API Gateway のカスタムドメインで `api.example.com` を割り当て

どちらでも CORS 設定は backend アプリ側で完結させる（API Gateway / ALB 側で重複設定しない）。
