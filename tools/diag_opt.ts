import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { chromePath } from "../core/headless.ts"
import { pictures } from "../plugins/core/html/picture.ts"

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
const html = `<body style="margin:0;background:#fff"><div class="opt" style="width:200px;height:100px;background:#c00">A</div><div class="opt" style="width:300px;height:50px;background:#00c">B</div></body>`
const url = `data:text/html,${encodeURIComponent(html)}`
console.log("arch", process.arch, os.release(), "chrome", chromePath())

async function plain() { for (let i = 0; i < 1; i++) {
  const t = Date.now()
  try { const s = await pictures({ url, width: 640, height: 400, selector: ".opt" }); console.log(`pictures #${i} ok ${s.length} in ${Date.now() - t} ms`) }
  catch (e) { console.log(`pictures #${i} FAILED in ${Date.now() - t} ms: ${(e as Error).message}`) }
} }

async function traced(label: string, extra: string[], target: string) {
  console.log(`\n=== ${label}`)
  const t0 = Date.now(), at = () => `${String(Date.now() - t0).padStart(6)}`
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "diag-"))
  const b = spawn(chromePath()!, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=640,400", "--disable-extensions", "--autoplay-policy=user-gesture-required", ...extra, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  let err = ""
  b.stderr!.on("data", (d: Buffer) => { err += d })
  b.on("exit", (c) => console.log(at(), "chrome exited", c))
  try {
    let ws = ""
    for (let i = 0; i < 600 && !ws; i++) { const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) ws = m[1]; else await sleep(100) }
    console.log(at(), "listening")
    const port = new URL(ws).port
    let tab: { type: string; webSocketDebuggerUrl: string; url: string } | undefined
    for (let i = 0; i < 100 && !tab; i++) { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as (typeof tab)[]).find((x) => x?.type === "page"); if (!tab) await sleep(100) }
    console.log(at(), "tab", tab?.url)
    const sock = new WebSocket(tab!.webSocketDebuggerUrl)
    await new Promise((ok) => { sock.onopen = ok })
    let id = 0
    const waits = new Map<number, (v: unknown) => void>()
    sock.onmessage = (e) => {
      const m = JSON.parse(String(e.data))
      if (m.id !== undefined) { waits.get(m.id)?.(m.error ? { ERROR: m.error.message } : m.result); waits.delete(m.id) }
      else console.log(at(), "event", m.method, JSON.stringify(m.params).slice(0, 160))
    }
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((ok) => { const n = ++id; waits.set(n, ok); sock.send(JSON.stringify({ id: n, method, params })) })
    console.log(at(), "Page.enable", JSON.stringify(await send("Page.enable")))
    await send("Page.setLifecycleEventsEnabled", { enabled: true })
    console.log(at(), "Runtime.enable", JSON.stringify(await send("Runtime.enable")))
    await send("Inspector.enable")
    await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 400, deviceScaleFactor: 2, mobile: false })
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] })
    console.log(at(), "navigate", JSON.stringify(await send("Page.navigate", { url: target })))
    for (let i = 0; i < 100; i++) {
      const r = await send("Runtime.evaluate", { expression: `JSON.stringify([document.URL.slice(0, 24), document.readyState, document.visibilityState, document.querySelectorAll(".opt").length, [...document.querySelectorAll(".opt")].map((e) => e.getBoundingClientRect().width), document.documentElement.outerHTML.length, innerWidth, innerHeight])`, returnByValue: true })
      console.log(at(), "poll", JSON.stringify(r).slice(0, 200))
      if (i > 12 && /\[200,300\]/.test(JSON.stringify(r))) break
      await sleep(250)
    }
    sock.close()
  } finally {
    b.kill("SIGKILL"); await sleep(1000)
    console.log("stderr tail:", err.slice(-1500))
  }
}
await traced("as headless.ts launches", [], url)
await traced("no sandbox", ["--no-sandbox"], url)
await traced("http page", [], "https://example.com/")
await plain()
