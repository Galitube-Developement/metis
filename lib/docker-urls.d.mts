export function isDockerEnv(env?: Record<string, string | undefined>): boolean;
export function rewriteDockerServiceUrl(
  url: string,
  service: string,
  internalPort: number,
  env?: Record<string, string | undefined>,
): string;
