/**
 * Inline markdown for the glass.
 *
 * Not the app's `AIResponse` renderer: that one is built for reading a document
 * in a panel — its own type scale, margins, code blocks, images, links. On a
 * teleprompter every one of those fights the crawl. What's wanted is the same
 * line of type, with bold actually bold and a list actually a list.
 *
 * Block-level spacing and size stay with the crawl, which already knows what
 * kind of block this is, so the overrides here strip markdown's own.
 */
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { GlassLink, bareAddress } from "./linked-text";
import { TYPE } from "./teleprompter-settings";

const COMPONENTS: Components = {
  // The crawl supplies the wrapper element and its margin.
  p: ({ children }) => <>{children}</>,
  // Markers inside the text flow, so they stay with the centred column instead
  // of hanging off in space to the left of it.
  ul: ({ children }) => <ul className="list-inside list-disc">{children}</ul>,
  // `start` carries on the count: a step list broken by a cue or a command
  // resumes at 5, not back at 1.
  ol: ({ children, start }) => (
    <ol className="list-inside list-decimal" start={start}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="mb-2 last:mb-0">{children}</li>,
  // Medium rather than bold, and explicit rather than `bolder`. Emphasis is
  // carried mostly by colour here, so the weight only has to be enough to read
  // as deliberate — and a true bold blooms through the glass, which is exactly
  // what the light body weight is there to avoid.
  strong: ({ children }) => (
    <strong style={{ fontWeight: 500, color: TYPE.boldColor }}>
      {children}
    </strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-white/10 px-1 py-0.5">{children}</code>
  ),
  a: ({ children, href }) => (
    <GlassLink href={href}>{urlLabel(children, href) ?? children}</GlassLink>
  ),
  // Headings are their own block kind, split out before this ever runs.
  h1: ({ children }) => <>{children}</>,
  h2: ({ children }) => <>{children}</>,
  h3: ({ children }) => <>{children}</>,
};

/**
 * What to show for a link whose label is the address itself — the `https://…`
 * a writer dropped into a sentence, which GFM turns into a link on its own.
 * Null for a written label like `[the docs](…)`: those are words the author
 * chose to be read aloud, shown exactly as written.
 */
function urlLabel(
  children: ReactNode,
  href: string | undefined
): string | null {
  const label =
    Array.isArray(children) && children.length === 1 ? children[0] : children;
  if (!href || typeof label !== "string") return null;

  // How GFM writes the literal forms it recognises: bare (already carrying its
  // protocol), `www.` (which gains one), and an email address (which gains
  // `mailto:`).
  const isUrlItself =
    href === label ||
    href === `https://${label}` ||
    href === `http://${label}` ||
    href === `mailto:${label}`;
  return isUrlItself ? bareAddress(label) : null;
}

const PLUGINS = [remarkGfm];

export function ScriptMarkdown(props: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
      {props.children}
    </ReactMarkdown>
  );
}
