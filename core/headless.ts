import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { logger } from "./log.ts"
import { messageOf } from "./values.ts"

const log = logger("headless")

/** VAULTITE_CHROME, Playwright's Chromium, then an installed Chrome or Edge: not first, as macOS brings forward a headless one
 *  left running; but first on Windows on Arm, where Playwright's is x64, whose sandboxed pages crash under emulation. */
export function chromePath() {
  const bundled = () => { try { return createRequire(import.meta.url)("playwright-core").chromium.executablePath() as string } catch { return undefined } }
  const installed = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ...windowsBrowsers(), "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"]
  const emulated = process.platform === "win32" && process.arch === "arm64"
  return [process.env.VAULTITE_CHROME, ...(emulated ? [...installed, bundled()] : [bundled(), ...installed])].find((p) => p && fs.existsSync(p)) ?? null
}
function windowsBrowsers() {
  if (process.platform !== "win32") return []
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter((r) => r !== undefined)
  return [...roots.map((r) => path.join(r, "Google", "Chrome", "Application", "chrome.exe")), ...roots.map((r) => path.join(r, "Microsoft", "Edge", "Application", "msedge.exe"))]
}

export type Cdp = { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>; on: (method: string, f: (p: Record<string, unknown>) => void) => () => void; close: () => void }
async function cdp(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error("couldn't reach the headless browser")) })
  let id = 0
  const waits = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>(), subs = new Map<string, ((p: Record<string, unknown>) => void)[]>()
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown> }
    if (m.id !== undefined) { const w = waits.get(m.id); waits.delete(m.id); if (m.error) w?.fail(new Error(m.error.message)); else w?.ok(m.result ?? {}) }
    else if (m.method) for (const f of subs.get(m.method) ?? []) f(m.params ?? {})
  }
  let gone: Error | null = null
  const end = (e: Error) => { gone ??= e; for (const w of waits.values()) w.fail(gone); waits.clear() }
  ws.onclose = () => end(new Error("the headless browser closed"))
  const on: Cdp["on"] = (method, f) => {
    subs.set(method, [...(subs.get(method) ?? []), f])
    return () => subs.set(method, (subs.get(method) ?? []).filter((g) => g !== f))
  }
  on("Inspector.targetCrashed", () => end(new Error("the headless browser's page crashed")))
  return {
    send: (method, params = {}) => new Promise((ok, fail) => {
      if (gone) return fail(gone)
      const n = ++id; waits.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params }))
    }),
    on,
    close: () => ws.close(),
  }
}

export type Headless = { page: Cdp; stop: () => void; quit: () => Promise<void> }
export async function headless(size: { width: number; height: number }, signal?: AbortSignal): Promise<Headless> {
  try { return await launch(size, signal, false) } catch (e) {
    // (Ubuntu 24.04 keeps Chrome's sandbox from starting: AppArmor refuses it the user namespaces it needs)
    if (process.platform !== "linux" || !/quit as it started/.test(messageOf(e))) throw e
    return launch(size, signal, true)
  }
}
async function launch(size: { width: number; height: number }, signal: AbortSignal | undefined, unsandboxed: boolean): Promise<Headless> {
  const chrome = chromePath()
  if (!chrome) throw new Error("no Chrome here (Google Chrome, or Chromium: VAULTITE_CHROME names one)")
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-headless-"))
  const browser = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${size.width},${size.height}`, "--disable-extensions", "--autoplay-policy=user-gesture-required", ...(unsandboxed ? ["--no-sandbox"] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  let page: Cdp | null = null
  const stop = () => { try { page?.close() } catch { /* gone */ } browser.kill("SIGKILL") }
  const quit = async () => {
    // (its profile goes once it has quit: a browser still writing there makes the removal fail, and hide the real error)
    const gone = browser.exitCode !== null ? Promise.resolve() : new Promise<void>((ok) => browser.once("exit", () => ok()))
    stop()
    await Promise.race([gone, sleep(3000)])
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch (e) { log.error(`${profile} stays: ${messageOf(e)}`) }
  }
  signal?.addEventListener("abort", stop, { once: true })
  try {
    const endpoint = await new Promise<string>((ok, fail) => {
      let err = ""
      const t = setTimeout(() => fail(new Error(`Chrome didn't start in ${START_MS / 1000} s: ${err.slice(-300)}`)), START_MS)
      browser.stderr!.on("data", (d: Buffer) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) { clearTimeout(t); ok(m[1]) } })
      browser.on("exit", () => { clearTimeout(t); fail(new Error(`Chrome quit as it started: ${err.slice(-300)}`)) })
    })
    const port = new URL(endpoint).port
    // (its first tab comes a moment after the browser says it listens)
    let tab: { type: string; webSocketDebuggerUrl: string } | undefined
    for (let i = 0; i < 50 && !tab; i++) {
      tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page")
      if (!tab) await sleep(100)
    }
    if (!tab) throw new Error("Chrome opened no page")
    page = await cdp(tab.webSocketDebuggerUrl)
    await page.send("Inspector.enable")
    return { page, stop, quit }
  } catch (e) {
    await quit()
    throw e
  }
}

