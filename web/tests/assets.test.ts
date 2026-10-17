import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it, expect } from "vitest";
const validator = fileURLToPath(
  new URL("./validate_assets.py", import.meta.url),
);
it("all bundled SVG, PNG and TTF files parse as their declared format and match the validated manifest", () => {
  const actual = JSON.parse(
    execFileSync("python3", [validator], { encoding: "utf8" }),
  );
  const expected = JSON.parse(
    readFileSync(
      new URL("../public/acenta/asset-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  expect(actual).toEqual(expected);
  expect(actual).toHaveLength(20);
});
it("asset validation rejects HTML error pages, malformed XML, empty SVG and corrupt binary signatures", () => {
  const result = JSON.parse(
    execFileSync("python3", [validator, "--self-test"], { encoding: "utf8" }),
  );
  expect(result.rejected_invalid_fixtures).toBe(6);
});
