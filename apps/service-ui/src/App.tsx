import { useEffect, useMemo, useState } from "react";
import { isEmbedded } from "./iframe";
import {
  getAllowedParentOrigins,
  isHubInitMessage,
  type ServiceUiAckMessage,
} from "./handshake";
import { callApi, type ApiCallResult, type AuthInput } from "./api";

type Mode = "standalone" | "embedded-untrusted" | "embedded-trusted";

type HubPayload = {
  serviceId: string;
  appId?: string;
  hubToken: string;
};

const DEFAULT_SERVICE_ID = import.meta.env.VITE_DEFAULT_SERVICE_ID as string;
const DEFAULT_API_KEY = import.meta.env.VITE_DEFAULT_API_KEY as string;

function maskToken(t: string): string {
  if (t.length <= 12) return t;
  return `${t.slice(0, 8)}…${t.slice(-4)} (len=${t.length})`;
}

export function App() {
  const embedded = useMemo(isEmbedded, []);
  const allowedParents = useMemo(getAllowedParentOrigins, []);
  const [hubPayload, setHubPayload] = useState<HubPayload | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<ApiCallResult | null>(null);

  const log = (line: string) =>
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev].slice(0, 30));

  useEffect(() => {
    if (!embedded) {
      log("standalone モードで起動");
      return;
    }
    log(
      `embedded で起動 / 許可済み親 origin: ${allowedParents.join(", ") || "(なし)"}`,
    );

    const onMessage = (event: MessageEvent) => {
      // origin 検証
      if (!allowedParents.includes(event.origin)) {
        log(`origin 拒否: ${event.origin}`);
        return;
      }
      // source 検証
      if (event.source !== window.parent) {
        log("source 拒否: window.parent と一致しない");
        return;
      }
      if (!isHubInitMessage(event.data)) {
        log(`type 不一致 / 不正な payload を破棄: ${JSON.stringify(event.data).slice(0, 80)}`);
        return;
      }
      const payload = event.data.payload;
      log(`hub:init を受理 (serviceId=${payload.serviceId}, appId=${payload.appId ?? "-"})`);
      setHubPayload(payload);

      // ack 返信
      const ack: ServiceUiAckMessage = {
        type: "service-ui:ack",
        receivedAt: Date.now(),
      };
      (event.source as Window).postMessage(ack, event.origin);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded, allowedParents]);

  const mode: Mode = !embedded
    ? "standalone"
    : hubPayload
      ? "embedded-trusted"
      : "embedded-untrusted";

  const auth: AuthInput =
    hubPayload && embedded
      ? {
          kind: "hub-token",
          serviceId: hubPayload.serviceId,
          appId: hubPayload.appId,
          hubToken: hubPayload.hubToken,
        }
      : {
          kind: "apikey",
          serviceId: DEFAULT_SERVICE_ID,
          apiKey: DEFAULT_API_KEY,
        };

  const onCall = async (path: "/api/me" | "/api/items") => {
    log(`${path} を ${auth.kind} で呼び出し`);
    try {
      const r = await callApi(path, auth);
      setLastResult(r);
      log(`${path} → status=${r.status}`);
    } catch (e) {
      log(`${path} エラー: ${(e as Error).message}`);
      setLastResult(null);
    }
  };

  return (
    <div className="container">
      <h1>service-ui</h1>
      <section className="card">
        <h2>モード</h2>
        <p>
          <span className={`mode mode-${mode}`}>{mode}</span>
        </p>
        <ul>
          <li>isEmbedded: {String(embedded)}</li>
          <li>許可済み親 origin: {allowedParents.join(", ") || "(なし)"}</li>
          <li>handshake 完了: {hubPayload ? "yes" : "no"}</li>
        </ul>
      </section>

      <section className="card">
        <h2>使用する認証情報</h2>
        {auth.kind === "apikey" ? (
          <ul>
            <li>方式: API キー</li>
            <li>serviceId: {auth.serviceId}</li>
            <li>apiKey: {maskToken(auth.apiKey)}</li>
          </ul>
        ) : (
          <ul>
            <li>方式: hub トークン</li>
            <li>serviceId: {auth.serviceId}</li>
            <li>appId: {auth.appId ?? "(なし)"}</li>
            <li>hubToken: {maskToken(auth.hubToken)}</li>
          </ul>
        )}
      </section>

      <section className="card">
        <h2>API 呼び出し</h2>
        <div className="row">
          <button onClick={() => onCall("/api/me")}>/api/me</button>
          <button onClick={() => onCall("/api/items")}>/api/items</button>
        </div>
        {lastResult && (
          <>
            <h3>送信ヘッダ</h3>
            <pre>{JSON.stringify(lastResult.sentHeaders, null, 2)}</pre>
            <h3>レスポンス (status={lastResult.status})</h3>
            <pre>{JSON.stringify(lastResult.body, null, 2)}</pre>
          </>
        )}
      </section>

      <section className="card">
        <h2>ログ</h2>
        <pre className="logs">{logs.join("\n")}</pre>
      </section>
    </div>
  );
}
