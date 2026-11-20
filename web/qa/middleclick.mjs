// Middle click opens in a new tab (Back, Forward, the path bar) or closes a tab (a pane's tab menu, tab search). Throwaway server only.

//   node web/qa/middleclick.mjs <base url> <vault path>
// Paths: components/ViewBar.tsx, core/workspace.ts, core/links.ts, components/FileView.tsx, components/ContextMenu.tsx, components/Palette.tsx, components/TabSearch.tsx, plugins/core/web-viewer/WebPage.tsx
import { readdirSync } from "node:fs"
import path from "node:path"
import { qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
import { setAsideWorkspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT], browser, check, watch, noErrors, done } = await qa(import.meta.url)

const notes = readdirSync(path.join(VAULT, "Daily")).filter((f) => f.endsWith(".md")).sort().slice(0, 4).map((f) => `Daily/${f}`)
if (notes.length < 4) { console.error("the vault needs four notes in Daily/ (vau sandbox makes them)"); process.exit(2) }
const [a, b, c, d] = notes.map((f) => `file:${f}`)
const name = (to) => "abcd"[[a, b, c, d].indexOf(to)] ?? to
const putBackWorkspaces = setAsideWorkspaces(B)

const layout = { tabs: [
  { id: "ta", root: { id: "pa", to: b, back: [a], fwd: [c, d] }, focus: "pa" },
  { id: "tx", root: { id: "sx", dir: "row", sizes: [0.5, 0.5], kids: [{ id: "px", to: d }, { id: "py", to: c, back: [a, b] }] }, focus: "py" },
], active: "ta" }
const desc = (n) => (n.kids ? `[${n.kids.map(desc).join(" ")}]`
  : [...(n.stack ?? []).slice(0, n.stackAt ?? 0), n, ...(n.stack ?? []).slice(n.stackAt ?? 0)].map((p) => `${(p.back ?? []).map(name).join("")}|${name(p.to)}|${(p.fwd ?? []).map(name).join("")}`).join("+"))

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ }), ui = app(page)
  await page.goto(B)
  await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 }); await ui.saved()
  await page.evaluate((l) => localStorage.setItem("vaultite.tabs", JSON.stringify(l)), layout)
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(notes[1])}`)
  await page.waitForSelector("[data-tab-id='tx']", { timeout: 30000 }); await ui.idle()
  const tabs = () => page.evaluate(() => JSON.parse(localStorage.getItem("vaultite.tabs"))).then((l) => l.tabs.map((t) => desc(t.root) + (t.id === l.active ? "*" : "")).join(", "))
  const is = (want) => until(async () => (await tabs()) === want, 4000).then(Boolean)
  check("the tabs as seeded", await is("a|b|cd*, [|d| ab|c|]"), await tabs())

  const bar = (dir) => page.locator(`[data-pane-body]:visible [data-ui='button:nav:${dir}']`).first()
  await bar("back").click({ button: "middle" }); await ui.idle()
  check("Back, middle click: where it goes in a new tab behind, its history carried (b and on ahead of it)", await is("a|b|cd*, |a|bcd, [|d| ab|c|]"), await tabs())
  check("...and the pane stays where it was", (await page.evaluate(() => location.hash)).includes(encodeURIComponent(b.slice(5))), await page.evaluate(() => location.hash))

  await bar("forward").click({ button: "middle" }); await ui.idle()
  check("Forward, middle click: the next place in a new tab behind, after the last one opened", await is("a|b|cd*, |a|bcd, ab|c|d, [|d| ab|c|]"), await tabs())

  await bar("forward").click({ modifiers: ["ControlOrMeta", "Shift"] }); await ui.idle()
  check("Forward, ⌘⇧ click: in a new tab, shown, beside the one it came from", await is("a|b|cd, ab|c|d*, |a|bcd, ab|c|d, [|d| ab|c|]"), await tabs())

  await bar("back").click(); await ui.idle()
  check("Back, a plain click: walks the pane's own history", await is("a|b|cd, a|b|cd*, |a|bcd, ab|c|d, [|d| ab|c|]"), await tabs())

  await page.click("[data-tab-strip] [data-tab-id='tx']"); await ui.idle()
  await page.locator("[data-pane-body]:visible").nth(1).locator("[data-ui='button:nav:back']").click({ button: "middle" }); await ui.idle()
  check("a split's pane, Back middle-clicked: a place of its own in that pane, not shown", await is("a|b|cd, a|b|cd, |a|bcd, ab|c|d, [|d| ab|c|+a|b|c]*"), await tabs())

  await page.click("[data-tab-strip] [data-tab-id='ta']"); await ui.idle()
  await page.click("[data-tab-strip] [data-cell-more='py']"); await ui.idle()
  const other = page.locator("[role=menu] [role^=menuitem][aria-checked=false]")
  check("the pane's tab menu lists its other place", (await other.count()) === 1, await page.locator("[role=menu]").innerText().catch(() => ""))
  await other.click({ button: "middle" }); await ui.idle()
  check("...middle-clicked: that place closed, the menu gone", await is("a|b|cd*, a|b|cd, |a|bcd, ab|c|d, [|d| ab|c|]") && !(await page.locator("[role=menu]").count()), await tabs())

  await page.locator("[data-pane-body]:visible button[data-tip='Open folder']").first().click({ button: "middle" }); await ui.idle()
  check("the path bar's folder, middle-clicked: its page in a new tab behind", await is("a|b|cd*, |view:folder/Daily|, a|b|cd, |a|bcd, ab|c|d, [|d| ab|c|]"), await tabs())

  await page.keyboard.press("ControlOrMeta+Shift+a"); await page.waitForSelector("[role=dialog] input:focus"); await ui.idle()
  await page.locator("[role=dialog] [role=option]", { hasText: "Daily" }).first().click({ button: "middle" }); await ui.idle()
  check("tab search, middle click: that tab closed, the search still open", await is("a|b|cd*, a|b|cd, |a|bcd, ab|c|d, [|d| ab|c|]") && !!(await page.locator("[role=dialog] input").count()), await tabs())
  await page.keyboard.press("Escape"); await ui.idle()
  noErrors()
} catch (e) {
  check(String(e), false)
} finally {
  await browser.close()
  putBackWorkspaces()
}
await done()
