/**
 * Files in Supabase Storage (payment proofs, supplier bills) are saved as a "public" address in old rows.
 * Opening them through here asks the server for a short-lived signed address, so the buckets can be made
 * private (sql/storage_privado.sql) without losing any old link. While the bucket is still public, the
 * signed address works too; if signing fails, the stored address is used as before.
 */
const STORED_RE = /\/storage\/v1\/object\/(?:public|sign)\/([^/?#]+)\/([^?#]+)/

/** { bucket, path } of a stored Supabase address, or null when it is not one. */
export function parseStoredUrl(url) {
  const m = String(url || '').match(STORED_RE)
  if (!m) return null
  let path = m[2]
  try { path = decodeURIComponent(path) } catch { /* keep as is */ }
  return { bucket: m[1], path }
}

export async function signedFileUrl(supabase, url, seconds = 300) {
  const at = parseStoredUrl(url)
  if (!at || !supabase?.storage) return url
  try {
    const { data, error } = await supabase.storage.from(at.bucket).createSignedUrl(at.path, seconds)
    if (!error && data?.signedUrl) return data.signedUrl
  } catch { /* fall through */ }
  return url
}

/** onClick for <a href={storedUrl}>: opens the signed address in a new tab. */
export function openStoredFile(supabase, url) {
  return async e => {
    if (!parseStoredUrl(url)) return
    e.preventDefault()
    // Open the tab inside the click (pop-up blockers), then point it at the signed address.
    const tab = window.open('', '_blank', 'noopener=no')
    const signed = await signedFileUrl(supabase, url)
    if (tab) { try { tab.opener = null } catch { /* ignore */ } tab.location.href = signed } else window.location.href = signed
  }
}
