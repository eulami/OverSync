import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  inspectDockerfile,
  isRootUser,
  parseDockerfileInstructions,
  parseDockerfileStages,
} from "./container-hardening.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** A minimal multi-stage Dockerfile whose runtime stage declares `user`. */
function dockerfile(user) {
  return `FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
USER ${user}
CMD ["node", "dist/index.js"]
`;
}

describe("inspectDockerfile — repository images", () => {
  for (const dockerfilePath of ["resolver/Dockerfile", "relayer/Dockerfile"]) {
    it(`runs ${dockerfilePath} as an unprivileged user`, () => {
      const content = readFileSync(resolve(repoRoot, dockerfilePath), "utf8");
      const result = inspectDockerfile(content);
      assert.deepEqual(result.errors, []);
      assert.equal(result.ok, true);
      assert.equal(result.user, "node");
    });
  }
});

describe("inspectDockerfile — accepted runtime users", () => {
  it("accepts a named unprivileged user", () => {
    assert.equal(inspectDockerfile(dockerfile("node")).ok, true);
  });

  it("accepts a numeric unprivileged uid", () => {
    assert.equal(inspectDockerfile(dockerfile("10001:10001")).ok, true);
  });

  it("accepts instructions in lower case", () => {
    const content = dockerfile("node").replace("USER node", "user node");
    assert.equal(inspectDockerfile(content).user, "node");
  });
});

describe("inspectDockerfile — root runtime", () => {
  it("rejects a runtime stage that declares no user", () => {
    const content = dockerfile("node").replace("USER node\n", "");
    const result = inspectDockerfile(content);
    assert.equal(result.ok, false);
    assert.equal(result.user, null);
    assert.match(result.errors[0], /sets no USER, so the container runs as root/);
  });

  it("rejects each spelling of root", () => {
    for (const user of ["root", "0", "0:0", "root:root", "root:0"]) {
      const result = inspectDockerfile(dockerfile(user));
      assert.equal(result.ok, false, `expected USER ${user} to be rejected`);
      assert.match(result.errors[0], /runs as root/);
    }
  });

  it("rejects a root user that is re-declared after a good one", () => {
    const content = dockerfile("node").replace("CMD", "USER root\nCMD");
    assert.equal(inspectDockerfile(content).ok, false);
  });

  it("rejects a file with no FROM instruction", () => {
    const result = inspectDockerfile("USER node\n");
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /no FROM instruction/);
  });
});

describe("inspectDockerfile — stage boundaries", () => {
  it("ignores a USER declared in a builder stage only", () => {
    const content = `FROM node:22-alpine AS builder
USER node
RUN npm run build

FROM node:22-alpine AS runtime
CMD ["node", "dist/index.js"]
`;
    const result = inspectDockerfile(content);
    assert.equal(result.ok, false);
    assert.equal(result.stage, "runtime");
  });

  it("inspects the last stage when there is no alias", () => {
    const content = `FROM node:22-alpine
RUN npm run build

FROM node:22-alpine
USER restore
USER node
`;
    const result = inspectDockerfile(content);
    assert.equal(result.ok, true);
    assert.equal(result.stage, "stage 2");
    assert.equal(result.user, "node");
  });
});

describe("isRootUser", () => {
  it("treats uid 0 as root", () => {
    for (const value of ["root", "0", "0:0", "root:root", " 0 : 0 "]) {
      assert.equal(isRootUser(value), true, `expected "${value}" to be root`);
    }
  });

  it("treats named and numeric non-zero users as unprivileged", () => {
    for (const value of ["node", "1000", "1000:1000", "app:app"]) {
      assert.equal(isRootUser(value), false, `expected "${value}" to be unprivileged`);
    }
  });
});

describe("parseDockerfileInstructions", () => {
  it("joins line continuations and skips comments", () => {
    const instructions = parseDockerfileInstructions(`# build stage
FROM node:22-alpine \\
  AS runtime
RUN echo hello
`);
    assert.deepEqual(
      instructions.map((instruction) => instruction.name),
      ["FROM", "RUN"],
    );
    assert.equal(instructions[0].args, "node:22-alpine AS runtime");
  });
});

describe("parseDockerfileStages", () => {
  it("returns the base image and alias of every stage", () => {
    const stages = parseDockerfileStages(dockerfile("node"));
    assert.deepEqual(
      stages.map(({ base, alias }) => [base, alias]),
      [
        ["node:22-alpine", "builder"],
        ["node:22-alpine", "runtime"],
      ],
    );
  });
});
