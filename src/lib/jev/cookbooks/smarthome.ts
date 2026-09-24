import { lexicalEvaluator, type Evaluator } from "./evaluator.ts";
import {
  DEFAULT_THRESHOLDS,
  thresholdInfo,
  thresholdsFor,
  type SmarthomeGates,
  type ThresholdSetId,
} from "./thresholds.ts";
import type { Answer, Questions, SystemOneResponse } from "../types.ts";

export type RoomId =
  | "kitchen"
  | "living"
  | "bedroom"
  | "bathroom"
  | "office"
  | "outdoor";

export type DeviceKind =
  | "lights"
  | "thermostat"
  | "lock"
  | "speaker"
  | "blinds"
  | "fan"
  | "outlet"
  | "camera";

export type HomeDevice = {
  id: string;
  room: RoomId;
  kind: DeviceKind;
  label: string;
  on: boolean;
  brightness?: number;
  temperature?: number;
  locked?: boolean;
  playing?: boolean;
  volume?: number;
  open?: boolean;
  speed?: number;
};

export type HomeState = { devices: HomeDevice[] };

export type SmarthomePath =
  | "command"
  | "query"
  | "conversation"
  | "compound"
  | "scene"
  | "blocked";

export type DeviceEffect = {
  id: string;
  label: string;
  summary: string;
};

export type SmarthomeStep = {
  utterance: string;
  category: string;
  domain: string;
  device: string;
  action: string;
  scene: string;
  confidence: number;
  allow: number;
  compound: number;
  is_query: number;
  execute: boolean;
  gated: string[];
  used: string[];
  discarded: string[];
  effects: DeviceEffect[];
  reply: string;
  answers: Record<string, Answer>;
  questions_asked: number;
  latency_ms: number;
  usage: SystemOneResponse["usage"];
  temperature: number | null;
};

export type SmarthomeResult = {
  model: string;
  /** Which engine answered (null when the backend does not report one). */
  engine: SystemOneResponse["engine"] | null;
  /** Which gate set decided this result (per engine; see thresholds.ts). */
  thresholds: {
    set: ThresholdSetId | "override";
    fitted_on: string | null;
    values: SmarthomeGates;
  };
  usage: SystemOneResponse["usage"];
  latency_ms: number;
  utterance: string;
  path: SmarthomePath;
  intent: { room: string; device: string; action: string };
  confidence: number;
  allow: number;
  execute: boolean;
  answers: Record<string, Answer>;
  questions_asked: number;
  used: string[];
  discarded: string[];
  splits: string[];
  steps: SmarthomeStep[];
  home: HomeState;
  reply: string;
  llm: { used: boolean; purpose: "split" | "converse" | null };
};

const ACTION_KEY: Record<string, string> = {
  lights: "lights_action",
  thermostat: "climate_action",
  lock: "lock_action",
  speaker: "speaker_action",
  blinds: "blinds_action",
  fan: "fan_action",
  outlet: "outlet_action",
  camera: "camera_action",
};

/**
 * Speculative fan-out: every question that *might* matter, in one call.
 * Code keeps the relevant slice after the fact. Asking lights_action before
 * we know the device is the whole point.
 */
