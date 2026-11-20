import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OpError } from "./ops.ts"

export const PAGE_UPLOAD_MAX = 50 << 20

export async function pageFiles(vaultOrMachinePaths: unknown, absInVault: (vaultPath: string) => string, refusal?: (what: string) => Promise<string>) {
  const list = (Array.isArray(vaultOrMachinePaths) ? vaultOrMachinePaths : [vaultOrMachinePaths]).map((f) => String(f ?? "").trim()).filter(Boolean)
  if (!list.length) throw new OpError("upload needs `files`: vault paths (Attachments/cv.pdf), or absolute paths on this machine")
  let size = 0
  return Promise.all(list.map(async (f) => {
    let file: string
    if (path.isAbsolute(f) || f.startsWith("~/")) {
      const why = await refusal?.("giving a page a file from this machine")
      if (why) throw new OpError(`${why}: give a file in the vault instead`, 403)
      file = f.startsWith("~/") ? path.join(os.homedir(), f.slice(2)) : f
    } else file = absInVault(f)
    let data: Buffer
    try { data = fs.readFileSync(file) } catch { throw new OpError(`no file ${f}`, 404) }
    if ((size += data.length) > PAGE_UPLOAD_MAX) throw new OpError("upload takes 50 MB at most")
    return { name: path.basename(file), data: data.toString("base64") }
  }))
}
