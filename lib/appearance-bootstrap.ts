import {
  THEME_PRESETS,
  THEME_VARIABLE_DEFAULTS,
  normalizeTheme,
  type ThemeDefinition,
} from "./appearance-theme";
import {
  APPEARANCE_STORAGE_CONFIG,
  APPLIED_THEME_VARIABLES_ATTRIBUTE,
  createDefaultAppearanceState,
  getSelectedTheme,
  normalizeAppearanceState,
  readAppearanceStateForBootstrap,
  type AppearanceStorageConfig,
} from "./appearance-storage";

export interface AppearanceBootstrapOptions {
  /** Account state takes precedence over browser storage; invalid state uses the default. */
  state?: unknown;
  /** Disable all browser storage reads for account-backed pages. Defaults to true. */
  allowLocalStorage?: boolean;
}

interface BootstrapConfig {
  storage: AppearanceStorageConfig;
  allowLocalStorage: boolean;
  initialTheme?: { id: string; theme: ThemeDefinition };
  ownedVariablesAttribute: string;
  defaults: Record<"dark" | "light", Readonly<Record<string, string>>>;
  presets: { id: string; mode: "dark" | "light"; variables: Record<string, string> }[];
}

/**
 * This function and the two shared parsers are serialized into an inline script.
 * Keep its body closure-free, without nested callbacks that bundlers may decorate.
 */
function bootstrapAppearance(
  config: BootstrapConfig,
  normalize: typeof normalizeTheme,
  readState: typeof readAppearanceStateForBootstrap,
): void {
  let selected = config.storage.defaultThemeId;
  let custom: ThemeDefinition | undefined;
  if (config.initialTheme) {
    selected = config.initialTheme.id;
    custom = config.initialTheme.theme;
  } else if (config.allowLocalStorage) {
    try {
      const state = readState(window.localStorage, config.storage, normalize);
      selected = state.selected;
      for (const item of state.customThemes) {
        if (item.id === selected) custom = item.theme;
      }
    } catch {
      // Reading localStorage itself can throw before the shared reader is called.
    }
  }

  let preset = config.presets[0];
  for (const item of config.presets) {
    if (item.id === selected) preset = item;
  }
  const theme = custom ?? preset;
  const variables = Object.assign({}, config.defaults[theme.mode], theme.variables);
  const root = document.documentElement;
  for (const name of Object.keys(variables)) root.style.setProperty(name, variables[name]);
  root.classList.toggle("dark", theme.mode === "dark");
  root.setAttribute("data-surface", selected);
  root.setAttribute(config.ownedVariablesAttribute, JSON.stringify(Object.keys(variables)));
  root.style.colorScheme = theme.mode;
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Apply the persisted theme synchronously in the document head, before paint. */
export function createAppearanceBootstrapScript(options: AppearanceBootstrapOptions = {}): string {
  let initialTheme: BootstrapConfig["initialTheme"];
  if (Object.prototype.hasOwnProperty.call(options, "state")) {
    let state = createDefaultAppearanceState();
    try { state = normalizeAppearanceState(options.state); } catch { /* Invalid account data uses the default. */ }
    initialTheme = { id: state.selected, theme: getSelectedTheme(state) };
  }
  const config: BootstrapConfig = {
    storage: APPEARANCE_STORAGE_CONFIG,
    allowLocalStorage: options.allowLocalStorage !== false,
    initialTheme,
    ownedVariablesAttribute: APPLIED_THEME_VARIABLES_ATTRIBUTE,
    defaults: THEME_VARIABLE_DEFAULTS,
    // Defaults are shared once; keep only each preset's distinct overrides.
    presets: THEME_PRESETS.map((preset) => ({
      id: preset.id,
      mode: preset.mode,
      variables: Object.fromEntries(Object.entries(preset.variables).filter(
        ([name, value]) => value !== THEME_VARIABLE_DEFAULTS[preset.mode][name],
      )),
    })),
  };

  return "(" + bootstrapAppearance.toString() + ")(" + inlineJson(config) + ",(" +
    normalizeTheme.toString() + "),(" + readAppearanceStateForBootstrap.toString() + "));";
}