export const SMARTHOME_QUESTIONS: Questions = {
  category: {
    type: "choice",
    instructions: "What category of request is this?",
    criteria: {
      command: {
        what: "Control a device the user owns: turn on/off, set, dim, lock, play",
        examples: [
          "turn off all of the lights in the house",
          "set the bedroom to 21 degrees",
          "lock the front door",
        ],
        not_for: "hello, chitchat, weather, how does this work",
      },
      conversation: {
        what: "Greeting or small talk, not a device command",
        examples: ["hello", "hi there", "how are you", "thanks"],
        not_for: "turn off the lights",
      },
      information: {
        what: "General knowledge or advice, not a live device status query",
        examples: [
          "what's a good temperature for sleeping",
          "why is the house cold",
          "weather for a walk",
        ],
        not_for: "is the front door locked, are the kitchen lights on",
      },
      scene: {
        what: "Activate a named house scene",
        examples: ["movie night", "good morning", "I'm leaving", "bedtime"],
        not_for: "turn off one light",
      },
    },
  },
  domain: {
    type: "choice",
    instructions: "What domain is this request targeting?",
    criteria: {
      kitchen: {
        what: "Kitchen",
        examples: ["kitchen lights", "the stove area"],
      },
      living: {
        what: "Living room, lounge, den",
        examples: ["living room", "play music in the lounge"],
      },
      bedroom: {
        what: "Bedroom",
        examples: ["bedroom to 21 degrees", "bedroom lights"],
      },
      bathroom: { what: "Bathroom", examples: ["bathroom fan", "bath lights"] },
      office: { what: "Office or study", examples: ["office lights"] },
      outdoor: {
        what: "Outside, porch, garage, front door",
        examples: ["front door", "porch lights", "garage"],
      },
      whole_house: {
        what: "The entire house, every room, everywhere",
        examples: [
          "all of the lights in the house",
          "everywhere",
          "the whole house",
        ],
      },
      unknown: { what: "No room named", examples: ["hello", "thanks"] },
    },
  },
  device: {
    type: "choice",
    instructions: "What type of device is this request targeting?",
    criteria: {
      lights: {
        what: "Lights, lamps, bulbs, dimmers",
        examples: ["turn off the lights", "dim the lamp"],
      },
      thermostat: {
        what: "Thermostat, heat, AC, temperature in degrees",
        examples: ["set to 21 degrees", "make it warmer"],
      },
      lock: {
        what: "Door lock or deadbolt",
        examples: ["lock the front door", "is the door locked", "unlock"],
      },
      speaker: {
        what: "Speaker or music playback",
        examples: ["play something", "pause the music"],
      },
      blinds: {
        what: "Blinds, curtains, shades",
        examples: ["close the blinds", "open the curtains"],
      },
      fan: { what: "Ceiling or bath fan", examples: ["turn on the fan"] },
      outlet: { what: "Smart plug or outlet", examples: ["kill the outlet"] },
      camera: { what: "Security camera", examples: ["arm the camera"] },
      unknown: { what: "No device named", examples: ["hello", "movie night"] },
    },
  },
  lights_action: {
    type: "choice",
    instructions:
      "What action should be taken on the lights? Speculative — ask even if the device may not be lights.",
    criteria: {
      on: { what: "Turn lights on", examples: ["turn on the lights", "lights on"] },
      off: {
        what: "Turn lights off",
        examples: ["turn off the lights", "lights out", "kill the kitchen lights"],
      },
      dim: { what: "Dim or lower brightness", examples: ["dim the living room"] },
      brighten: { what: "Brighten", examples: ["make the lights brighter"] },
      query: { what: "Ask whether lights are on", examples: ["are the lights on"] },
    },
  },
  climate_action: {
    type: "choice",
    instructions: "What action should be taken on the thermostat? Speculative.",
    criteria: {
      set: {
        what: "Set a target temperature",
        examples: ["set the bedroom to 21 degrees"],
      },
      heat: { what: "Heat / warmer", examples: ["make it warmer"] },
      cool: { what: "Cool / colder", examples: ["make it cooler"] },
      off: { what: "Turn climate off", examples: ["turn off the heat"] },
      query: { what: "Ask the current temperature", examples: ["what's the temperature"] },
    },
  },
  lock_action: {
    type: "choice",
    instructions: "What action should be taken on the lock? Speculative.",
    criteria: {
      lock: { what: "Lock the door", examples: ["lock the front door"] },
      unlock: { what: "Unlock the door", examples: ["unlock the door"] },
      query: { what: "Ask if it is locked", examples: ["is the front door locked"] },
    },
  },
  speaker_action: {
    type: "choice",
    instructions: "What action should be taken on the speaker? Speculative.",
    criteria: {
      play: { what: "Start music", examples: ["play something in the living room"] },
      pause: { what: "Pause or stop", examples: ["pause the music"] },
      query: { what: "Ask what is playing", examples: ["is music on"] },
    },
  },
  blinds_action: {
    type: "choice",
    instructions: "What action should be taken on the blinds? Speculative.",
    criteria: {
      open: { what: "Open blinds", examples: ["open the curtains"] },
      close: { what: "Close blinds", examples: ["close the blinds"] },
      query: { what: "Ask if blinds are open", examples: ["are the blinds closed"] },
    },
  },
  fan_action: {
    type: "choice",
    instructions: "What action should be taken on the fan? Speculative.",
    criteria: {
      on: { what: "Turn the fan on", examples: ["turn on the bathroom fan"] },
      off: { what: "Turn the fan off", examples: ["fan off"] },
      query: { what: "Ask fan status", examples: ["is the fan on"] },
    },
  },
  outlet_action: {
    type: "choice",
    instructions: "What action should be taken on the outlet? Speculative.",
    criteria: {
      on: { what: "Power the outlet", examples: ["turn on the plug"] },
      off: { what: "Cut power", examples: ["kill the outlet"] },
      query: { what: "Ask outlet status", examples: ["is the plug on"] },
    },
  },
  camera_action: {
    type: "choice",
    instructions: "What action should be taken on the camera? Speculative.",
    criteria: {
      arm: { what: "Arm / keep recording", examples: ["arm the camera"] },
      disarm: { what: "Disarm", examples: ["turn off the camera"] },
      query: { what: "Ask camera status", examples: ["is the camera on"] },
    },
  },
  scene: {
    type: "choice",
    instructions: "If this is a named scene, which one?",
    criteria: {
      none: { what: "Not a named scene", examples: ["turn off the lights"] },
      movie_night: { what: "Movie night", examples: ["movie night"] },
      good_morning: { what: "Good morning routine", examples: ["good morning"] },
      away: { what: "Leaving the house", examples: ["I'm leaving", "away mode"] },
      sleep: { what: "Bedtime / sleep", examples: ["good night", "bedtime"] },
      party: { what: "Party", examples: ["party mode"] },
    },
  },
  compound: {
    type: "noul",
    instructions: "Is the user asking for more than one distinct action?",
    criteria: {
      true: {
        what: "Two or more separate device commands in one utterance",
        examples: [
          "turn off the kitchen lights and lock the front door",
          "dim the living room then play music",
        ],
      },
      false: {
        what: "A single action, even if it covers the whole house",
        examples: [
          "turn off all of the lights in the house",
          "set the bedroom to 21 degrees",
        ],
      },
    },
  },
  allow: {
    type: "noul",
    instructions: "Is this a safe, in-scope home-automation command for devices the user owns?",
    criteria: {
      true: {
        what: "Lights, climate, media, locks, blinds in this house",
        examples: ["turn off the kitchen lights", "lock the front door"],
      },
      false: {
        what: "Off-property, a neighbor's house, destructive, or not a device command",
        examples: ["unlock my neighbor's garage", "open someone else's door"],
      },
    },
  },
  is_query: {
    type: "noul",
    instructions: "Is the user asking for the current status of a device rather than changing it?",
    criteria: {
      true: {
        what: "A yes/no or status question about a device",
        examples: ["is the front door locked", "are the kitchen lights on"],
      },
      false: {
        what: "A command that should change state, or conversation",
        examples: ["turn off the lights", "hello"],
      },
    },
  },
  needs_confirm: {
    type: "noul",
    instructions: "Should a human confirm before acting (unlock, disarm, off-property)?",
    criteria: {
      true: {
        what: "Unlocking, disarming cameras, or acting on someone else's property",
        examples: ["unlock the front door", "unlock my neighbor's garage"],
      },
      false: {
        what: "Reversible lighting, climate, media",
        examples: ["turn off the lights", "play music"],
      },
    },
  },
  whole_home: {
    type: "noul",
    instructions: "Is the user targeting the entire house rather than one room?",
    criteria: {
      true: {
        what: "All rooms, everywhere, the whole house",
        examples: ["all of the lights in the house", "everywhere"],
      },
      false: {
        what: "A single named room, or no location",
        examples: ["kitchen lights", "bedroom to 21"],
      },
    },
  },
};

