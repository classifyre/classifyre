import { test, expect } from "@playwright/test";
const X = process.env.NONEXISTENT_VAR;
if (!X) throw new Error("Deliberate throw for testing");
test("should not run", async ({ page }) => {
  console.log("THIS SHOULD NOT PRINT");
});
