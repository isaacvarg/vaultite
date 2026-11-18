// Standalone (no deps): the first headless browser on a fresh runner, then more, each navigating to a data: page twice.
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
const html = `<body style="margin:0;background:#fff"><div class="opt" style="width:200px;height:100px;background:#c00">A</div><div class="opt" style="width:300px;height:50px;background:#00c">B</div></body>`
const url = `data:text/html,${encodeURIComponent(html)}`
const local = process.env.LOCALAPPDATA ?? ""
const pw = path.join(local, "ms-playwright")
const bundled = fs.existsSync(pw) ? fs.readdirSync(pw).filter((d) => /^chromium-\d/.test(d)).map((d) => path.join(pw, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p)) : undefined
const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p))
const chrome = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p))
console.log("bundled", bundled, "edge", edge, "chrome", chrome)

async function run(label: string, exe: string | undefined, extra: string[]) {
  if (!exe) { console.log(`=== ${label}: none`); return }
  console.log(`\n=== ${label} ${exe} ${extra.join(" ")}`)
  const t0 = Date.now(), at = () => String(Date.now() - t0).padStart(6)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "diag-"))
  const b = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=640,400", "--disable-extensions", ...extra, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  let err = ""
  b.stderr!.on("data", (d: Buffer) => { err += d })
  try {
    let ws = ""
    for (let i = 0; i < 600 && !ws; i++) { const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) ws = m[1]; else await sleep(100) }
    const port = new URL(ws).port
    let tab: { type: string; webSocketDebuggerUrl: string } | undefined
    for (let i = 0; i < 100 && !tab; i++) { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]).find((x) => x.type === "page"); if (!tab) await sleep(100) }
    console.log(at(), "tab")
    const sock = new WebSocket(tab!.webSocketDebuggerUrl)
    await new Promise((ok) => { sock.onopen = ok })
    let id = 0
    const waits = new Map<number, (v: unknown) => void>()
    sock.onmessage = (e) => {
      const m = JSON.parse(String(e.data))
      if (m.id !== undefined) { waits.get(m.id)?.(m.error ? { ERROR: m.error.message } : m.result); waits.delete(m.id) }
      else if (/frameNavigated|frameStoppedLoading|loadEventFired|targetCrashed|Inspector\.detached|frameStartedNavigating|navigatedWithinDocument/.test(m.method)) console.log(at(), "event", m.method, m.method === "Page.frameNavigated" ? String(m.params.frame.url).slice(0, 30) : "")
    }
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((ok) => { const n = ++id; waits.set(n, ok); sock.send(JSON.stringify({ id: n, method, params })) })
    await send("Page.enable"); await send("Runtime.enable"); await send("Inspector.enable")
    for (let k = 0; k < 2; k++) {
      console.log(at(), `navigate #${k}`, JSON.stringify(await send("Page.navigate", { url })))
      let last = ""
      for (let i = 0; i < 80; i++) {
        const r = await send("Runtime.evaluate", { expression: `document.URL.slice(0, 12) + " " + document.querySelectorAll(".opt").length`, returnByValue: true })
        const v = JSON.stringify(r?.result?.value ?? r)
        if (v !== last) console.log(at(), "page", v); last = v
        if (/data:.* 2/.test(v)) break
        await sleep(250)
      }
      console.log(at(), `#${k} ${/data:.* 2/.test(last) ? "DRAWN" : "NOT DRAWN"}`)
      if (/data:.* 2/.test(last)) break
    }
    sock.close()
  } finally { b.kill("SIGKILL"); await sleep(1000) }
}

const order = (process.env.ORDER ?? "default").split(",")
for (const o of order) {
  if (o === "default") await run("bundled, sandboxed", bundled, [])
  else if (o === "nosandbox") await run("bundled, no sandbox", bundled, ["--no-sandbox"])
  else if (o === "edge") await run("edge (native)", edge, [])
  else if (o === "chrome") await run("installed chrome", chrome, [])
}
