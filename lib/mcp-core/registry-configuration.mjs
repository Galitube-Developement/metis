// Translate official Registry metadata into a configuration form and connection values.
export const REGISTRY_SOURCE = 'https://registry.modelcontextprotocol.io';
const placeholders = value => [...String(value || '').matchAll(/\$?\{([^{}]+)\}/g)].map(match => match[1]);
const required = def => Boolean(def.isRequired ?? def.is_required ?? false);
const secret = (def, fallback = false) => Boolean(def.isSecret ?? def.is_secret ?? fallback);
const defaultValue = def => String(def.default ?? '');
function field(id, name, def = {}, fallbackSecret = false) {
  return { id, name, description: def.description || '', required: required(def),
    secret: secret(def, fallbackSecret), default: defaultValue(def),
    choices: Array.isArray(def.choices) ? def.choices.map(String) : [] };
}
function templateFields(fields, prefix, template, definitions = {}, fallbackSecret = false) {
  for (const name of new Set(placeholders(template))) {
    fields.push(field(prefix + name, name, { isRequired: true, ...definitions[name] }, fallbackSecret));
  }
}
function optionFields(kind, distribution) {
  const fields = [];
  if (kind === 'remote') {
    templateFields(fields, 'url:', distribution.url, distribution.variables);
    for (const header of distribution.headers || []) {
      if (!header.name) continue;
      if (placeholders(header.value).length) {
        templateFields(fields, 'header:' + header.name + ':', header.value, header.variables, true);
      } else if (!header.value || secret(header)) {
        fields.push(field('header:' + header.name, header.name, header, true));
      }
    }
  } else {
    for (const def of distribution.environmentVariables || distribution.environment_variables || []) {
      const item = typeof def === 'string' ? { name: def, isRequired: true } : def;
      if (item?.name) fields.push(field('env:' + item.name, item.name, item, true));
    }
    for (const [group, args] of [['runtime', distribution.runtimeArguments || distribution.runtime_arguments || []], ['package', distribution.packageArguments || distribution.package_arguments || []]]) {
      args.forEach((arg, index) => {
        if (!arg || typeof arg === 'string') return;
        const prefix = group + ':' + index + ':';
        if (placeholders(arg.value).length) templateFields(fields, prefix, arg.value, arg.variables);
        else if (arg.value === undefined) fields.push(field(prefix + 'value', arg.name || arg.valueHint || 'Argument ' + (index + 1), arg));
      });
    }
  }
  return [...new Map(fields.map(item => [item.id, item])).values()];
}
export function registryConnectionOptions(server) {
  const options = [];
  (server.remotes || []).forEach((remote, index) => {
    if (['streamable-http', 'streamable_http', 'http'].includes(String(remote.type || remote.transport).toLowerCase()) && remote.url) {
      options.push({ id: 'remote:' + index, label: 'Remote HTTP', kind: 'remote', fields: optionFields('remote', remote) });
    }
  });
  (server.packages || []).forEach((pkg, index) => {
    const type = String(pkg.registryType || pkg.registry_type).toLowerCase();
    if (['npm', 'pypi', 'oci'].includes(type) && pkg.identifier) {
      options.push({ id: 'package:' + index, label: type + ' · ' + pkg.identifier, kind: 'package', fields: optionFields('package', pkg) });
    }
  });
  return options;
}
export function configureRegistryConnection(server, optionId, input = {}) {
  const options = registryConnectionOptions(server);
  const option = options.find(item => item.id === optionId);
  if (!option) throw new Error('Select a supported connection method.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must contain named values.');
  const values = {};
  for (const [key, value] of Object.entries(input)) {
    if (!option.fields.some(item => item.id === key) || typeof value !== 'string' || value.length > 16384 || /[\r\n\0]/.test(value)) {
      throw new Error('Invalid connection configuration.');
    }
    values[key] = value;
  }
  const missing = [];
  for (const item of option.fields) {
    values[item.id] ||= item.default;
    if (item.required && !values[item.id]?.trim()) missing.push(item.name);
    if (values[item.id] && item.choices.length && !item.choices.includes(values[item.id])) throw new Error('Choose one of the listed values for ' + item.name + '.');
  }
  const substitute = (template, prefix, encode = false) => String(template || '').replace(/\$?\{([^{}]+)\}/g, (_, name) => {
    const value = values[prefix + name] || '';
    return encode ? encodeURIComponent(value) : value;
  });
  const index = Number(option.id.split(':')[1]);
  if (option.kind === 'remote') {
    const remote = server.remotes[index];
    const url = substitute(remote.url, 'url:', true);
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Connection URL must use HTTP or HTTPS.');
    const headers = {};
    for (const header of remote.headers || []) {
      if (!header.name) continue;
      const value = values['header:' + header.name] || substitute(header.value || header.default, 'header:' + header.name + ':');
      if (value) headers[header.name] = value;
    }
    return { option, missing, values, url, headers };
  }
  const pkg = server.packages[index];
  const resolveArgs = (args, group) => (args || []).flatMap((arg, index) => {
    if (typeof arg === 'string') return [arg];
    const prefix = group + ':' + index + ':';
    const value = arg.value === undefined ? values[prefix + 'value'] || '' : substitute(arg.value, prefix);
    if (!value) return [];
    return arg.type === 'named' && arg.name ? [arg.name, value] : [value];
  });
  const env = Object.fromEntries(option.fields.filter(item => item.id.startsWith('env:') && values[item.id]).map(item => [item.name, values[item.id]]));
  return { option, missing, values, env, pkg: { ...pkg, registryType: pkg.registryType || pkg.registry_type,
    runtimeArguments: resolveArgs(pkg.runtimeArguments || pkg.runtime_arguments, 'runtime'),
    packageArguments: resolveArgs(pkg.packageArguments || pkg.package_arguments, 'package') } };
}
export function redactRegistryError(error, values = {}) {
  let message = String(error || 'The MCP server did not respond to the connection test.');
  for (const value of Object.values(values).filter(value => typeof value === 'string' && value.length)) {
    message = message.split(value).join('[redacted]').split(encodeURIComponent(value)).join('[redacted]');
  }
  return message.slice(0, 600);
}
