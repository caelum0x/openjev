import type { GoldCase } from "./types.ts";
import { DEPARTMENT, IS_REFUND, IS_SPAM, SEVERITY } from "./schemas.ts";

/**
 * Multilingual: real support traffic in other languages routinely code-switches,
 * embedding English product terms (login, password, API, crypto, timeout, down).
 * These cases lean on that shared loanword vocabulary. The final case is pure
 * French with no shared tokens and is soft — an honest marker of the English
 * lexicon's limit, where the engine should be uncertain rather than confident.
 */
export const MULTILINGUAL: GoldCase[] = [
  {
    id: "ml-de-account",
    source: "multilingual: German account lockout with loanwords",
    features: ["multilingual"],
    state:
      "Mein Login funktioniert nicht mehr, das Passwort wird abgelehnt und mein Account ist jetzt gesperrt.",
    questions: DEPARTMENT,
    expect: [
      { choice: { id: "department", value: "account", minP: 0.3, soft: true } },
    ],
  },
  {
    id: "ml-tr-account",
    source: "multilingual: Turkish account issue with loanwords",
    features: ["multilingual"],
    state:
      "Login çalışmıyor, password sürekli reddediliyor ve hesabım kilitli. Lütfen yardım edin.",
    questions: DEPARTMENT,
    expect: [
      { choice: { id: "department", value: "account", minP: 0.3, soft: true } },
    ],
  },
  {
    id: "ml-pt-bug",
    source: "multilingual: Portuguese outage with tech loanwords",
    features: ["multilingual"],
    state:
      "A API está com timeout, o checkout está down e ninguem consegue finalizar a compra. Erro 500.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 0.8, max: 2, soft: true } }],
  },
  {
    id: "ml-es-spam",
    source: "multilingual: Spanish spam with loanwords",
    features: ["multilingual"],
    state:
      "Felicidades, has sido seleccionado como winner de un premio crypto. Haz click aqui para tu bonus gratis.",
    questions: IS_SPAM,
    expect: [{ noul: { id: "is_spam", min: 0.5, soft: true } }],
  },
  {
    id: "ml-fr-refund-lowsignal",
    source: "multilingual: pure French, no shared tokens",
    features: ["multilingual"],
    state:
      "Je souhaite être remboursé pour ce vol annulé, merci de traiter ma demande rapidement.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.1, max: 0.8, soft: true } }],
  },
  {
    id: "ml-mixed-shipping",
    source: "multilingual: code-switched shipping status",
    features: ["multilingual"],
    state:
      "Hola, my tracking no se actualiza hace una semana y el package parece perdido in transit.",
    questions: DEPARTMENT,
    expect: [
      { choice: { id: "department", value: "shipping", minP: 0.3, soft: true } },
    ],
  },
];
