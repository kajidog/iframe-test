// 「iframe 内で実行されているか」の素朴な検出。
// 注意: これは "埋め込まれている事実" の検出にすぎず、信頼できる親かどうかは判定できない。
// 信頼判定は postMessage handshake の origin 検証で行う。
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // 一部の実装で同一性比較が例外を投げるケースの保険
    return true;
  }
}
