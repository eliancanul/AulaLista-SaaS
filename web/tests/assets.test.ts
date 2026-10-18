import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it, expect } from "vitest";
const validator = fileURLToPath(
  new URL("./validate_assets.py", import.meta.url),
);
it("quotes the numeric font family in both face registrations and the default stack", () => {
  const css = readFileSync(
    new URL("../src/acenta/style.css", import.meta.url),
    "utf8",
  );
  const families = [...css.matchAll(/font-family\s*:\s*([^;]+);/g)]
    .map((match) => match[1])
    .filter((value) => value.includes("Source Sans 3"));
  expect(families).toHaveLength(3);
  for (const family of families) {
    expect(family).toMatch(/^(["'])Source Sans 3\1\s*(,|$)/);
  }
});
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
  expect(actual).toHaveLength(29);
});
it("asset validation rejects HTML error pages, malformed XML, empty SVG and corrupt binary signatures", () => {
  const result = JSON.parse(
    execFileSync("python3", [validator, "--self-test"], { encoding: "utf8" }),
  );
  expect(result.rejected_invalid_fixtures).toBe(6);
});
