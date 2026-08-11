import assert from "node:assert/strict";
import test from "node:test";
import { currentUniqueChampions, isJadeChampion } from "../lib/champion-catalog.ts";

test("Jade champion variants are removed from the draft catalog", () => {
  const catalog = currentUniqueChampions([
    { id: "GarenJade", name: "가렌", imageUrl: "/GarenJade.png" },
    { id: "Garen", name: "가렌", imageUrl: "/Garen.png" },
    { id: "Gragas", name: "그라가스", imageUrl: "/Gragas.png" },
    { id: "GragasJade", name: "그라가스", imageUrl: "/GragasJade.png" },
  ]);

  assert.equal(isJadeChampion({ id: "LuxJade", name: "럭스" }), true);
  assert.deepEqual(catalog.map((champion) => champion.id), ["Garen", "Gragas"]);
});

test("duplicate localized champion names keep only the first current entry", () => {
  const catalog = currentUniqueChampions([
    { id: "Lux", name: "럭스" },
    { id: "LuxAlias", name: " 럭스 " },
  ]);

  assert.deepEqual(catalog.map((champion) => champion.id), ["Lux"]);
});
