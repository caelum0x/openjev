import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultHome,
  runSmarthome,
  splitHeuristic,
} from "./smarthome.ts";

test("fan-out: turn off all lights in the house", async () => {
  const home = defaultHome();
  const before = home.devices.filter((d) => d.kind === "lights" && d.on).length;
  assert.ok(before > 1);
  const out = await runSmarthome("Turn off all of the lights in the house", home);
  assert.equal(out.path, "command");
  assert.equal(out.intent.device, "lights");
  assert.equal(out.intent.action, "off");
  assert.equal(out.intent.room, "whole_home");
  assert.equal(out.execute, true);
  assert.ok(out.questions_asked >= 12);
  assert.ok(out.discarded.length > 0);
  const on = out.home.devices.filter((d) => d.kind === "lights" && d.on).length;
  assert.equal(on, 0);
});

test("set bedroom thermostat from stated degrees", async () => {
  const out = await runSmarthome("set the bedroom to 21 degrees", defaultHome());
  assert.equal(out.intent.device, "thermostat");
  assert.equal(out.intent.action, "set");
  assert.equal(out.intent.room, "bedroom");
  const bed = out.home.devices.find((d) => d.id === "bedroom.thermostat");
  assert.equal(bed?.temperature, 21);
});

test("query does not mutate the lock", async () => {
  const home = defaultHome();
  const out = await runSmarthome("is the front door locked", home);
  assert.equal(out.path, "query");
  assert.equal(out.execute, false);
  assert.match(out.reply.toLowerCase(), /lock/);
  const lock = out.home.devices.find((d) => d.id === "outdoor.lock");
  assert.equal(lock?.locked, true);
});

test("neighbor unlock is blocked", async () => {
  const out = await runSmarthome("unlock my neighbor's garage", defaultHome());
  assert.equal(out.path, "blocked");
  assert.equal(out.execute, false);
  assert.ok(out.allow < 0.5);
  const lock = out.home.devices.find((d) => d.id === "outdoor.lock");
  assert.equal(lock?.locked, true);
});

test("compound splits into two atomic commands", async () => {
  const parts = splitHeuristic("turn off the kitchen lights and lock the front door");
  assert.equal(parts.length, 2);
  const home = defaultHome();
  const lock0 = home.devices.find((d) => d.id === "outdoor.lock");
  if (lock0) lock0.locked = false;
  const out = await runSmarthome(
    "turn off the kitchen lights and lock the front door",
    home,
  );
  assert.equal(out.path, "compound");
  assert.equal(out.steps.length, 2);
  const kit = out.home.devices.find((d) => d.id === "kitchen.lights");
  const lock = out.home.devices.find((d) => d.id === "outdoor.lock");
  assert.equal(kit?.on, false);
  assert.equal(lock?.locked, true);
  assert.equal(out.steps[1]?.action, "lock");
  assert.equal(out.steps[1]?.execute, true);
});

test("play living room speaker", async () => {
  const out = await runSmarthome("play something in the living room", defaultHome());
  assert.equal(out.intent.device, "speaker");
  assert.equal(out.intent.action, "play");
  const sp = out.home.devices.find((d) => d.id === "living.speaker");
  assert.equal(sp?.playing, true);
});

test("conversation does not touch devices", async () => {
  const home = defaultHome();
  const out = await runSmarthome("what's a good temperature for sleeping", home);
  assert.equal(out.path, "conversation");
  assert.equal(out.execute, false);
  assert.match(out.reply, /18/);
  assert.deepEqual(
    out.home.devices.map((d) => d.on),
    home.devices.map((d) => d.on),
  );
});

test("movie night scene fans out unused device questions", async () => {
  const out = await runSmarthome("movie night", defaultHome());
  assert.equal(out.path, "scene");
  assert.ok(out.discarded.includes("lock_action"));
  const lights = out.home.devices.find((d) => d.id === "living.lights");
  const blinds = out.home.devices.find((d) => d.id === "living.blinds");
  assert.equal(lights?.brightness, 20);
  assert.equal(blinds?.open, false);
});
