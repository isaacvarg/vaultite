import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { Item, Vault } from "./vault.ts"

export const VAULT_SETTINGS = "vault"
const MAX = 80

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean)
export const folderName = (p: string) => parts(p).at(-1) ?? p

const VaultSettings = z.looseObject({ name: z.string().catch("").default("") }).catch({ name: "" })
export const nicknameOf = (settings: Item) => VaultSettings.parse(settings).name.replace(/\s+/g, " ").trim().slice(0, MAX)

export const vaultName = (p: string, nickname = "") => nickname || folderName(p)

export const ownNickname = (vault: Pick<Vault, "config">) => nicknameOf(vault.config(VAULT_SETTINGS))

export async function nicknameAt(dir: string, ms = 1000): Promise<string | null> {
  const read = fs.promises.readFile(path.join(dir, ".vaultite", `${VAULT_SETTINGS}.json`), "utf8")
    .then((t) => nicknameOf(JSON.parse(t)), () => "")
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((done) => { timer = setTimeout(() => done(null), ms); timer.unref?.() })
  try { return await Promise.race([read, late]) } finally { clearTimeout(timer) }
}

export type Named = { path: string; nickname?: string }

export function listNames(vaults: Named[]): string[] {
  const names = vaults.map((v) => vaultName(v.path, v.nickname))
  return vaults.map((v, i) => {
    const others = vaults.flatMap((o, j) => (j !== i && names[j] === names[i] ? [parts(o.path)] : []))
    if (!others.length) return names[i]
    const mine = parts(v.path), tail = (ps: string[], n: number) => ps.slice(-n).join("/")
    let n = v.nickname ? 1 : 2
    while (n < mine.length && others.some((o) => tail(o, n) === tail(mine, n))) n++
    return v.nickname ? `${names[i]} · ${tail(mine, n)}` : tail(mine, n)
  })
}
