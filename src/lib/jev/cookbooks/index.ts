import { PARALLEL_META } from "./parallel";
import { CASCADE_META } from "./cascade";
import { CONSISTENCY_META } from "./consistency";
import { FUNCTION_META } from "./function-calling";
import { SMARTHOME_META } from "./smarthome";
import { PATTERN_COOKBOOKS } from "./patterns";

export const COOKBOOKS = [
  ...PATTERN_COOKBOOKS.map((p) => ({
    id: p.id,
    title: p.title,
    blurb: p.blurb,
    stat: p.stat,
    href: p.href,
  })),
  PARALLEL_META,
  CASCADE_META,
  CONSISTENCY_META,
  FUNCTION_META,
  SMARTHOME_META,
] as const;

export type CookbookId = (typeof COOKBOOKS)[number]["id"];