const Navigated = z.object({ frame: z.object({ id: z.string(), loaderId: z.string(), parentId: z.string().optional() }) })
const Started = z.object({ frameId: z.string(), loaderId: z.string() })
const Stopped = z.object({ frameId: z.string() })
const Navigation = z.object({ loaderId: z.string().optional(), errorText: z.string().optional() })

export async function open(page: Cdp, url: string, o: { ms?: number; loadMs?: number } = {}): Promise<void> {
  const ms = o.ms ?? 30_000, loadMs = o.loadMs ?? 15_000
  const started = new Map<string, string>(), committed = new Set<string>(), dropped = new Set<string>(), loaded = new Set<string>()
  let last: string | undefined, ours: string | undefined, crashed = false, settle = () => {}
  const offs = [
    page.on("Page.frameStartedNavigating", (e) => { const s = Started.safeParse(e).data; if (s) started.set(s.loaderId, s.frameId); settle() }),
    page.on("Page.frameNavigated", (e) => { const f = Navigated.safeParse(e).data?.frame; if (f && !f.parentId) { committed.add(f.loaderId); last = f.loaderId } settle() }),
    page.on("Page.loadEventFired", () => { if (last) loaded.add(last); settle() }),
    page.on("Page.frameStoppedLoading", (e) => {
      const frame = Stopped.safeParse(e).data?.frameId
      for (const [id, f] of started) if (f === frame && !committed.has(id)) dropped.add(id)
      settle()
    }),
    page.on("Inspector.targetCrashed", () => { crashed = true; settle() }),
  ]
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    const done = new Promise<void>((ok, fail) => {
      let shown = false
      settle = () => {
        if (crashed) fail(new Error(`couldn't open ${url}: the page crashed`))
        if (!ours) return
        if (loaded.has(ours)) ok()
        else if (dropped.has(ours)) fail(new Error(`couldn't open ${url}: the browser dropped it before it showed`))
        else if (committed.has(ours) && !shown) { shown = true; timers.push(setTimeout(ok, loadMs)) }
      }
      timers.push(setTimeout(() => { if (!shown) fail(new Error(`couldn't open ${url}: it didn't show in ${ms / 1000} s`)) }, ms))
    })
    done.catch(() => {})
    const nav = Navigation.parse(await page.send("Page.navigate", { url }))
    if (nav.errorText) throw new Error(`couldn't open ${url}: ${nav.errorText}`)
    if (!nav.loaderId) return
    ours = nav.loaderId
    settle()
    await done
  } finally {
    for (const t of timers) clearTimeout(t)
    for (const off of offs) off()
  }
}

const START_MS = 60_000
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
