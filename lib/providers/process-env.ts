const INHERITED_PROVIDER_ENV = new Set([
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);

/**
 * Native provider processes are outside Metis' trust boundary. Give them only
 * the operating-system values needed to start plus credentials explicitly
 * supplied by their adapter. In particular, never inherit the app's database,
 * encryption, login, MCP root-token, or deployment environment.
 */
export function providerProcessEnv(
  extra: Record<string, string | undefined> = {},
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv & Record<string, string> {
  const env = {} as NodeJS.ProcessEnv & Record<string, string>;
  for (const [key, value] of Object.entries(source)) {
    if (INHERITED_PROVIDER_ENV.has(key) && typeof value === "string") {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}
