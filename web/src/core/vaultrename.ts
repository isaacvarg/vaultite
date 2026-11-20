import { PencilLine } from "lucide-react"
import { askText } from "@/components/Chooser"
import { getStore, vaultFolder, vaultName } from "@/core/data"
import { relistVaults } from "@/core/desktopapp"
import { api } from "@/core/http"
import { notifyError } from "@/core/notify"

export const canRenameVault = () => !!getStore() && !getStore()!.vault.sandbox

export function renameVault() {
  const s = getStore()
  if (!s || s.vault.sandbox) return
  const name = vaultName(s), folder = vaultFolder(s), set = (to: string | null) =>
    api("PATCH", "config/vault", { name: to }).then(relistVaults, (e) => notifyError(e, "Couldn't rename the vault"))
  askText({
    title: "Rename vault", heading: `Rename vault "${name}"`, placeholder: "Name this vault…", typed: s.vault.nickname ?? "",
    hint: s.vault.nickname ? `Enter to go back to its folder's name, "${folder}"` : `Type a name: the folder keeps its own, "${folder}"`,
    label: (t) => `Rename to "${t}"`, icon: PencilLine, onText: (t) => void set(t === folder ? null : t), onBlank: () => void set(null),
  })
}
