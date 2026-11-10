import { describe, expect, it } from "vitest";
import { pushRecent } from "../src/lib/recent.ts";

describe("recently played", () => {
  it("moves a replayed experience to the front without duplicates", () => {
    expect(pushRecent(["tdm", "deathmatch"], "deathmatch")).toEqual(["deathmatch", "tdm"]);
  });

  it("keeps at most six", () => {
    const list = ["a", "b", "c", "d", "e", "f"];
    expect(pushRecent(list, "g")).toEqual(["g", "a", "b", "c", "d", "e"]);
  });
});
