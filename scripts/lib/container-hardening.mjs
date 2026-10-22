/**
 * Static inspection of container definitions.
 *
 * Docker runs a container as root unless the image's final stage declares a
 * `USER` instruction. These helpers read a Dockerfile as text — no Docker
 * daemon or image build required — so CI can fail when a published image
 * would run as root.
 */

/**
 * Splits a Dockerfile into instructions, joining `\` line continuations and
 * skipping comments and blank lines.
 */
export function parseDockerfileInstructions(content) {
  const instructions = [];
  let pending = "";

  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (pending === "" && (line === "" || line.startsWith("#"))) continue;

    const continues = line.endsWith("\\");
    const fragment = continues ? line.slice(0, -1).trimEnd() : line;
    pending = pending === "" ? fragment : `${pending} ${fragment}`;
    if (continues) continue;

    const instruction = pending.trim();
    pending = "";
    if (instruction === "") continue;

    const match = /^([A-Za-z]+)\s+([\s\S]*)$/.exec(instruction);
    if (!match) continue;
    instructions.push({ name: match[1].toUpperCase(), args: match[2].trim() });
  }

  return instructions;
}

/**
 * Groups instructions by build stage. `FROM x AS y` starts a new stage; the
 * final stage is the image that actually gets published.
 */
export function parseDockerfileStages(content) {
  const stages = [];

  for (const instruction of parseDockerfileInstructions(content)) {
    if (instruction.name === "FROM") {
      const parts = instruction.args.split(/\s+/);
      const asIndex = parts.findIndex((part) => part.toLowerCase() === "as");
      stages.push({
        base: parts[0],
        alias: asIndex === -1 ? null : parts[asIndex + 1] ?? null,
        instructions: [],
      });
      continue;
    }
    if (stages.length === 0) continue;
    stages[stages.length - 1].instructions.push(instruction);
  }

  return stages;
}

/**
 * True when a `USER` value resolves to uid 0, i.e. the container still runs
 * with root privileges. Accepts `root`, `0`, `0:0`, `root:root`, and similar.
 */
export function isRootUser(value) {
  const user = String(value).trim().split(":")[0].trim().toLowerCase();
  return user === "root" || /^0+$/.test(user);
}

/**
 * Inspects the runtime (final) stage of a Dockerfile.
 *
 * Returns the `USER` that wins at runtime, the stage label, and any problems
 * found. `ok` is true only when that stage declares a non-root user.
 */
export function inspectDockerfile(content) {
  const stages = parseDockerfileStages(content);

  if (stages.length === 0) {
    return {
      ok: false,
      stage: null,
      user: null,
      errors: ["no FROM instruction, so it is not a Dockerfile"],
    };
  }

  const runtime = stages[stages.length - 1];
  const stage = runtime.alias ?? `stage ${stages.length}`;
  const userInstructions = runtime.instructions.filter((instruction) => instruction.name === "USER");
  const declared = userInstructions[userInstructions.length - 1];

  if (!declared) {
    return {
      ok: false,
      stage,
      user: null,
      errors: [`runtime stage "${stage}" sets no USER, so the container runs as root`],
    };
  }

  if (isRootUser(declared.args)) {
    return {
      ok: false,
      stage,
      user: declared.args,
      errors: [`runtime stage "${stage}" runs as root (USER ${declared.args})`],
    };
  }

  return { ok: true, stage, user: declared.args, errors: [] };
}
