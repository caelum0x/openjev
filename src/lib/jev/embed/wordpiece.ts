/**
 * BERT WordPiece tokenizer (uncased), matching Hugging Face `tokenizers`
 * `BertNormalizer` + `BertPreTokenizer` + `WordPiece` for the sentence
 * embedding models the embedding engine loads (gte-small, bge-small, MiniLM).
 *
 * Dependency-free on purpose: the only native piece of the embedding engine is
 * onnxruntime. Parity with the reference tokenizer is checked by
 * wordpiece.test.ts against ids produced by the Python `tokenizers` library.
 */

export type WordPieceConfig = {
  vocab: ReadonlyMap<string, number>;
  unkToken: string;
  clsToken: string;
  sepToken: string;
  prefix: string;
  maxInputCharsPerWord: number;
  lowercase: boolean;
};

export type Encoding = { ids: number[]; attentionMask: number[] };

/** Build a config from a Hugging Face `tokenizer.json` document. */
export function wordPieceFromTokenizerJson(doc: unknown): WordPieceConfig {
  const d = doc as {
    normalizer?: { type?: string; lowercase?: boolean } | null;
    model?: {
      type?: string;
      vocab?: Record<string, number>;
      unk_token?: string;
      continuing_subword_prefix?: string;
      max_input_chars_per_word?: number;
    };
  };
  if (d?.model?.type !== "WordPiece" || !d.model.vocab) {
    throw new Error("tokenizer.json is not a WordPiece tokenizer");
  }
  const vocab = new Map(Object.entries(d.model.vocab));
  for (const t of ["[CLS]", "[SEP]"]) {
    if (!vocab.has(t)) throw new Error(`tokenizer vocab is missing ${t}`);
  }
  return {
    vocab,
    unkToken: d.model.unk_token ?? "[UNK]",
    clsToken: "[CLS]",
    sepToken: "[SEP]",
    prefix: d.model.continuing_subword_prefix ?? "##",
    maxInputCharsPerWord: d.model.max_input_chars_per_word ?? 100,
    lowercase: d.normalizer?.lowercase ?? true,
  };
}

function isControl(cp: number, ch: string): boolean {
  if (ch === "\t" || ch === "\n" || ch === "\r") return false;
  return /\p{Cc}|\p{Cf}/u.test(ch) || cp === 0 || cp === 0xfffd;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || /\p{Zs}/u.test(ch);
}

function isPunctuation(cp: number, ch: string): boolean {
  if (
    (cp >= 33 && cp <= 47) ||
    (cp >= 58 && cp <= 64) ||
    (cp >= 91 && cp <= 96) ||
    (cp >= 123 && cp <= 126)
  ) {
    return true;
  }
  return /\p{P}/u.test(ch);
}

function isCjk(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/** BertNormalizer: clean text, pad CJK, lowercase + strip accents. */
export function normalize(text: string, lowercase = true): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isControl(cp, ch)) continue;
    if (isWhitespace(ch)) out += " ";
    else if (isCjk(cp)) out += ` ${ch} `;
    else out += ch;
  }
  if (!lowercase) return out;
  return out
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

/** BertPreTokenizer: split on whitespace, each punctuation char is its own word. */
export function preTokenize(text: string): string[] {
  const words: string[] = [];
  let cur = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isWhitespace(ch)) {
      if (cur) words.push(cur);
      cur = "";
    } else if (isPunctuation(cp, ch)) {
      if (cur) words.push(cur);
      words.push(ch);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) words.push(cur);
  return words;
}

function wordPiece(word: string, cfg: WordPieceConfig): string[] {
  const chars = [...word];
  if (chars.length > cfg.maxInputCharsPerWord) return [cfg.unkToken];
  const pieces: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let found: string | null = null;
    while (start < end) {
      const sub = (start > 0 ? cfg.prefix : "") + chars.slice(start, end).join("");
      if (cfg.vocab.has(sub)) {
        found = sub;
        break;
      }
      end -= 1;
    }
    if (found === null) return [cfg.unkToken];
    pieces.push(found);
    start = end;
  }
  return pieces;
}

/** Tokens (without [CLS]/[SEP]) for one text. */
export function tokenizeWords(text: string, cfg: WordPieceConfig): string[] {
  return preTokenize(normalize(text, cfg.lowercase)).flatMap((w) => wordPiece(w, cfg));
}

/** `[CLS] tokens [SEP]` ids, truncated to `maxLength` (including specials). */
export function encode(text: string, cfg: WordPieceConfig, maxLength = 256): Encoding {
  const unk = cfg.vocab.get(cfg.unkToken) ?? 0;
  const body = tokenizeWords(text, cfg)
    .slice(0, Math.max(0, maxLength - 2))
    .map((t) => cfg.vocab.get(t) ?? unk);
  const ids = [cfg.vocab.get(cfg.clsToken)!, ...body, cfg.vocab.get(cfg.sepToken)!];
  return { ids, attentionMask: ids.map(() => 1) };
}
