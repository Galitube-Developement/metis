"use client";

import {
  memo,
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { ChatIcon } from "@/components/chat-icon";
import { remarkChatIcons } from "@/lib/markdown-icons";
import { FileEmbed } from "@/components/file-embed";
import { parseFileEmbed, isFileUrl, mimeTypeFromFileName } from "@/lib/file-types";
import { normalizeMath, splitStreamingMath } from "@/lib/math";
import { LinkPreview } from "@/components/link-preview";
import { ThinkingBlock } from "@/components/thinking-block";
import { GraphBoard } from "@/components/graph-board";
import { ChartBoard } from "@/components/chart-board";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { isChartSource } from "@/lib/chart-spec";
import { isGraphSource } from "@/lib/graph-spec";
import { isMermaidSource, wrapBareMermaid } from "@/lib/mermaid";
import { ExternalLink, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STREAMING_RENDER_INTERVAL_MS, shouldFlushStreamingRender } from "@/lib/streaming-render";

export { normalizeMath, splitStreamingMath } from "@/lib/math";

function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isWebUrl = Boolean(href && /^https?:\/\//i.test(href));
  const [hovered, setHovered] = useState(false);
  const [modifierHeld, setModifierHeld] = useState(false);
  useEffect(() => {
    if (!hovered) return;
    const updateModifier = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(true);
    };
    const clearModifier = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(false);
    };
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", clearModifier);
    return () => {
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", clearModifier);
    };
  }, [hovered]);
  const isSubagentUrl = Boolean(href && /^subagent:\/\//i.test(href));
  const workspaceMatch = href?.match(/^workspace:\/\/(plan|canvas)\/([^/?#]+)(?:[?#].*)?$/i);
  const noteMatch = href?.match(/^note:\/\/([^/?#]+)(?:[?#].*)?$/i);
  const automationMatch = href?.match(/^automation:\/\/([^/?#]+)(?:[?#].*)?$/i);
  const childText = typeof children === "string"
    ? children
    : Array.isArray(children)
      ? children.filter((child): child is string => typeof child === "string").join("")
      : "";
  const sourceTitle = childText.match(/^(?:source|quelle)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
  const link = (
    <a
      {...props}
      href={
        workspaceMatch
          ? `#workspace-${workspaceMatch[2]}`
          : noteMatch
            ? `#note-${noteMatch[1]}`
            : automationMatch
              ? `#automation-${automationMatch[1]}`
              : href
      }
      className={cn(
        props.className,
        sourceTitle && "inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium no-underline hover:bg-secondary",
      )}
      onClick={(event) => {
        if (workspaceMatch) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-workspace", {
              detail: {
                type: workspaceMatch[1].toLowerCase(),
                id: decodeURIComponent(workspaceMatch[2]),
              },
            }),
          );
          return;
        }
        if (noteMatch) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-note", {
              detail: { id: decodeURIComponent(noteMatch[1]) },
            }),
          );
          return;
        }
        if (automationMatch) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-automations", {
              detail: { id: decodeURIComponent(automationMatch[1]) },
            }),
          );
          return;
        }
        if (isSubagentUrl && href) {
          event.preventDefault();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-subagent", {
              detail: href.slice("subagent://".length),
            }),
          );
          return;
        }
        if (!isWebUrl || !href) return;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("ai-chat:open-browser", { detail: href }));
      }}
      onMouseEnter={(event) => {
        setHovered(true);
        setModifierHeld(event.ctrlKey || event.metaKey);
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        setModifierHeld(false);
        props.onMouseLeave?.(event);
      }}
    >
      {sourceTitle ? (
        <>
          <Link2 className="size-3 shrink-0" aria-hidden="true" />
          {sourceTitle}
        </>
      ) : children}
      {isWebUrl && hovered && modifierHeld ? (
        <ExternalLink className="ml-1 inline size-3.5 animate-in fade-in text-muted-foreground" aria-label="Ctrl-click opens in a new tab" />
      ) : null}
    </a>
  );
  return isWebUrl && href ? <LinkPreview href={href}>{link}</LinkPreview> : link;
}

