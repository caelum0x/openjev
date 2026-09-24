import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encode,
  normalize,
  preTokenize,
  tokenizeWords,
  wordPieceFromTokenizerJson,
  type WordPieceConfig,
} from "./wordpiece.ts";

const TINY: WordPieceConfig = wordPieceFromTokenizerJson({
  normalizer: { type: "BertNormalizer", lowercase: true },
  model: {
    type: "WordPiece",
    unk_token: "[UNK]",
    continuing_subword_prefix: "##",
    max_input_chars_per_word: 12,
    vocab: {
      "[PAD]": 0,
      "[UNK]": 1,
      "[CLS]": 2,
      "[SEP]": 3,
      card: 4,
      "##s": 5,
      my: 6,
      "?": 7,
      un: 8,
      "##believ": 9,
      "##able": 10,
      cafe: 11,
    },
  },
});

test("normalize lowercases, strips accents and control chars, pads CJK", () => {
  assert.equal(normalize("Café\u0000 Naïve\tX"), "cafe naive x");
  assert.equal(normalize("你好"), " 你  好 ");
  assert.equal(normalize("ABC", false), "ABC");
});

test("pre-tokenizer splits whitespace and every punctuation char", () => {
  assert.deepEqual(preTokenize("my card's ok?!"), ["my", "card", "'", "s", "ok", "?", "!"]);
});

test("WordPiece is greedy longest-match with ## continuations and [UNK] fallback", () => {
  assert.deepEqual(tokenizeWords("My cards?", TINY), ["my", "card", "##s", "?"]);
  assert.deepEqual(tokenizeWords("unbelievable", TINY), ["un", "##believ", "##able"]);
  assert.deepEqual(tokenizeWords("xyz", TINY), ["[UNK]"]);
  assert.deepEqual(tokenizeWords("cafecafecafecafe", TINY), ["[UNK]"]); // over max chars
  assert.deepEqual(tokenizeWords("Café", TINY), ["cafe"]);
});

test("encode adds [CLS]/[SEP] and truncates to maxLength", () => {
  assert.deepEqual(encode("my cards", TINY).ids, [2, 6, 4, 5, 3]);
  const short = encode("my cards my cards", TINY, 4);
  assert.deepEqual(short.ids, [2, 6, 4, 3]);
  assert.deepEqual(short.attentionMask, [1, 1, 1, 1]);
});

test("rejects tokenizers that are not WordPiece", () => {
  assert.throws(
    () => wordPieceFromTokenizerJson({ model: { type: "BPE", vocab: {} } }),
    /WordPiece/,
  );
});

// Parity with Hugging Face `tokenizers` (ids produced by the Python library for
// the gte-small tokenizer). Runs only when the model is installed.
const REAL = join(process.cwd(), "models/embed/gte-small/tokenizer.json");
test("matches the reference tokenizer on the installed model", { skip: !existsSync(REAL) }, () => {
  const cfg = wordPieceFromTokenizerJson(JSON.parse(readFileSync(REAL, "utf8")));
  const cases: Array<[string, number[]]> = [
    ["How do I locate my card?", [101, 2129, 2079, 1045, 12453, 2026, 4003, 1029, 102]],
    ["Héllo wörld! naïve café", [101, 7592, 2088, 999, 15743, 7668, 102]],
    ["你好 world", [101, 100, 100, 2088, 102]],
    [
      "e-mail: a@b.co, 3.5kg",
      [
        101, 1041, 1011, 5653, 1024, 1037, 1030, 1038, 1012, 2522, 1010, 1017, 1012, 1019, 2243,
        2290, 102,
      ],
    ],
    [
      "supercalifragilisticexpialidocious",
      [101, 3565, 9289, 10128, 29181, 24411, 4588, 10288, 19312, 21273, 10085, 6313, 102],
    ],
  ];
  for (const [text, ids] of cases) assert.deepEqual(encode(text, cfg, 512).ids, ids, text);
});
