import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** Generate fixtures once if they are missing (CI and fresh clones). */
export default function setup() {
  if (!existsSync("fixtures/annotated.pdf") || !existsSync("fixtures/set-200.pdf")) {
    execFileSync("npx", ["tsx", "scripts/make-fixtures.ts"], { stdio: "ignore" });
  }
}