export const QUESTION_IDS = Object.keys(SMARTHOME_QUESTIONS);

export const SMARTHOME_EXAMPLES = [
  "Turn off all of the lights in the house",
  "set the bedroom to 21 degrees",
  "is the front door locked",
  "play something in the living room",
  "unlock my neighbor's garage",
  "turn off the kitchen lights and lock the front door",
  "what's a good temperature for sleeping",
  "movie night",
];

export const ROOMS: { id: RoomId; label: string }[] = [
  { id: "kitchen", label: "Kitchen" },
  { id: "living", label: "Living" },
  { id: "bedroom", label: "Bedroom" },
  { id: "bathroom", label: "Bathroom" },
  { id: "office", label: "Office" },
  { id: "outdoor", label: "Outdoor" },
];

export function defaultHome(): HomeState {
  return {
    devices: [
      { id: "kitchen.lights", room: "kitchen", kind: "lights", label: "Kitchen lights", on: true, brightness: 80 },
      { id: "kitchen.outlet", room: "kitchen", kind: "outlet", label: "Kitchen plug", on: true },
      { id: "living.lights", room: "living", kind: "lights", label: "Living lights", on: true, brightness: 60 },
      { id: "living.speaker", room: "living", kind: "speaker", label: "Living speaker", on: false, playing: false, volume: 40 },
      { id: "living.thermostat", room: "living", kind: "thermostat", label: "Living climate", on: true, temperature: 21 },
      { id: "living.blinds", room: "living", kind: "blinds", label: "Living blinds", on: true, open: true },
      { id: "bedroom.lights", room: "bedroom", kind: "lights", label: "Bedroom lights", on: false, brightness: 0 },
      { id: "bedroom.thermostat", room: "bedroom", kind: "thermostat", label: "Bedroom climate", on: true, temperature: 19 },
      { id: "bedroom.fan", room: "bedroom", kind: "fan", label: "Bedroom fan", on: false, speed: 0 },
      { id: "bathroom.lights", room: "bathroom", kind: "lights", label: "Bath lights", on: false, brightness: 0 },
      { id: "bathroom.fan", room: "bathroom", kind: "fan", label: "Bath fan", on: false, speed: 0 },
      { id: "office.lights", room: "office", kind: "lights", label: "Office lights", on: true, brightness: 40 },
      { id: "office.outlet", room: "office", kind: "outlet", label: "Office plug", on: false },
      { id: "outdoor.lights", room: "outdoor", kind: "lights", label: "Porch lights", on: false, brightness: 0 },
      { id: "outdoor.lock", room: "outdoor", kind: "lock", label: "Front door", on: true, locked: true },
      { id: "outdoor.camera", room: "outdoor", kind: "camera", label: "Porch camera", on: true },
    ],
  };
}

export function cloneHome(home: HomeState): HomeState {
  return { devices: home.devices.map((d) => ({ ...d })) };
}

export function coerceHome(raw: unknown): HomeState {
  const base = defaultHome();
  if (!raw || typeof raw !== "object") return base;
  const devices = (raw as HomeState).devices;
  if (!Array.isArray(devices)) return base;
  const byId = new Map(devices.map((d) => [d.id, d]));
  return {
    devices: base.devices.map((d) => {
      const incoming = byId.get(d.id);
      if (!incoming || typeof incoming !== "object") return d;
      return { ...d, ...pickDevice(incoming, d) };
    }),
  };
}

function pickDevice(incoming: HomeDevice, fallback: HomeDevice): HomeDevice {
  return {
    ...fallback,
    on: typeof incoming.on === "boolean" ? incoming.on : fallback.on,
    brightness:
      typeof incoming.brightness === "number" ? incoming.brightness : fallback.brightness,
    temperature:
      typeof incoming.temperature === "number" ? incoming.temperature : fallback.temperature,
    locked: typeof incoming.locked === "boolean" ? incoming.locked : fallback.locked,
    playing: typeof incoming.playing === "boolean" ? incoming.playing : fallback.playing,
    volume: typeof incoming.volume === "number" ? incoming.volume : fallback.volume,
    open: typeof incoming.open === "boolean" ? incoming.open : fallback.open,
    speed: typeof incoming.speed === "number" ? incoming.speed : fallback.speed,
  };
}

