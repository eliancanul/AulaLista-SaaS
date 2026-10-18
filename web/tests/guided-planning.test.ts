import { describe, expect, it } from "vitest";
import { guidedExample, guidedResources, validateGuidedRequest } from "../src/acenta/guided-planning";

describe("guided planning contract", () => {
  it("accepts the bounded manual example without inventing a source", () => {
    const q = guidedExample();
    expect(validateGuidedRequest(q)).toEqual({});
    expect(q.reference).toBeNull();
    expect(q.contract_version).toBe(2);
    expect(q).not.toHaveProperty("source_id");
  });
  it("validates fields without replacing the user's values", () => {
    const q = {...guidedExample(), topic:"", duration_minutes:0};
    expect(validateGuidedRequest(q)).toEqual({topic:expect.any(String), duration_minutes:expect.any(String)});
    expect(q.topic).toBe("");
  });
  it("projects canonical fields into editable targets without duplicating result data", () => {
    const r = {provenance:"synthetic-fixture-v1" as const, kind:"guided-planning-v1" as const,
      title:"Example", notice:"Software fixture", purpose:"Purpose", formative_assessment:"Check",
      duration_minutes:50, materials:["Paper"], activities:[{key:"introduction", title:"Inicio", statement:"Talk", minutes:50}]};
    const resources = guidedResources(r);
    expect(resources[0].elements.map(x=>x.key)).toEqual(["purpose","formative_assessment","material-0"]);
    expect(resources[1]).toMatchObject({key:"activity:introduction",elements:[{key:"statement",text:"Talk"},{key:"minutes",text:"50"}]});
    expect(r).not.toHaveProperty("resources");
  });
});