const markdownComponents = {
  a: MarkdownLink,
  span: ({ children, ...props }: HTMLAttributes<HTMLSpanElement> & { "data-metis-icon"?: string }) => props["data-metis-icon"]
    ? <ChatIcon name={props["data-metis-icon"]} className="mr-1.5 inline-block size-[1.1em] align-[-0.15em] text-current" />
    : <span {...props}>{children}</span>,
};

export interface ThinkingSegment {
  kind: "text" | "thinking";
  text: string;
  complete?: boolean;
}

export function splitThinkingBlocks(content: string): ThinkingSegment[] {
  const tagPattern = /<\/?thinking\s*>/gi;
  const segments: ThinkingSegment[] = [];
  let cursor = 0;
  let mode: ThinkingSegment["kind"] = "text";
  let thinkingStart = -1;

  for (const match of content.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    const tag = match[0];
    const isClosing = tag.startsWith("</");

    if (mode === "text" && !isClosing) {
      if (index > cursor) segments.push({ kind: "text", text: content.slice(cursor, index) });
      mode = "thinking";
      thinkingStart = index + tag.length;
      cursor = thinkingStart;
    } else if (mode === "thinking" && isClosing) {
      if (index > thinkingStart) {
        segments.push({ kind: "thinking", text: content.slice(thinkingStart, index), complete: true });
      }
      mode = "text";
      cursor = index + tag.length;
    }
  }

  if (mode === "thinking") {
    segments.push({ kind: "thinking", text: content.slice(thinkingStart), complete: false });
  } else if (cursor < content.length || segments.length === 0) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }

  return segments.filter((segment) => segment.text.length > 0 || segment.kind === "thinking");
}