const ACTION_VERB =
  /\b(turn on|turn off|switch on|switch off|shut off|lock|unlock|set|dim|brighten|play|pause|stop|close|open|raise|lower|kill)\b/i;
const DEVICE_WORD =
  /\b(lights?|lamps?|thermostat|temperature|degrees?|lock|door|speaker|music|blinds?|curtains?|fan|outlet|plug|camera)\b/i;

export function splitHeuristic(utterance: string): string[] {
  const trimmed = utterance.trim();
  if (!trimmed) return [];
  const strong = trimmed.split(/\s+(?:and then|then|and also|also)\s+/i);
  if (strong.length >= 2 && strong.every((p) => p.trim())) {
    return strong.map((s) => s.trim()).filter(Boolean);
  }
  const andParts = trimmed.split(/\s+and\s+/i);
  if (andParts.length >= 2) {
    const viable = andParts.filter((p) => ACTION_VERB.test(p) || DEVICE_WORD.test(p));
    if (viable.length >= 2) return andParts.map((s) => s.trim()).filter(Boolean);
  }
  return [trimmed];
}

export function extractTemp(utterance: string): number | null {
  const m = utterance.match(/(\d{2})\s*(?:degrees?|°|c\b|f\b)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 10 && n <= 35) return n;
  if (n >= 50 && n <= 90) return Math.round(((n - 32) * 5) / 9);
  return null;
}

function extractBrightness(utterance: string): number | null {
  const pct = utterance.match(/(\d{1,3})\s*%/);
  if (pct) return Math.min(100, Math.max(0, Number(pct[1])));
  if (/\bhalf\b/i.test(utterance)) return 50;
  if (/\b(full|max)\b/i.test(utterance)) return 100;
  return null;
}

type Gate = {
  category?: string;
  domain?: string;
  device?: string;
  action?: string;
  scene?: string;
  compound?: number;
  allow?: number;
  is_query?: number;
  temp: number | null;
  brightness: number | null;
  fields: string[];
};

