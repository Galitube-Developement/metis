const OPERATIONAL_ENV = new Set([
  "PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "COLORTERM",
  "TMPDIR", "TMP", "TEMP", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
]);

export function toolExecutionEnv(source, identity, hostAdmin = false) {
  const result = hostAdmin ? { ...source } : Object.fromEntries(
    Object.entries(source).filter(([key, value]) => OPERATIONAL_ENV.has(key) && typeof value === "string"),
  );
  if (identity?.home) result.HOME = identity.home;
  if (identity?.username) {
    result.USER = identity.username;
    result.LOGNAME = identity.username;
  }
  return result;
}
