import { Children, isValidElement, type ReactNode } from "react";

function linkText(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    // Markdown formatting and streaming spans carry the original text in children.
    // Read their props without executing components or flattening rendered HTML.
    return isValidElement<{ children?: ReactNode }>(child) ? linkText(child.props.children) : "";
  }).join("");
}

export function markdownSourceTitle(children: ReactNode) {
  return linkText(children).trim().match(/^(?:source|quelle)\s*[:\-]\s*(.+)$/i)?.[1]?.trim() || null;
}