function transformMarkdownUrl(url: string) {
  if (/^(workspace|note|subagent|automation):\/\//i.test(url)) return url;
  return defaultUrlTransform(url);
}

function CodeBlock({
  className,
  children,
  inline,
  editableFiles,
  ...props
}: HTMLAttributes<HTMLElement> & { inline?: boolean; editableFiles?: boolean }) {
  const code = String(children).replace(/\n$/, "");
  const isInline = inline ?? (!className && !code.includes("\n"));
  const fileRoot = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  if (isInline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  const declaredLanguage = className?.match(/language-([\w-]+)/)?.[1];
  const file = declaredLanguage === "file" ? parseFileEmbed(code) : null;
  if (file) return <div ref={fileRoot} data-editor-control="file" onPointerDown={e=>e.stopPropagation()}>
    <FileEmbed file={file} className="my-2 min-h-40 rounded border border-border/40"
      onChange={editableFiles ? next => { fileRoot.current?.dispatchEvent(new CustomEvent("metis:markdown-embed-change", {bubbles:true,detail:{kind:"file",source:JSON.stringify(next)}})); } : undefined}
      onRemove={editableFiles ? () => { fileRoot.current?.dispatchEvent(new CustomEvent("metis:markdown-embed-change",{bubbles:true,detail:{kind:"file",source:""}})); } : undefined}/>
  </div>;
  if (isChartSource(declaredLanguage, code)) {
    return <ChartBoard code={code} language={declaredLanguage} />;
  }
  if (isGraphSource(declaredLanguage, code)) {
    return <GraphBoard code={code} language={declaredLanguage} />;
  }
  if (isMermaidSource(declaredLanguage, code)) {
    return <MermaidDiagram code={code} language={declaredLanguage} />;
  }
  const detectedLanguage =
    declaredLanguage && hljs.getLanguage(declaredLanguage)
      ? declaredLanguage
      : hljs.highlightAuto(code).language;
  const highlighted = detectedLanguage
    ? hljs.highlight(code, { language: detectedLanguage }).value
    : hljs.highlightAuto(code).value;
  return (
    <div className="group relative">
      <pre className="markdown-code-block" {...props}>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-sans uppercase tracking-wide text-muted-foreground/70">
          <span>{detectedLanguage || "text"}</span>
        </div>
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
      <button
        type="button"
        className="absolute top-2 right-2 rounded border border-border/50 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground opacity-100 transition-opacity hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TaskCheckbox({
  interactive,
  checked,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { interactive?: boolean }) {
  const [value, setValue] = useState(Boolean(checked));
  useEffect(() => {
    setValue(Boolean(checked));
  }, [checked]);
  return (
    <input
      {...props}
      type="checkbox"
      checked={value}
      disabled={!interactive}
      contentEditable={false}
      onPointerDown={(event) => {
        event.stopPropagation();
        props.onPointerDown?.(event);
      }}
      onChange={(event) => {
        setValue(event.currentTarget.checked);

      }}
    />
  );
}

export const Markdown = memo(function Markdown({
  content,
  streaming = false,
  interactiveTasks = false,
  thinkingDurationMs,
  editableFiles = false,
}: {
  content: string;
  streaming?: boolean;
  interactiveTasks?: boolean;
  thinkingDurationMs?: number;
  editableFiles?: boolean;
}) {
  const thinkingSegments = splitThinkingBlocks(content);
  if (thinkingSegments.some((segment) => segment.kind === "thinking")) {
    return (
      <div className="markdown-body">
        {thinkingSegments.map((segment, index) =>
          segment.kind === "thinking" ? (
            <ThinkingBlock
              key={`thinking-${index}`}
              text={segment.text}
              done={Boolean(segment.complete)}
              durationMs={thinkingDurationMs}
            />
          ) : segment.text ? (
            <Markdown
              key={`text-${index}`}
              content={segment.text}
              streaming={streaming}
              interactiveTasks={interactiveTasks}
              editableFiles={editableFiles}
              thinkingDurationMs={thinkingDurationMs}
            />
          ) : null,
        )}
      </div>
    );
  }

  const markdownComponentsWithCode = {
    ...markdownComponents,
    pre: ({ children }: HTMLAttributes<HTMLPreElement>) => <>{children}</>,
    code: (props: HTMLAttributes<HTMLElement>) => <CodeBlock {...props} editableFiles={editableFiles}/>,
    a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => props.href && isFileUrl(props.href) ? <FileEmbed file={{url:props.href,name:String(props.children || "File"),mimeType:mimeTypeFromFileName(String(props.children || "File"))}} className="my-2 max-h-96"/> : <MarkdownLink {...props}/>,
    img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => typeof props.src === "string" && isFileUrl(props.src) ? <FileEmbed file={{url:props.src,name:props.alt || "Image",mimeType:mimeTypeFromFileName(props.alt || "image.png")}} className="my-2 max-h-96"/> : <img {...props} alt={props.alt || "Image"}/>,
    p: ({children}: HTMLAttributes<HTMLParagraphElement>) => Children.toArray(children).some(child => isValidElement<{href?:string;src?:string}>(child) && isFileUrl(child.props.href || child.props.src || "")) ? <div className="my-2">{children}</div> : <p>{children}</p>,
    input: (props: InputHTMLAttributes<HTMLInputElement>) => (
      <TaskCheckbox {...props} interactive={interactiveTasks} />
    ),
  };
  if (streaming) {
    const { ready, pending } = splitStreamingMath(content);
    return (
      <div className="markdown-body">
        {ready ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkChatIcons]}
            rehypePlugins={[
              [rehypeKatex, { throwOnError: false, strict: "ignore" }],
            ]}
            urlTransform={transformMarkdownUrl}
            components={markdownComponentsWithCode}
          >
            {wrapBareMermaid(ready)}
          </ReactMarkdown>
        ) : null}
        {pending ? (
          <span className="whitespace-pre-wrap text-muted-foreground/80">
            {pending}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkChatIcons]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: "ignore" }],
        ]}
        urlTransform={transformMarkdownUrl}
        components={markdownComponentsWithCode}
      >
        {wrapBareMermaid(normalizeMath(content))}
      </ReactMarkdown>
    </div>
  );
});

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  thinkingDurationMs,
}: {
  content: string;
  thinkingDurationMs?: number;
}) {
  const [shown, setShown] = useState(content);
  const latestRef = useRef(content);
  const shownRef = useRef(shown);
  const timerRef = useRef<number | null>(null);
  latestRef.current = content;
  shownRef.current = shown;

  useEffect(() => {
    const next = latestRef.current;
    const current = shownRef.current;
    if (next === current) return;
    if (shouldFlushStreamingRender(current, next)) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShown(next);
      return;
    }
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setShown(latestRef.current);
    }, STREAMING_RENDER_INTERVAL_MS);
  }, [content]);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  return <Markdown content={shown} streaming thinkingDurationMs={thinkingDurationMs} />;
});