function keywordGate(utterance: string): Gate {
  const s = utterance.toLowerCase();
  const fields: string[] = [];
  const g: Gate = { temp: extractTemp(utterance), brightness: extractBrightness(utterance), fields };

  const mark = (k: keyof Omit<Gate, "temp" | "brightness" | "fields">, v: string | number) => {
    (g as Record<string, unknown>)[k] = v;
    if (!fields.includes(k)) fields.push(k);
  };

  if (
    /^(hi|hello|hey|thanks|thank you|good (morning|evening|night)|how are you)\b/.test(s.trim()) &&
    !ACTION_VERB.test(s)
  ) {
    mark("category", "conversation");
  }
  if (/\b(weather|forecast|what(?:'s| is) a good|why is|how does)\b/.test(s) && !ACTION_VERB.test(s)) {
    mark("category", "information");
  }

  if (/\bmovie night\b/.test(s)) {
    mark("scene", "movie_night");
    mark("category", "scene");
  } else if (/\bgood morning\b/.test(s) && !ACTION_VERB.test(s)) {
    mark("scene", "good_morning");
    mark("category", "scene");
  } else if (/\b(i'?m leaving|away mode|leave the house)\b/.test(s)) {
    mark("scene", "away");
    mark("category", "scene");
  } else if (/\b(good night|bedtime|sleep mode)\b/.test(s) && !ACTION_VERB.test(s)) {
    mark("scene", "sleep");
    mark("category", "scene");
  } else if (/\bparty(?:\s+mode)?\b/.test(s) && !DEVICE_WORD.test(s)) {
    mark("scene", "party");
    mark("category", "scene");
  }

  if (/\b(all|every|entire|whole|everywhere)\b/.test(s) && /\b(house|home|rooms?)\b/.test(s)) {
    mark("domain", "whole_house");
  } else if (/\bkitchen\b/.test(s)) mark("domain", "kitchen");
  else if (/\b(living room|lounge|living)\b/.test(s)) mark("domain", "living");
  else if (/\bbedroom\b/.test(s)) mark("domain", "bedroom");
  else if (/\b(bathroom|bath fan)\b/.test(s)) mark("domain", "bathroom");
  else if (/\b(office|study)\b/.test(s)) mark("domain", "office");
  else if (/\b(porch|garage|driveway|yard|patio|front door|outdoor)\b/.test(s)) {
    mark("domain", "outdoor");
  }

  if (/\b(lights?|lamps?|bulbs?|lighting|dimmer)\b/.test(s)) mark("device", "lights");
  else if (
    /\bthermostat\b/.test(s) ||
    g.temp != null ||
    (g.category !== "information" && /\b(degrees?|celsius|fahrenheit)\b/.test(s))
  ) {
    mark("device", "thermostat");
  } else if (/\b(unlock|lock|deadbolt|front door)\b/.test(s)) mark("device", "lock");
  else if (/\b(music|speaker|playlist|song|play something)\b/.test(s)) mark("device", "speaker");
  else if (/\b(blinds?|curtains?|shades)\b/.test(s)) mark("device", "blinds");
  else if (/\bfan\b/.test(s)) mark("device", "fan");
  else if (/\b(outlet|smart plug)\b/.test(s)) mark("device", "outlet");
  else if (/\b(camera|cam)\b/.test(s)) mark("device", "camera");

  // A status question about a device. General questions ("what's the weather")
  // were already marked `information` above and are not device queries.
  if (
    g.category !== "information" &&
    /^\s*(is|are|what'?s the|what is the|how (is|are)|status of)\b/i.test(s)
  ) {
    mark("is_query", 0.92);
    mark("action", "query");
  }

  if (g.temp != null) {
    mark("device", "thermostat");
    mark("action", "set");
    mark("category", "command");
  }

  if ((g.device === "lights" || !g.device) && /\b(turn|switch|shut)\s+off\b|\blights out\b/.test(s)) {
    mark("action", "off");
    if (!g.device) mark("device", "lights");
    if (!g.category) mark("category", "command");
  } else if ((g.device === "lights" || !g.device) && /\b(turn|switch)\s+on\b/.test(s)) {
    mark("action", "on");
    if (!g.device) mark("device", "lights");
    if (!g.category) mark("category", "command");
  } else if (/\bdim\b/.test(s)) {
    mark("action", "dim");
    mark("device", "lights");
    mark("category", "command");
  } else if (/\bbrighten\b|\bbrighter\b/.test(s)) {
    mark("action", "brighten");
    mark("device", "lights");
    mark("category", "command");
  }

  if (g.device === "lock" || /\b(unlock|lock)\b/.test(s)) {
    if (/\bunlock\b/.test(s)) mark("action", "unlock");
    else if (/\block\b/.test(s) && g.action !== "query") mark("action", "lock");
    if (!g.device) mark("device", "lock");
    if (!g.category && g.action !== "query") mark("category", "command");
  }

  if (g.device === "speaker" || /\bplay something\b/.test(s)) {
    if (/\b(pause|stop)\b/.test(s)) mark("action", "pause");
    else if (/\bplay\b/.test(s) && g.action !== "query") mark("action", "play");
    if (!g.category && g.action !== "query") mark("category", "command");
  }

  // On/off devices other than lights: the verb decides, not the engine's
  // speculative action answer (which once turned a plug ON for "turn off").
  if ((g.device === "fan" || g.device === "outlet") && g.action !== "query") {
    if (/\b(turn|switch|shut|power)\s+off\b|\b(kill|cut)\b/.test(s)) mark("action", "off");
    else if (/\b(turn|switch|power)\s+on\b/.test(s)) mark("action", "on");
    if (g.action && !g.category) mark("category", "command");
  }

  if (g.device === "blinds" && g.action !== "query") {
    if (/\bclose\b/.test(s)) mark("action", "close");
    else if (/\bopen\b/.test(s)) mark("action", "open");
    if (!g.category) mark("category", "command");
  }

  if (/\b(neighbor|neighbour|someone else'?s|next door|their (house|garage|door))\b/.test(s)) {
    mark("allow", 0.08);
  }

  const parts = splitHeuristic(utterance);
  if (parts.length >= 2) mark("compound", 0.88);

  return g;
}

function choiceOf(answers: Record<string, Answer>, id: string, fallback: string): string {
  const a = answers[id];
  if (a && a.type === "choice") return a.choice;
  return fallback;
}

function noulOf(answers: Record<string, Answer>, id: string): number {
  const a = answers[id];
  if (a && a.type === "noul") return a.noul;
  return 0.5;
}

function confOf(answers: Record<string, Answer>, id: string): number {
  const a = answers[id];
  if (a && (a.type === "choice" || a.type === "score")) return a.confidence;
  return 1;
}

function actionFromAnswers(device: string, answers: Record<string, Answer>): string {
  const key = ACTION_KEY[device];
  if (!key) return "unknown";
  return choiceOf(answers, key, "unknown");
}

export type Interpreted = {
  category: string;
  domain: string;
  device: string;
  action: string;
  scene: string;
  confidence: number;
  allow: number;
  compound: number;
  is_query: number;
  needs_confirm: number;
  whole_home: number;
  execute: boolean;
  gated: string[];
  temperature: number | null;
  brightness: number | null;
  /** 1 for a keyword-matched scene, else min(category, scene) confidence. */
  scene_confidence: number;
  /** The gates this interpretation was decided with. */
  gates: SmarthomeGates;
};

export function interpret(
  utterance: string,
  answers: Record<string, Answer>,
  gates: SmarthomeGates = DEFAULT_THRESHOLDS.smarthome,
): Interpreted {
  const g = keywordGate(utterance);
  // A named device with no scene keyword is a device request, even when the
  // engine leans "scene" ("arm the porch camera" is not a house scene).
  const engineCategory = choiceOf(answers, "category", "command");
  const category =
    g.category ?? (engineCategory === "scene" && g.device && !g.scene ? "command" : engineCategory);
  const domain =
    g.domain ??
    (noulOf(answers, "whole_home") >= gates.whole_home
      ? "whole_house"
      : choiceOf(answers, "domain", "unknown"));
  const device = g.device ?? choiceOf(answers, "device", "unknown");
  const scene = g.scene ?? choiceOf(answers, "scene", "none");
  const is_query = g.is_query ?? noulOf(answers, "is_query");
  const compound = Math.max(g.compound ?? 0, noulOf(answers, "compound"));
  let allow = noulOf(answers, "allow");
  if (g.allow != null) allow = Math.min(allow, g.allow);
  const needs_confirm = noulOf(answers, "needs_confirm");
  const whole_home = domain === "whole_house" ? Math.max(0.8, noulOf(answers, "whole_home")) : noulOf(answers, "whole_home");

  const isQuery = is_query >= gates.is_query;
  let action = g.action ?? (isQuery ? "query" : actionFromAnswers(device, answers));
  if (isQuery && !g.action) action = "query";

  const actionKey = ACTION_KEY[device];
  const confidence = Math.min(
    confOf(answers, "category"),
    confOf(answers, "domain"),
    confOf(answers, "device"),
    actionKey ? confOf(answers, actionKey) : 1,
  );

  // Keyword-matched scenes are certain; an engine-picked scene needs both the
  // category and the scene answer to clear the confidence gate.
  const scene_confidence = g.scene
    ? 1
    : Math.min(g.category ? 1 : confOf(answers, "category"), confOf(answers, "scene"));

  const irreversible = action === "unlock" || (device === "camera" && action === "disarm");
  const allowOk = allow >= (irreversible ? gates.allow_irreversible : gates.allow);
  const confOk = confidence >= (irreversible ? gates.confidence_irreversible : gates.confidence);
  const isCommandish = category === "command" || category === "scene" || Boolean(g.action && g.action !== "query");
  const execute =
    isCommandish &&
    action !== "query" &&
    allowOk &&
    confOk &&
    (device !== "unknown" || category === "scene");

  return {
    category,
    domain,
    device,
    action,
    scene,
    confidence,
    allow,
    compound,
    is_query,
    needs_confirm,
    whole_home,
    execute,
    gated: g.fields,
    temperature: g.temp,
    brightness: g.brightness,
    scene_confidence,
    gates,
  };
}

function selectDevices(home: HomeState, intent: Interpreted): HomeDevice[] {
  const room = intent.domain as RoomId | "whole_house" | "unknown";
  const kind = intent.device as DeviceKind | "unknown";
  let pool = home.devices;
  if (kind !== "unknown") pool = pool.filter((d) => d.kind === kind);
  if (room === "whole_house" || intent.whole_home >= intent.gates.whole_home) return pool;
  if (room !== "unknown" && ROOMS.some((r) => r.id === room)) {
    const scoped = pool.filter((d) => d.room === room);
    if (scoped.length) return scoped;
  }
  return pool.slice(0, kind === "unknown" ? 0 : 1);
}

function snapshotSummary(d: HomeDevice): string {
  if (d.kind === "lights") return d.on ? `on · ${d.brightness ?? 80}%` : "off";
  if (d.kind === "thermostat") return `${d.temperature ?? 20}°`;
  if (d.kind === "lock") return d.locked ? "locked" : "unlocked";
  if (d.kind === "speaker") return d.playing ? "playing" : "idle";
  if (d.kind === "blinds") return d.open ? "open" : "closed";
  if (d.kind === "fan") return d.on ? "on" : "off";
  if (d.kind === "outlet") return d.on ? "on" : "off";
  if (d.kind === "camera") return d.on ? "armed" : "disarmed";
  return d.on ? "on" : "off";
}

function mutateDevice(d: HomeDevice, intent: Interpreted): string {
  const before = snapshotSummary(d);
  switch (d.kind) {
    case "lights":
      if (intent.action === "off") {
        d.on = false;
      } else if (intent.action === "on") {
        d.on = true;
        d.brightness = intent.brightness ?? Math.max(d.brightness ?? 0, 80);
      } else if (intent.action === "dim") {
        d.on = true;
        d.brightness = intent.brightness ?? Math.max(10, (d.brightness ?? 80) - 30);
      } else if (intent.action === "brighten") {
        d.on = true;
        d.brightness = intent.brightness ?? Math.min(100, (d.brightness ?? 40) + 30);
      }
      break;
    case "thermostat":
      d.on = intent.action !== "off";
      if (intent.temperature != null) d.temperature = intent.temperature;
      else if (intent.action === "heat") d.temperature = (d.temperature ?? 20) + 1;
      else if (intent.action === "cool") d.temperature = (d.temperature ?? 20) - 1;
      break;
    case "lock":
      d.locked = intent.action !== "unlock";
      d.on = true;
      break;
    case "speaker":
      if (intent.action === "play") {
        d.on = true;
        d.playing = true;
      } else {
        d.playing = false;
      }
      break;
    case "blinds":
      d.open = intent.action === "open";
      d.on = true;
      break;
    case "fan":
      d.on = intent.action === "on";
      d.speed = d.on ? Math.max(d.speed ?? 1, 1) : 0;
      break;
    case "outlet":
      d.on = intent.action === "on";
      break;
    case "camera":
      d.on = intent.action !== "disarm";
      break;
    default:
      break;
  }
  const after = snapshotSummary(d);
  return `${d.label}: ${before} → ${after}`;
}

function applyScene(home: HomeState, scene: string): DeviceEffect[] {
  const effects: DeviceEffect[] = [];
  const touch = (id: string, fn: (d: HomeDevice) => void) => {
    const d = home.devices.find((x) => x.id === id);
    if (!d) return;
    const before = snapshotSummary(d);
    fn(d);
    effects.push({ id: d.id, label: d.label, summary: `${d.label}: ${before} → ${snapshotSummary(d)}` });
  };
  if (scene === "movie_night") {
    touch("living.lights", (d) => {
      d.on = true;
      d.brightness = 20;
    });
    touch("living.speaker", (d) => {
      d.on = true;
      d.playing = true;
    });
    touch("living.blinds", (d) => {
      d.open = false;
    });
  } else if (scene === "good_morning") {
    for (const id of ["kitchen.lights", "living.lights", "bedroom.lights"]) {
      touch(id, (d) => {
        d.on = true;
        d.brightness = 70;
      });
    }
    touch("living.blinds", (d) => {
      d.open = true;
    });
    touch("bedroom.thermostat", (d) => {
      d.temperature = 21;
    });
  } else if (scene === "away") {
    for (const d of home.devices.filter((x) => x.kind === "lights")) {
      touch(d.id, (x) => {
        x.on = false;
      });
    }
    touch("outdoor.lock", (d) => {
      d.locked = true;
    });
    touch("outdoor.camera", (d) => {
      d.on = true;
    });
  } else if (scene === "sleep") {
    for (const d of home.devices.filter((x) => x.kind === "lights")) {
      touch(d.id, (x) => {
        x.on = false;
      });
    }
    touch("bedroom.thermostat", (d) => {
      d.temperature = 18;
    });
    touch("outdoor.lock", (d) => {
      d.locked = true;
    });
  } else if (scene === "party") {
    for (const d of home.devices.filter((x) => x.kind === "lights")) {
      touch(d.id, (x) => {
        x.on = true;
        x.brightness = 100;
      });
    }
    touch("living.speaker", (d) => {
      d.on = true;
      d.playing = true;
      d.volume = 70;
    });
  }
  return effects;
}

function usedFor(intent: Interpreted, allIds: string[]): { used: string[]; discarded: string[] } {
  const used = new Set<string>(["category", "compound", "allow"]);
  if (intent.category === "command" || intent.category === "information" || intent.action === "query") {
    used.add("domain");
    used.add("device");
    used.add("is_query");
    const aq = ACTION_KEY[intent.device];
    if (aq) used.add(aq);
  }
  if (intent.category === "scene" || (intent.scene && intent.scene !== "none")) used.add("scene");
  if (intent.domain === "whole_house") used.add("whole_home");
  if (intent.action === "unlock" || intent.allow < intent.gates.allow) used.add("needs_confirm");
  const usedList = allIds.filter((id) => used.has(id));
  const discarded = allIds.filter((id) => !used.has(id));
  return { used: usedList, discarded };
}

function applyIntent(
  home: HomeState,
  intent: Interpreted,
  utterance: string,
): { home: HomeState; effects: DeviceEffect[]; reply: string; execute: boolean } {
  // A keyword-matched scene is one of this house's own scenes, so only an
  // off-property phrase (keyword `allow`) blocks it; an engine-picked scene
  // must clear the allow and confidence gates.
  const keywordScene = intent.gated.includes("scene") && !intent.gated.includes("allow");
  if (
    intent.category === "scene" &&
    intent.scene &&
    intent.scene !== "none" &&
    (keywordScene ||
      (intent.allow >= intent.gates.allow && intent.scene_confidence >= intent.gates.confidence))
  ) {
    const effects = applyScene(home, intent.scene);
    return {
      home,
      effects,
      reply: `Scene ${intent.scene.replace(/_/g, " ")} · ${effects.length} devices`,
      execute: true,
    };
  }

  if (intent.action === "query") {
    const devices = selectDevices(home, intent);
    const lines =
      devices.length > 0
        ? devices.map((d) => `${d.label} is ${snapshotSummary(d)}`).join(". ")
        : "I don't have that device in this house.";
    return { home, effects: [], reply: lines + ".", execute: false };
  }

  if (!intent.execute) {
    if (intent.allow < intent.gates.allow) {
      return {
        home,
        effects: [],
        reply: "Blocked — off-property or not a device this house owns.",
        execute: false,
      };
    }
    return {
      home,
      effects: [],
      reply: `Not executed · ${intent.device} / ${intent.action} · conf ${intent.confidence.toFixed(2)}`,
      execute: false,
    };
  }

  const devices = selectDevices(home, intent);
  if (!devices.length) {
    return {
      home,
      effects: [],
      reply: `No ${intent.device === "unknown" ? "device" : intent.device} in ${intent.domain}.`,
      execute: false,
    };
  }
  const effects: DeviceEffect[] = devices.map((d) => ({
    id: d.id,
    label: d.label,
    summary: mutateDevice(d, intent),
  }));
  const where = intent.domain === "whole_house" ? "whole house" : intent.domain;
  return {
    home,
    effects,
    reply: `${intent.action} · ${where} · ${intent.device} · ${effects.length} device${effects.length === 1 ? "" : "s"}`,
    execute: true,
  };
}

export function converseLocal(utterance: string, home: HomeState): string {
  const s = utterance.toLowerCase();
  const bed = home.devices.find((d) => d.id === "bedroom.thermostat");
  const lightsOn = home.devices.filter((d) => d.kind === "lights" && d.on).length;
  if (/\b(sleep|sleeping|bedroom|temperature)\b/.test(s)) {
    return `Most people sleep better around 18–20°C. Bedroom is ${bed?.temperature ?? 19}°. Say “set the bedroom to 19” if you want it cooler.`;
  }
  if (/\b(hello|hi |hey|how are you)\b/.test(s)) {
    return `House is listening. ${lightsOn} lights on. Try “turn off all of the lights in the house”.`;
  }
  if (/\b(weather|walk|outside|forecast)\b/.test(s)) {
    return "I don't have weather. I can dim lights, set climate, lock doors, or play music.";
  }
  return "That's conversation, not a device command. I can control lights, climate, locks, speakers, blinds, fans, and outlets.";
}

function evaluateUtterance(utterance: string, model: string, evaluate: Evaluator) {
  return evaluate({ model, state: { utterance }, questions: SMARTHOME_QUESTIONS });
}

function stepFrom(
  utterance: string,
  ev: SystemOneResponse,
  home: HomeState,
  gates: SmarthomeGates,
): { step: SmarthomeStep; home: HomeState } {
  const intent = interpret(utterance, ev.answers, gates);
  const applied = applyIntent(home, intent, utterance);
  const { used, discarded } = usedFor(intent, QUESTION_IDS);
  return {
    home: applied.home,
    step: {
      utterance,
      category: intent.category,
      domain: intent.domain,
      device: intent.device,
      action: intent.action,
      scene: intent.scene,
      confidence: intent.confidence,
      allow: intent.allow,
      compound: intent.compound,
      is_query: intent.is_query,
      execute: applied.execute,
      gated: intent.gated,
      used,
      discarded,
      effects: applied.effects,
      reply: applied.reply,
      answers: ev.answers,
      questions_asked: QUESTION_IDS.length,
      latency_ms: ev.latency_ms,
      usage: ev.usage,
      temperature: intent.temperature,
    },
  };
}

function addUsage(
  a: SystemOneResponse["usage"],
  b: SystemOneResponse["usage"],
): SystemOneResponse["usage"] {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
}

export async function runSmarthome(
  utterance: string,
  home: HomeState = defaultHome(),
  model = "system-one",
  splits?: string[],
  evaluate: Evaluator = lexicalEvaluator,
  /** Override the engine's gates (the threshold tuner sweeps these). */
  gatesOverride?: SmarthomeGates,
): Promise<SmarthomeResult> {
  const text = utterance.trim() || SMARTHOME_EXAMPLES[0]!;
  const first = await evaluateUtterance(text, model, evaluate);
  const set = thresholdsFor(first.engine);
  const gates = gatesOverride ?? set.values.smarthome;
  const thresholds = gatesOverride
    ? { set: "override" as const, fitted_on: null, values: gatesOverride }
    : thresholdInfo(set, "smarthome");
  const head = interpret(text, first.answers, gates);
  const parts = splits && splits.length ? splits : splitHeuristic(text);
  const compoundGo =
    head.compound >= gates.compound && parts.length >= 2 && head.category !== "conversation";

  if (compoundGo) {
    let h = cloneHome(home);
    const steps: SmarthomeStep[] = [];
    let usage = first.usage;
    let latency = first.latency_ms;
    for (const part of parts) {
      const ev = await evaluateUtterance(part, model, evaluate);
      usage = addUsage(usage, ev.usage);
      latency += ev.latency_ms;
      const next = stepFrom(part, ev, h, gates);
      h = next.home;
      steps.push(next.step);
    }
    const { used, discarded } = usedFor(head, QUESTION_IDS);
    const execute = steps.some((s) => s.execute);
    return {
      model: first.model,
      engine: first.engine ?? null,
      thresholds,
      usage,
      latency_ms: Math.round(latency * 10) / 10,
      utterance: text,
      path: "compound",
      intent: {
        room: head.domain === "whole_house" ? "whole_home" : head.domain,
        device: head.device,
        action: head.action,
      },
      confidence: head.confidence,
      allow: head.allow,
      execute,
      answers: first.answers,
      questions_asked: QUESTION_IDS.length,
      used,
      discarded,
      splits: parts,
      steps,
      home: h,
      reply: steps.map((s) => s.reply).join(" · "),
      llm: { used: false, purpose: null },
    };
  }

  const working = cloneHome(home);
  const { step, home: nextHome } = stepFrom(text, first, working, gates);
  let path: SmarthomePath = "command";
  let reply = step.reply;
  if (head.category === "conversation") {
    path = "conversation";
    reply = converseLocal(text, home);
  } else if (head.category === "information") {
    if (head.is_query >= gates.is_query && head.device !== "unknown" && head.domain !== "unknown") {
      path = "query";
    } else {
      path = "conversation";
      reply = converseLocal(text, home);
    }
  } else if (head.category === "scene" && head.scene !== "none") {
    path = step.execute ? "scene" : "blocked";
  } else if (head.gated.includes("allow") && head.allow < gates.allow) {
    // Off-property phrasing ("someone else's", "next door"): blocked, even
    // when it is phrased as a question.
    path = "blocked";
  } else if (step.action === "query") {
    path = "query";
  } else if (!step.execute) {
    path = "blocked";
  }

  return {
    model: first.model,
    engine: first.engine ?? null,
    thresholds,
    usage: first.usage,
    latency_ms: first.latency_ms,
    utterance: text,
    path,
    intent: {
      room: head.domain === "whole_house" ? "whole_home" : head.domain,
      device: head.device,
      action: head.action,
    },
    confidence: head.confidence,
    allow: head.allow,
    execute: step.execute,
    answers: first.answers,
    questions_asked: QUESTION_IDS.length,
    used: step.used,
    discarded: step.discarded,
    splits: [text],
    steps: [{ ...step, reply }],
    home: path === "conversation" ? home : nextHome,
    reply,
    llm: { used: false, purpose: null },
  };
}

export const SMARTHOME_META = {
  id: "smarthome",
  title: "Smart home assistant",
  blurb:
    "Speculative fan-out: one TypeSafe call asks every question a house might need, including the ones you throw away. Code keeps the relevant slice. Compound requests split; conversation falls through to a writer.",
  stat: "speculative fan-out",
  href: "/cookbooks/smarthome",
};
