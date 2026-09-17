const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

export function isDockerEnv(env = process.env) {
  const value = String(env.METIS_DOCKER || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function rewriteDockerServiceUrl(url, service, internalPort, env = process.env) {
  if (!url || !isDockerEnv(env)) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) return url;
  parsed.protocol = "http:";
  parsed.hostname = service;
  parsed.port = String(internalPort);
  const out = parsed.toString();
  if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
    return out.replace(/\/$/, "");
  }
  return out;
}
