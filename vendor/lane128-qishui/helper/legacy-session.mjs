// Local qishui migration adapter. Original credentials remain untouched.
export const MIGRATION_KEY = 'native-migration-v1'
const SESSION_NAMES = new Set(['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt'])
export function legacySession(storage, identityFactory) {
  if (storage.get(MIGRATION_KEY) === 1 || storage.get('authBackend') !== 'sdk-v1') return null
  const raw = storage.get('cookie')
  if (typeof raw !== 'string' || !raw || raw.length > 16384 || /[\x00-\x1f\x7f]/.test(raw)) return null
  const parts = raw.split(';')
  if (parts.length > 128) return null
  const cookies = [], seen = new Set()
  for (const part of parts) {
    const split = part.indexOf('=')
    if (split < 1) return null
    const name = part.slice(0, split).trim(), value = part.slice(split + 1).trim()
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || !/^[\x21-\x3A\x3C-\x7E]+$/.test(value) || seen.has(name)) return null
    seen.add(name)
    cookies.push({ name, value })
  }
  if (!cookies.some(c => SESSION_NAMES.has(c.name))) return null
  const { deviceID, installID } = identityFactory()
  return { version: 1, deviceID, installID, cookies }
}
