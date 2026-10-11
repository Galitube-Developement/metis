import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { registryConnectionOptions, configureRegistryConnection, redactRegistryError } from '../lib/mcp-core/registry-configuration.mjs';

test('configuration follows the selected distribution, with descriptions and defaults', () => {
  const server = { remotes: [{ type: 'streamable-http', url: 'https://service.test/{workspace}/mcp', variables: { workspace: { description: 'Your workspace ID', default: 'demo' } }, headers: [{ name: 'Authorization', value: 'Bearer {token}', variables: { token: { description: 'Create an API key', isSecret: true } } }] }],
    packages: [{ registryType: 'npm', identifier: 'test-mcp', environmentVariables: [{ name: 'PACKAGE_TOKEN', isRequired: true }] }] };
  const options = registryConnectionOptions(server);
  assert.equal(options.length, 2);
  assert.deepEqual(options[0].fields.map(item => item.name), ['workspace', 'token']);
  assert.equal(options[0].fields[1].description, 'Create an API key');
  const configured = configureRegistryConnection(server, 'remote:0', { 'header:Authorization:token': 'secret-token', 'url:workspace': 'my team' });
  assert.equal(configured.url, 'https://service.test/my%20team/mcp');
  assert.equal(configured.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(configured.missing, []); // No unrelated package credential is requested.
  assert.deepEqual(configureRegistryConnection(server, 'remote:0').missing, ['token']);
});

test('plain secret headers and optional fields are configurable without environment-name restrictions', () => {
  const server = { remotes: [{ type: 'http', url: 'https://service.test/mcp', headers: [{ name: 'X-API-Key', isRequired: true, isSecret: true }, { name: 'X-Mode', value: 'fixed' }, { name: 'X-Team', isRequired: false }] }] };
  const configured = configureRegistryConnection(server, 'remote:0', { 'header:X-API-Key': 'key-value' });
  assert.deepEqual(configured.headers, { 'X-API-Key': 'key-value', 'X-Mode': 'fixed' });
  assert.deepEqual(configured.missing, []);
});

test('package environment and argument fields resolve safely into individual arguments', () => {
  const server = { packages: [{ registryType: 'npm', identifier: 'test-mcp',
    environmentVariables: [{ name: 'TOKEN', isRequired: true, description: 'Access token' }, { name: 'MODE', default: 'read', choices: ['read', 'write'] }],
    packageArguments: [{ type: 'named', name: '--workspace', isRequired: true }, { type: 'positional', value: '{folder}', variables: { folder: { default: '/tmp/a b' } } }],
    runtimeArguments: [{ type: 'named', name: '--registry', default: 'https://registry.npmjs.org' }] }] };
  const configured = configureRegistryConnection(server, 'package:0', { 'env:TOKEN': 'private', 'package:0:value': 'my team' });
  assert.deepEqual(configured.env, { TOKEN: 'private', MODE: 'read' });
  assert.deepEqual(configured.pkg.packageArguments, ['--workspace', 'my team', '/tmp/a b']);
  assert.deepEqual(configured.pkg.runtimeArguments, ['--registry', 'https://registry.npmjs.org']);
  assert.throws(() => configureRegistryConnection(server, 'package:0', { 'env:MODE': 'delete' }), /listed values/);
});

test('invalid methods, unknown input and header injection are rejected; errors redact supplied secrets', () => {
  const server = { remotes: [{ type: 'http', url: 'https://service.test/mcp', headers: [{ name: 'Authorization', isRequired: true }] }] };
  assert.throws(() => configureRegistryConnection(server, 'package:0'), /supported/);
  assert.throws(() => configureRegistryConnection(server, 'remote:0', { command: 'unexpected' }), /Invalid/);
  assert.throws(() => configureRegistryConnection(server, 'remote:0', { 'header:Authorization': 'token\r\nX-Evil: yes' }), /Invalid/);
  assert.equal(redactRegistryError('Rejected private+token and private%2Btoken', { token: 'private+token' }), 'Rejected [redacted] and [redacted]');
});

test('provisioning tests real MCP authentication, saves credentials per connection and does not enable failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metis-registry-config-'));
  process.env.AI_CHAT_ROOT = root;
  process.env.AI_CHAT_MCP_STATE_DIR = path.join(root, 'state');
  const { loadMcpSdk } = await import('../lib/mcp-core/sdk-runtime.mjs');
  const { Server, StreamableHTTPServerTransport, ListToolsRequestSchema } = await loadMcpSdk();
  const transports = [];
  const servers = [];
  const endpoint = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer fixture-secret') {
      res.writeHead(403); res.end('Credential rejected'); return;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'fixture_tool', inputSchema: { type: 'object' } }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    transports.push(transport); servers.push(server);
    await server.connect(transport);
    await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString()));
  });
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + endpoint.address().port + '/mcp';
  const catalogDir = path.join(root, 'state', 'autobroker');
  await fs.mkdir(catalogDir, { recursive: true });
  await fs.writeFile(path.join(catalogDir, 'catalog.json'), JSON.stringify({ version: 'fixture', servers: {
    'fixture/remote': { name: 'fixture/remote', title: 'Fixture MCP', status: 'active', version: '1', remotes: [{ type: 'http', url, headers: [{ name: 'Authorization', value: 'Bearer {token}' }] }], packages: [] },
  } }));
  try {
    const { provision, searchCatalog } = await import('../lib/mcp-core/registry-manager.mjs');
    const search = await searchCatalog({ query: 'Fixture', installableOnly: true });
    assert.match(search.source, /^https:\/\/registry\.modelcontextprotocol\.io\//);
    assert.equal(search.results[0].connectionOptions[0].fields[0].name, 'token');
    const missing = await provision('fixture/remote', { optionId: 'remote:0', configuration: {} });
    assert.deepEqual(missing.missingRequiredSecrets, ['token']);
    await assert.rejects(fs.access(path.join(root, 'state', 'registry.json')));
    const failed = await provision('fixture/remote', { optionId: 'remote:0', configuration: { 'header:Authorization:token': 'wrong-secret' } });
    assert.equal(failed.enabled, false);
    assert.match(failed.probe.error, /Credential rejected/);
    const success = await provision('fixture/remote', { optionId: 'remote:0', configuration: { 'header:Authorization:token': 'fixture-secret' } });
    assert.equal(success.enabled, true);
    assert.equal(success.probe.count, 1);
    assert.doesNotMatch(JSON.stringify(success), /fixture-secret/);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'state', 'registry.json'), 'utf8'));
    assert.equal(saved.servers[0].headers.Authorization, 'Bearer fixture-secret');
    assert.equal(saved.servers[0].enabled, true);
    assert.equal((await fs.stat(path.join(root, 'state', 'registry.json'))).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(path.join(root, 'state', 'secrets.env'), 'utf8'), '');
  } finally {
    await Promise.all(servers.map(server => server.close()));
    await new Promise(resolve => endpoint.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
