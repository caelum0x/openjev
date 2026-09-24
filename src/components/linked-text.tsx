import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * In-app pages that content strings mention by path. A bare mention such as
 * "see /leaderboard" is rendered as a real link; the same path inside an API
 * route ("/api/v1/calibrations") or a URL is left alone.
 */
const LINKABLE_PATHS = ["/leaderboard", "/calibrations", "/shadow", "/status", "/self-hosting"] as const;

type LinkablePath = (typeof LINKABLE_PATHS)[number];

const PATH_RE = new RegExp(
  `(?<![\\w/.:-])(${LINKABLE_PATHS.map((p) => p.replace("/", "\\/")).join("|")})(?![\\w/-])`,
  "g",
);

/** Split `text` into plain segments and linkable path mentions. */
function splitPathMentions(text: string): Array<{ text: string; path: LinkablePath | null }> {
  const out: Array<{ text: string; path: LinkablePath | null }> = [];
  let last = 0;
  for (const m of text.matchAll(PATH_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), path: null });
    out.push({ text: m[0], path: m[0] as LinkablePath });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), path: null });
  return out;
}

/** Render a content string with in-app path mentions turned into links. */
export function LinkedText({ text }: { text: string }): ReactNode {
  const parts = splitPathMentions(text);
  if (parts.length === 1 && !parts[0]!.path) return text;
  return parts.map((p, i) =>
    p.path ? (
      <Link key={i} to={p.path} className="text-fg underline underline-offset-2 hover:opacity-80">
        {p.text}
      </Link>
    ) : (
      <Fragment key={i}>{p.text}</Fragment>
    ),
  );
}
