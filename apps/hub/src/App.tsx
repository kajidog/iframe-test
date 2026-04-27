import { useEffect, useRef, useState } from "react";

const SERVICE_UI_URL = import.meta.env.VITE_SERVICE_UI_URL as string;
const SERVICE_UI_ORIGIN = import.meta.env.VITE_SERVICE_UI_ORIGIN as string;

type HubInitPayload = {
  serviceId: string;
  appId?: string;
  hubToken: string;
};

function b64url(s: string): string {
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// 学習用の偽 JWT。alg=none 相当でデコード可能。署名検証はしない前提。
function makeMockHubToken(serviceId: string, appId?: string): string {
  const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: "user-mock-001",
      serviceId,
      appId,
      iat: now,
      exp: now + 3600,
    }),
  );
  return `${header}.${payload}.mock-signature`;
}

export function App() {
  const [serviceId, setServiceId] = useState("service-001");
  const [appId, setAppId] = useState("app-A");
  const [hubToken, setHubToken] = useState("");
  const [opened, setOpened] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [ack, setAck] = useState<{ receivedAt: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const log = (line: string) =>
    setLogs((prev) =>
      [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev].slice(0, 30),
    );

  // service-ui からの ready / ack を受信。
  // ready を受けたらその場で新しいトークンを生成し hub:init を 1 回だけ送る。
  // 子は mount のたびに ready を送るので、iframe リロードでも自動で再送される。
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SERVICE_UI_ORIGIN) return;
      // event.source が自分の iframe であることを必ず検証する。
      // 別 window から ready を偽装されてトークンを吐かないため。
      if (event.source !== iframeRef.current?.contentWindow) return;

      const data = event.data as { type?: string; receivedAt?: number };

      if (data?.type === "service-ui:ready") {
        if (!serviceId) {
          log("ready 受信したが serviceId が空のため hub:init を送らない");
          return;
        }
        const freshToken = makeMockHubToken(serviceId, appId || undefined);
        setHubToken(freshToken);
        const payload: HubInitPayload = {
          serviceId,
          appId: appId || undefined,
          hubToken: freshToken,
        };
        (event.source as Window).postMessage(
          { type: "hub:init", payload },
          SERVICE_UI_ORIGIN,
        );
        log(`service-ui:ready 受信 → hub:init 送信 (新規トークン発行)`);
        return;
      }

      if (data?.type === "service-ui:ack") {
        log(`service-ui:ack を受信 (receivedAt=${data.receivedAt})`);
        setAck({ receivedAt: data.receivedAt ?? Date.now() });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [serviceId, appId]);

  const onOpen = () => {
    if (!serviceId) {
      log("serviceId は必須");
      return;
    }
    setAck(null);
    setIframeLoaded(false);
    setOpened(true);
    log("iframe を開く (子の ready 受信を待機)");
  };

  const onClose = () => {
    setOpened(false);
    setAck(null);
    setIframeLoaded(false);
    log("iframe を閉じた");
  };

  const onPresetToken = () => {
    const t = makeMockHubToken(serviceId, appId || undefined);
    setHubToken(t);
    log("mock hub トークンを生成");
  };

  return (
    <div className="container">
      <h1>hub (parent)</h1>
      <section className="card">
        <h2>iframe に渡すデータ</h2>
        <div className="form">
          <label>
            serviceId
            <input value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
          </label>
          <label>
            appId (任意)
            <input value={appId} onChange={(e) => setAppId(e.target.value)} />
          </label>
          <label>
            hubToken
            <input value={hubToken} onChange={(e) => setHubToken(e.target.value)} />
          </label>
          <div className="row">
            <button onClick={onPresetToken}>mock トークンを生成</button>
            {!opened ? (
              <button onClick={onOpen}>iframe を開く</button>
            ) : (
              <button onClick={onClose}>iframe を閉じる</button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>handshake 状態</h2>
        <ul>
          <li>iframe 表示: {String(opened)}</li>
          <li>iframe load 完了: {String(iframeLoaded)}</li>
          <li>service-ui:ack: {ack ? `受信済 (${ack.receivedAt})` : "未受信"}</li>
        </ul>
      </section>

      {opened && (
        <section className="card">
          <h2>iframe</h2>
          <iframe
            ref={iframeRef}
            src={SERVICE_UI_URL}
            onLoad={() => {
              setIframeLoaded(true);
              log("iframe onLoad");
            }}
            title="service-ui"
            style={{ width: "100%", height: 560, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </section>
      )}

      <section className="card">
        <h2>ログ</h2>
        <pre className="logs">{logs.join("\n")}</pre>
      </section>
    </div>
  );
}
