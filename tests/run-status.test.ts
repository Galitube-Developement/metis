import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { RunStatus } from "../components/run-status";

const render = (status: string, props = {}) => renderToStaticMarkup(createElement(RunStatus, { status, ...props }));
test("lifecycle states preserve readable labels and distinguish waiting, failures and completion", () => {
  for (const [status, kind, label] of [
    ["in_progress", "running", "Working"], ["pending", "queued", "Queued"],
    ["waiting_for_user", "waiting", "Waiting for you"], ["paused", "waiting", "Waiting for you"],
    ["failed", "error", "Needs attention"], ["interrupted", "error", "Needs attention"],
    ["completed", "completed", "Completed"], ["cancelled", "cancelled", "Cancelled"],
    ["idle", "idle", "Ready"], ["archived", "archived", "Archived"],
  ]) {
    const html = render(status);
    assert(html.includes('data-run-status="' + kind + '"'));
    assert(html.includes(">" + label + "</span>"));
    assert(html.includes('aria-hidden="true"'), "decorative icon must not be announced twice");
  }
  assert(render("completed", { label: "Replied" }).includes(">Replied</span>"));
  assert(render("unknown-state").includes(">unknown-state</span>"));
});
test("icon-only statuses keep accessible text while decorative indicators do not duplicate labels", () => {
  assert(render("queued", { iconOnly: true }).includes('class="sr-only">Queued</span>'));
  assert(!render("queued", { iconOnly: true, decorative: true }).includes("Queued"));
  assert(!render("running").includes("aria-live"), "polling must not repeatedly announce motion");
});
test("reduced motion overrides every status animation; only live states loop", () => {
  const css = postcss.parse(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"));
  const animationRules: Array<{selector: string; animation: string; reduced: boolean}> = [];
  css.walkRules(rule => {
    if (!rule.selector.startsWith(".run-status")) return;
    rule.walkDecls("animation", decl => { animationRules.push({
      selector: rule.selector, animation: decl.value,
      reduced: rule.parent?.type === "atrule" && (rule.parent as postcss.AtRule).params === "(prefers-reduced-motion: reduce)",
    }); });
  });
  for (const rule of animationRules.filter(rule => rule.animation.includes("infinite"))) {
    assert(/data-run-status="(running|queued|waiting)"/.test(rule.selector));
    const reduced = animationRules.find(r => r.reduced && r.animation === "none");
    assert(reduced);
    // Same selector specificity as live rules, ordered later in the stylesheet.
    assert.equal(reduced.selector, ".run-status[data-run-status] > .run-status-icon");
    assert(animationRules.indexOf(reduced) > animationRules.indexOf(rule));
  }
  assert.equal(animationRules.filter(r => r.animation.includes("infinite")).length, 3);
});
