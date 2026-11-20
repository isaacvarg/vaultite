import { lazy, memo, Suspense } from "react"
import { getStore } from "@/core/data"
import { folderList, isHidden } from "@/core/files"
import { post } from "@/core/http"
import { notifyError } from "@/core/notify"
import { signal } from "@/core/signal"
import { ARCHIVE_DIR } from "../../../core/fileprops.ts"
import { Arriving } from "@/components/kit"

export type FolderPick = {
  label: string; placeholder: string; verb: string
  not?: string
  folders: string[]; all: string[]
  onPick: (folder: string, made: boolean) => void
}
const Picker = lazy(() => import("@/components/FolderPickerList").then((m) => ({ default: m.Picker })))
let picking: FolderPick | null = null
const subs = signal()
export function pickFolder(p: FolderPick | null) { picking = p; subs.notify() }

/** A folder for a setting: one of the vault's (not hidden or archive ones), or one typed, made first. */
export function chooseFolder(label: string, onPick: (folder: string) => void) {
  const t = getStore()?.files
  if (!t) return
  const all = folderList(t)
  const folders = all.filter((f) => !isHidden(f) && !f.split("/").includes(ARCHIVE_DIR))
  pickFolder({ label, placeholder: "Choose a folder…", verb: "choose", folders, all, onPick: (f, made) => {
    if (!made) return onPick(f)
    post<{ path: string }>("folder", { path: f }).then((r) => onPick(r.path), (e) => notifyError(e, "Couldn't make the folder"))
  } })
}

export const FolderPicker = memo(function FolderPicker() {
  const p = subs.use(() => picking)
  return p ? <Suspense fallback={<Arriving />}><Picker key={`${p.label}\n${p.not ?? ""}`} p={p} onClose={() => pickFolder(null)} /></Suspense> : null
})

