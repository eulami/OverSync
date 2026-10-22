#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectDockerfile } from "./lib/container-hardening.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// Every container image this repository builds.
const DOCKERFILES = ["resolver/Dockerfile", "relayer/Dockerfile"];

let failures = 0;

for (const dockerfile of DOCKERFILES) {
  let content;
  try {
    content = readFileSync(path.resolve(ROOT, dockerfile), "utf8");
  } catch {
    console.log(`\u274C ${dockerfile}: cannot read Dockerfile`);
    failures += 1;
    continue;
  }

  const { ok, stage, user, errors } = inspectDockerfile(content);
  if (ok) {
    console.log(`\u2713 ${dockerfile}: runs as ${user} (${stage})`);
    continue;
  }

  failures += 1;
  for (const error of errors) {
    console.log(`\u274C ${dockerfile}: ${error}`);
  }
}

if (failures > 0) {
  console.error(`\n\u2717 ${failures} container image(s) would run as root`);
  process.exit(1);
}

console.log("\n\u2713 All container images run as an unprivileged user");
