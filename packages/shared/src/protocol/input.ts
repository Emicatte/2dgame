import { z } from "zod";
import { NET } from "../config/game.ts";

/** Button bit flags carried in every input frame. */
export const BTN = {
  FIRE: 1,
  RELOAD: 2,
  DASH: 4,
  INTERACT: 8,
  /** In a vehicle: move to the next free seat. */
  SEAT: 16,
} as const;

export const AIM_SCALE = 10_000;
export const VIEW_SCALE = 100;

/**
 * One fixed-step input as it travels on the wire. All fields are integers so encoding is exact:
 * the client predicts with the same decoded values the server will see.
 */
export interface WireInput {
  /** Sequence number, strictly increasing per client. */
  s: number;
  /** Movement axes, each -1, 0 or 1. */
  x: number;
  y: number;
  /** Aim angle in radians * AIM_SCALE. */
  a: number;
  /** Button bit flags (BTN). */
  b: number;
  /** Requested weapon slot 0-2, or -1 for no change. */
  w: number;
  /** Server tick the client was rendering for remote players * VIEW_SCALE (lag compensation). */
  v: number;
}

export interface InputFrame {
  seq: number;
  mx: number;
  my: number;
  aim: number;
  buttons: number;
  slot: number;
  viewTick: number;
}

export function encodeInput(f: InputFrame): WireInput {
  return {
    s: f.seq,
    x: f.mx,
    y: f.my,
    a: Math.round(f.aim * AIM_SCALE),
    b: f.buttons,
    w: f.slot,
    v: Math.round(f.viewTick * VIEW_SCALE),
  };
}

export function decodeInput(w: WireInput): InputFrame {
  return {
    seq: w.s,
    mx: w.x,
    my: w.y,
    aim: w.a / AIM_SCALE,
    buttons: w.b,
    slot: w.w,
    viewTick: w.v / VIEW_SCALE,
  };
}

/** Round-trips a frame through the wire encoding so the client predicts with exactly what the server gets. */
export function quantizeInput(f: InputFrame): InputFrame {
  return decodeInput(encodeInput(f));
}

const axis = z.number().int().min(-1).max(1);

export const wireInputSchema = z.object({
  s: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31),
  x: axis,
  y: axis,
  a: z
    .number()
    .int()
    .min(-Math.ceil(Math.PI * AIM_SCALE) - 1)
    .max(Math.ceil(Math.PI * AIM_SCALE) + 1),
  b: z.number().int().min(0).max(31),
  w: z.number().int().min(-1).max(2),
  v: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31),
});

export const inputBatchSchema = z.object({
  i: z.array(wireInputSchema).min(1).max(NET.maxInputsPerMessage),
});

export type InputBatch = z.infer<typeof inputBatchSchema>;
