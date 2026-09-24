/**
 * The single canonical stemmer for the engine.
 *
 * Both `vector.ts` (query/criteria tokenization) and `lexicon.ts` (synset index
 * keys) MUST stem identically: if they diverge, a state token and its synonym
 * entry can stem to different strings and the synset silently fails to fire
 * (e.g. "shipping" -> "ship" in one place but "shipp" in the other). Keeping one
 * exported function here is the fix — import it from both, never re-implement.
 *
 * This is a light Porter-style stemmer (zero-dep, deterministic): a small table
 * of common irregulars, then conservative suffix stripping with consonant
 * de-doubling on -ing/-ed. It intentionally under-stems short words to avoid
 * collapsing distinct criteria tokens.
 */

/**
 * Common irregulars where naive suffix stripping would produce the wrong (or a
 * divergent) stem. Mapped to a single shared root so paraphrases collide.
 */
const IRREGULAR: Readonly<Record<string, string>> = {
  paid: "pay",
  paying: "pay",
  pays: "pay",
  lost: "lose",
  losing: "lose",
  loses: "lose",
  sent: "send",
  sending: "send",
  sends: "send",
  broke: "break",
  broken: "break",
  breaking: "break",
  ran: "run",
  running: "run",
  runs: "run",
};

export function stem(word: string): string {
  const irregular = IRREGULAR[word];
  if (irregular) return irregular;

  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 5) w = w.slice(0, -3) + "y";
  else if (w.endsWith("ing") && w.length > 5) {
    w = w.slice(0, -3);
    // de-double a trailing consonant: shipping -> shipp -> ship
    if (w.length > 3) {
      const last = w[w.length - 1];
      const prev = w[w.length - 2];
      if (last === prev && last !== "s") w = w.slice(0, -1);
    }
  } else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ly") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  return w;
}
