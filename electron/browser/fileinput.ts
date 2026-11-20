import type { WebContents } from "electron"
import { cdpAnswer } from "./cdp.ts"
import { EVALUATED, RESOLVED } from "./cdpwire.ts"

const ITSELF_OR_THE_HIDDEN_ONE_ITS_BUTTON_OPENS = `function () {
  const own = (e) => e instanceof HTMLInputElement && e.type === "file" ? e : null
  for (let e = this; e; e = e.parentElement) { const hit = own(e) ?? e.querySelector("input[type=file]"); if (hit) return hit }
  const all = this.ownerDocument.querySelectorAll("input[type=file]")
  return all.length === 1 ? all[0] : null
}`

export async function fileInputNear(wc: WebContents, id: number): Promise<string> {
  const { object } = await cdpAnswer(wc, RESOLVED, "DOM.resolveNode", { backendNodeId: id })
  const { result } = await cdpAnswer(wc, EVALUATED, "Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: ITSELF_OR_THE_HIDDEN_ONE_ITS_BUTTON_OPENS })
  if (!result.objectId) throw new Error("upload: no file input there, nor one near it: the button that picks a file, or the input's ref")
  return result.objectId
}
