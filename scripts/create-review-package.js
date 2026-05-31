#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REVIEW_ROOT = path.join(ROOT, "review-packages");
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

const LIST_ARGS = new Set([
  "goal",
  "not-modified",
  "acceptance",
  "known-issue",
  "review-focus",
  "test",
  "manual-check",
  "not-tested",
  "risk",
  "context",
  "test-log-file",
  "test-command",
]);

const BOOLEAN_ARGS = new Set(["help"]);

function printHelp() {
  console.log(`Usage:
  node scripts/create-review-package.js --version v0.3.6 --theme order-card-layout-fix [options]

Core options:
  --version <version>          Review package version, for example v0.3.6.
  --theme <slug>               Short ASCII theme used in directory and zip names.
  --title <text>               Human-readable iteration title.
  --base <commit>              Base commit for committed diff range. Defaults to merge-base HEAD origin/dev, then HEAD~1.
  --max-file-mb <number>       Max copied file size. Default: 5.

Review metadata options:
  --goal <text>                Iteration goal. Repeatable, also supports "|" separated values.
  --not-modified <text>        Explicit non-goal scope. Repeatable.
  --acceptance <text>          Acceptance checklist item. Repeatable.
  --known-issue <text>         Known issue. Repeatable.
  --review-focus <text>        GPT review focus. Repeatable.
  --manual-check <text>        Manual check note. Repeatable.
  --not-tested <text>          Untested area. Repeatable.
  --risk <text>                Risk item. Repeatable.

Test evidence options:
  --test <text>                Free-form test note. Repeatable.
  --test-command <command>     Execute command and capture exit code/stdout/stderr into 09_TEST_REPORT.md and 09_TEST_LOGS/.
                              Repeatable. Example: --test-command "npm.cmd test --prefix cloudfunctions/quickstartFunctions"
  --test-log-file <path>       Copy an existing test log into 09_TEST_LOGS/. Repeatable.

Context options:
  --context <path>             Manually include related context file in 08_RELATED_CONTEXT_FILES/.
                              Repeatable and supports "|" separated values.

Modes:
  committed clean mode:
    When the working tree is clean, the package defaults to baseCommit..HEAD.
    baseCommit priority: --base, merge-base HEAD origin/dev, HEAD~1, then single HEAD fallback.

  dirty working-tree mode:
    When the working tree has changes, the package contains:
    1. committed changes since baseCommit,
    2. staged/unstaged changes from HEAD to working tree,
    3. safe untracked files as generated pseudo diff.

Safety filtering:
  05_FULL_DIFF.patch is generated only for safe paths.
  Unsafe paths are excluded from copied files and full diff, and listed in 05_SKIPPED_UNSAFE_FILES.txt without file content.
  Excluded paths include .env, project.private.config.json, private keys/certs, node_modules, miniprogram_npm,
  dist, build, coverage, review-packages, .git, and WeChat DevTools local cache folders.

Examples:
  node scripts/create-review-package.js --version v0.3.6 --theme order-card-layout-fix \\
    --goal "Fix order card status overlap" --test-command "node --check scripts/create-review-package.js"

  npm run review:pack -- --version v0.3.6 --theme order-card-layout-fix --context miniprogram/utils/format.js
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;

    const eqIndex = raw.indexOf("=");
    const key = raw.slice(2, eqIndex === -1 ? undefined : eqIndex);
    if (BOOLEAN_ARGS.has(key)) {
      args[key] = true;
      continue;
    }

    let value = "";
    if (eqIndex !== -1) {
      value = raw.slice(eqIndex + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    }

    if (LIST_ARGS.has(key)) {
      args[key] = args[key] || [];
      args[key].push(value || "");
    } else {
      args[key] = value || "";
    }
  }
  return args;
}

function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    ...options,
  });

  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function runShell(command, options = {}) {
  const result = cp.spawnSync(command, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: true,
  });
  return {
    command,
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function git(args, fallback = "", cwd = ROOT) {
  const result = run("git", args, { cwd });
  if (result.status !== 0) return fallback;
  return result.stdout.trimEnd();
}

function gitRaw(args, cwd = ROOT) {
  return run("git", args, { cwd });
}

function commandCapture(label, command, args) {
  const result = run(command, args);
  const output = [result.stdout, result.stderr].filter(Boolean).join("");
  return [
    `$ ${label}`,
    `exit ${result.status}`,
    output.trimEnd() || "(no output)",
  ].join("\n");
}

function isGitRepo() {
  return git(["rev-parse", "--is-inside-work-tree"]) === "true";
}

function isValidCommit(rev) {
  if (!rev) return false;
  const result = gitRaw(["rev-parse", "--verify", `${rev}^{commit}`]);
  return result.status === 0;
}

function resolveCommit(rev) {
  if (!isValidCommit(rev)) return "";
  return git(["rev-parse", rev], "");
}

function resolveBaseCommit(args) {
  if (args.base && isValidCommit(args.base)) {
    return {
      baseCommit: resolveCommit(args.base),
      source: "--base",
      fallbackSingleCommit: false,
    };
  }

  const mergeBase = git(["merge-base", "HEAD", "origin/dev"], "");
  if (mergeBase && isValidCommit(mergeBase) && mergeBase !== resolveCommit("HEAD")) {
    return {
      baseCommit: resolveCommit(mergeBase),
      source: "merge-base HEAD origin/dev",
      fallbackSingleCommit: false,
    };
  }

  if (isValidCommit("HEAD~1")) {
    return {
      baseCommit: resolveCommit("HEAD~1"),
      source: "HEAD~1",
      fallbackSingleCommit: false,
    };
  }

  return {
    baseCommit: "",
    source: "single HEAD fallback",
    fallbackSingleCommit: true,
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(
    date.getMinutes()
  )}`;
}

function displayDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function sanitizeSegment(value, fallback) {
  const sanitized = String(value || "")
    .trim()
    .replace(/^feature[/-]/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return sanitized || fallback;
}

function toList(value, defaults = []) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const items = raw
    .flatMap((item) => String(item).split("|"))
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : defaults;
}

function mdList(items, empty = "无") {
  if (!items || !items.length) return `- ${empty}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function checkboxList(items) {
  if (!items || !items.length) return "- [ ] 无";
  return items.map((item) => `- [ ] ${item}`).join("\n");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function appendText(filePath, content) {
  fs.appendFileSync(filePath, content, "utf8");
}

function normalizeRel(file) {
  return String(file || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function unsafeReason(relPath) {
  const rel = normalizeRel(relPath);
  if (!rel) return "empty path";
  if (path.isAbsolute(rel) || rel.startsWith("../") || rel.includes("/../")) return "path escapes project root";

  const lower = rel.toLowerCase();
  const parts = lower.split("/");
  const basename = path.basename(lower);
  const blockedDirs = new Set([
    ".git",
    "node_modules",
    "miniprogram_npm",
    "dist",
    "build",
    "coverage",
    "review-packages",
    ".wechat-localappdata",
    ".wechat-temp",
    ".wechat-userprofile",
  ]);

  if (parts.some((part) => blockedDirs.has(part))) return "blocked directory";
  if (basename === ".env" || basename.startsWith(".env.")) return "environment file";
  if (basename === "project.private.config.json") return "WeChat private project config";
  if (/\.(pem|key|p12|pfx|crt|cer)$/i.test(basename)) return "private key or certificate";
  return "";
}

function isUnsafePath(relPath) {
  return Boolean(unsafeReason(relPath));
}

function fileCopyIssue(relPath, maxBytes) {
  const rel = normalizeRel(relPath);
  const reason = unsafeReason(rel);
  if (reason) return { type: "unsafe", reason };

  const source = path.join(ROOT, rel);
  if (!fs.existsSync(source)) return { type: "missing", reason: "file does not exist" };

  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) return { type: "unsafe", reason: "symlink skipped" };
  if (!stat.isFile()) return { type: "unsafe", reason: "not a regular file" };
  if (stat.size > maxBytes) return { type: "large", reason: `file size ${stat.size} exceeds ${maxBytes} bytes` };
  return null;
}

function copyPreservingPath(relPath, targetRoot, maxBytes, skippedUnsafe, skippedLarge) {
  const rel = normalizeRel(relPath);
  const issue = fileCopyIssue(rel, maxBytes);
  if (issue) {
    if (issue.type === "large") {
      skippedLarge.push({ path: rel, reason: issue.reason });
    } else if (issue.type !== "missing") {
      skippedUnsafe.push({ path: rel, reason: issue.reason });
    }
    return false;
  }

  const source = path.join(ROOT, rel);
  const target = path.join(targetRoot, rel);
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
  return true;
}

function parsePorcelainZ(output) {
  const parts = output.split("\0").filter(Boolean);
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const file = normalizeRel(entry.slice(3));
    const isRename = status.includes("R") || status.includes("C");
    if (isRename && i + 1 < parts.length) {
      const oldFile = normalizeRel(parts[i + 1]);
      i += 1;
      entries.push({ status, path: file, oldPath: oldFile, source: "working" });
    } else {
      entries.push({ status, path: file, source: "working" });
    }
  }
  return entries;
}

function parseNameStatusZ(output, source) {
  const parts = output.split("\0").filter(Boolean);
  const entries = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i] || "";
    i += 1;
    if (!status) continue;

    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = normalizeRel(parts[i] || "");
      const newPath = normalizeRel(parts[i + 1] || "");
      i += 2;
      if (newPath) entries.push({ status, oldPath, path: newPath, source });
    } else {
      const file = normalizeRel(parts[i] || "");
      i += 1;
      if (file) entries.push({ status, path: file, source });
    }
  }
  return entries;
}

function categorizeChanges(entries) {
  const result = {
    modified: [],
    added: [],
    deleted: [],
    renamed: [],
  };

  entries.forEach((entry) => {
    const status = entry.status;
    if (status.includes("R") || status.includes("C")) {
      result.renamed.push(`${entry.oldPath || "unknown"} -> ${entry.path}`);
    } else if (status.includes("D")) {
      result.deleted.push(entry.path);
    } else if (status.includes("?") || status.includes("A")) {
      result.added.push(entry.path);
    } else {
      result.modified.push(entry.path);
    }
  });

  result.modified = unique(result.modified);
  result.added = unique(result.added);
  result.deleted = unique(result.deleted);
  result.renamed = unique(result.renamed);
  return result;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function entryPaths(entries) {
  return unique(entries.map((entry) => entry.path));
}

function splitSafeEntries(entries) {
  const safe = [];
  const skipped = [];
  entries.forEach((entry) => {
    const reason = unsafeReason(entry.path);
    if (reason) {
      skipped.push({ path: entry.path, reason });
    } else {
      safe.push(entry);
    }
  });
  return { safe, skipped };
}

function safePaths(entries) {
  return unique(entries.map((entry) => entry.path).filter((file) => !isUnsafePath(file)));
}

function filterPathsForDiff(paths, maxBytes, skippedUnsafe, skippedLarge) {
  return paths.filter((file) => {
    const rel = normalizeRel(file);
    const reason = unsafeReason(rel);
    if (reason) {
      skippedUnsafe.push({ path: rel, reason });
      return false;
    }

    const source = path.join(ROOT, rel);
    if (!fs.existsSync(source)) return true;

    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
      skippedUnsafe.push({ path: rel, reason: "symlink skipped" });
      return false;
    }
    if (!stat.isFile()) {
      skippedUnsafe.push({ path: rel, reason: "not a regular file" });
      return false;
    }
    if (stat.size > maxBytes) {
      skippedLarge.push({ path: rel, reason: `file size ${stat.size} exceeds ${maxBytes} bytes` });
      return false;
    }
    return true;
  });
}

function looksBinary(buffer) {
  return Boolean(buffer && buffer.length && buffer.includes(0));
}

function pseudoDiffForUntracked(relPath, maxBytes, skippedUnsafe, skippedLarge) {
  const rel = normalizeRel(relPath);
  const issue = fileCopyIssue(rel, maxBytes);
  if (issue) {
    if (issue.type === "large") {
      skippedLarge.push({ path: rel, reason: issue.reason });
    } else if (issue.type !== "missing") {
      skippedUnsafe.push({ path: rel, reason: issue.reason });
    }
    return "";
  }

  const abs = path.join(ROOT, rel);
  const buffer = fs.readFileSync(abs);
  if (looksBinary(buffer)) {
    return [
      `diff --git a/${rel} b/${rel}`,
      "new file mode 100644",
      `Binary files /dev/null and b/${rel} differ`,
      "",
    ].join("\n");
  }

  const content = buffer.toString("utf8");
  const lines = content.length ? content.split(/\r?\n/) : [];
  return [
    `diff --git a/${rel} b/${rel}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${rel}`,
    `@@ -0,0 +1,${lines.length} @@`,
    lines.map((line) => `+${line}`).join("\n"),
    "",
  ].join("\n");
}

function getCommittedEntries(baseInfo) {
  if (!baseInfo.baseCommit) {
    const result = gitRaw(["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "HEAD"]);
    return result.status === 0 ? parseNameStatusZ(result.stdout, "committed") : [];
  }
  const result = gitRaw(["diff", "--name-status", "-z", `${baseInfo.baseCommit}..HEAD`]);
  return result.status === 0 ? parseNameStatusZ(result.stdout, "committed") : [];
}

function getCommittedDiff(baseInfo, paths) {
  if (!paths.length) return "(no safe committed changes)";
  const args = baseInfo.baseCommit
    ? ["diff", "--patch", "--binary", `${baseInfo.baseCommit}..HEAD`, "--", ...paths]
    : ["show", "--format=fuller", "--patch", "HEAD", "--", ...paths];
  const result = gitRaw(args);
  return result.status === 0 ? result.stdout.trimEnd() || "(no committed diff)" : result.stderr.trimEnd();
}

function getCommittedDiffStat(baseInfo, paths) {
  if (!paths.length) return "(no safe committed changes)";
  const args = baseInfo.baseCommit
    ? ["diff", "--stat", `${baseInfo.baseCommit}..HEAD`, "--", ...paths]
    : ["show", "--stat", "--oneline", "HEAD", "--", ...paths];
  const result = gitRaw(args);
  return result.status === 0 ? result.stdout.trimEnd() || "(no committed diff stat)" : result.stderr.trimEnd();
}

function getWorkingDiff(paths) {
  if (!paths.length) return "(no safe working tree changes)";
  const result = gitRaw(["diff", "--patch", "--binary", "HEAD", "--", ...paths]);
  return result.status === 0 ? result.stdout.trimEnd() || "(no working tree diff)" : result.stderr.trimEnd();
}

function getWorkingDiffStat(paths) {
  if (!paths.length) return "(no safe working tree changes)";
  const result = gitRaw(["diff", "--stat", "HEAD", "--", ...paths]);
  return result.status === 0 ? result.stdout.trimEnd() || "(no working tree diff stat)" : result.stderr.trimEnd();
}

function getCommitsIncluded(baseInfo) {
  const args = baseInfo.baseCommit ? ["log", "--oneline", `${baseInfo.baseCommit}..HEAD`] : ["log", "--oneline", "-1", "HEAD"];
  const result = gitRaw(args);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getContextFiles(files, manualContextRaw) {
  const auto = new Set([
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".github/workflows/pr-checks.yml",
    "docs/order-system-audit.md",
  ]);

  const hasOrderCard = files.some((file) => file.includes("miniprogram/components/order-card/"));
  const hasOrderList = files.some((file) => file.includes("miniprogram/pages/order-list/"));
  const hasHome = files.some((file) => file.includes("miniprogram/pages/home/"));
  const hasOrderDetail = files.some((file) => file.includes("miniprogram/pages/order-detail/"));
  const hasCloud = files.some((file) => file.includes("cloudfunctions/quickstartFunctions/"));

  if (hasOrderCard || hasOrderList || hasHome) {
    [
      "miniprogram/components/order-card/index.js",
      "miniprogram/components/order-card/index.wxml",
      "miniprogram/components/order-card/index.wxss",
      "miniprogram/pages/order-list/index.js",
      "miniprogram/pages/order-list/index.wxml",
      "miniprogram/pages/order-list/index.wxss",
      "miniprogram/pages/home/index.js",
      "miniprogram/pages/home/index.wxml",
      "miniprogram/pages/home/index.wxss",
      "miniprogram/utils/format.js",
      "miniprogram/utils/constants.js",
    ].forEach((file) => auto.add(file));
  }

  if (hasOrderDetail) {
    [
      "miniprogram/pages/order-detail/index.js",
      "miniprogram/pages/order-detail/index.wxml",
      "miniprogram/pages/order-detail/index.wxss",
      "miniprogram/utils/format.js",
    ].forEach((file) => auto.add(file));
  }

  if (hasCloud) {
    [
      "cloudfunctions/quickstartFunctions/package.json",
      "cloudfunctions/quickstartFunctions/index.js",
      "cloudfunctions/quickstartFunctions/lib/domain.js",
    ].forEach((file) => auto.add(file));
  }

  const manual = toList(manualContextRaw, []);
  return {
    auto: Array.from(auto).map(normalizeRel),
    manual: manual.map(normalizeRel),
  };
}

function changedFilesTree(categorized) {
  const section = (name, items) => [
    `${name}:`,
    items.length ? items.map((item) => `  ${item}`).join("\n") : "  无",
  ].join("\n");

  return [
    section("modified", categorized.modified),
    "",
    section("added", categorized.added),
    "",
    section("deleted", categorized.deleted),
    "",
    section("renamed", categorized.renamed),
    "",
  ].join("\n");
}

function skippedList(items) {
  if (!items.length) return "无";
  return unique(items.map((item) => `${item.path}\t${item.reason}`)).join("\n");
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function zipPackage(packageDir, zipPath, packageName) {
  const errors = [];
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });

  const powershellArgs = (exe) => [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Compress-Archive -LiteralPath ${psQuote(packageDir)} -DestinationPath ${psQuote(zipPath)} -Force`,
  ];

  for (const exe of ["powershell.exe", "pwsh"]) {
    const result = run(exe, powershellArgs(exe));
    if (result.status === 0 && fs.existsSync(zipPath)) {
      return { success: true, method: `${exe} Compress-Archive`, errors };
    }
    errors.push(`${exe}: ${result.error ? result.error.message : ""} ${result.stderr || result.stdout}`.trim());
  }

  const zipResult = run("zip", ["-r", zipPath, packageName], { cwd: REVIEW_ROOT });
  if (zipResult.status === 0 && fs.existsSync(zipPath)) {
    return { success: true, method: "zip -r", errors };
  }
  errors.push(`zip -r: ${zipResult.error ? zipResult.error.message : ""} ${zipResult.stderr || zipResult.stdout}`.trim());

  return { success: false, method: "", errors };
}

function truncate(value, max = 8000) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... truncated ${text.length - max} chars ...`;
}

function executeTestCommands(commands, logsDir) {
  const results = [];
  commands.forEach((command, index) => {
    const result = runShell(command);
    const logName = `test-command-${String(index + 1).padStart(2, "0")}.log`;
    const logPath = path.join(logsDir, logName);
    writeText(
      logPath,
      [`$ ${command}`, `exit ${result.status}`, "", "## stdout", result.stdout || "(empty)", "", "## stderr", result.stderr || "(empty)"].join(
        "\n"
      )
    );
    results.push({ ...result, logName });
  });
  return results;
}

function copyTestLogFiles(logFiles, logsDir, maxBytes, skippedUnsafe, skippedLarge) {
  const copied = [];
  logFiles.forEach((raw) => {
    const filePath = path.resolve(ROOT, raw);
    const relForSafety = normalizeRel(path.relative(ROOT, filePath));
    const basename = path.basename(filePath);
    const safetyReason = unsafeReason(basename) || (relForSafety.startsWith("../") ? "test log outside project root" : "");
    if (safetyReason) {
      skippedUnsafe.push({ path: raw, reason: safetyReason });
      return;
    }
    if (!fs.existsSync(filePath)) return;
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      skippedUnsafe.push({ path: raw, reason: "symlink skipped" });
      return;
    }
    if (!stat.isFile()) return;
    if (stat.size > maxBytes) {
      skippedLarge.push({ path: raw, reason: `file size ${stat.size} exceeds ${maxBytes} bytes` });
      return;
    }
    const target = path.join(logsDir, basename);
    fs.copyFileSync(filePath, target);
    copied.push(basename);
  });
  return copied;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const createdAt = new Date();
  const repo = isGitRepo();
  const branch = repo ? git(["branch", "--show-current"], "unknown") : "not-a-git-repo";
  const shortHead = repo ? git(["rev-parse", "--short", "HEAD"], "unknown") : "not-a-git-repo";
  const fullHead = repo ? git(["rev-parse", "HEAD"], "unknown") : "not-a-git-repo";
  const baseInfo = repo ? resolveBaseCommit(args) : { baseCommit: "", source: "not-a-git-repo", fallbackSingleCommit: true };
  const statusPorcelain = repo ? git(["status", "--porcelain=v1", "-z"], "") : "";
  const dirty = Boolean(statusPorcelain);
  const statusKind = repo ? (dirty ? "working-tree" : "committed") : "not-a-git-repo";
  const maxBytes = Number(args["max-file-mb"] || 5) * 1024 * 1024 || DEFAULT_MAX_FILE_BYTES;

  const version = sanitizeSegment(args.version || process.env.REVIEW_VERSION || "v0.0.0", "v0.0.0");
  const theme = sanitizeSegment(args.theme || process.env.REVIEW_THEME || branch, "review-package");
  const packageName = `${version}_${timestamp(createdAt)}_${theme}`;
  const packageDir = path.join(REVIEW_ROOT, packageName);
  const zipPath = path.join(REVIEW_ROOT, `${packageName}.zip`);

  if (fs.existsSync(packageDir)) fs.rmSync(packageDir, { recursive: true, force: true });
  ensureDir(packageDir);

  const committedEntries = repo ? getCommittedEntries(baseInfo) : [];
  const workingEntries = repo && dirty ? parsePorcelainZ(statusPorcelain) : [];
  const trackedWorkingEntries = workingEntries.filter((entry) => !entry.status.includes("?"));
  const untrackedEntries = workingEntries.filter((entry) => entry.status.includes("?"));

  const committedSplit = splitSafeEntries(committedEntries);
  const workingSplit = splitSafeEntries(trackedWorkingEntries);
  const untrackedSplit = splitSafeEntries(untrackedEntries);
  const skippedUnsafe = [...committedSplit.skipped, ...workingSplit.skipped, ...untrackedSplit.skipped];
  const skippedLarge = [];

  const safeCommittedPaths = filterPathsForDiff(safePaths(committedSplit.safe), maxBytes, skippedUnsafe, skippedLarge);
  const safeWorkingPaths = filterPathsForDiff(safePaths(workingSplit.safe), maxBytes, skippedUnsafe, skippedLarge);
  const safeUntrackedPaths = filterPathsForDiff(safePaths(untrackedSplit.safe), maxBytes, skippedUnsafe, skippedLarge);
  const allEntries = [...committedEntries, ...workingEntries];
  const allSafeEntries = [...committedSplit.safe, ...workingSplit.safe, ...untrackedSplit.safe];
  const files = unique(entryPaths(allSafeEntries));
  const categorized = categorizeChanges(allSafeEntries);

  const commitsIncluded = repo ? getCommitsIncluded(baseInfo) : [];
  const diffMode = !repo
    ? "not-a-git-repo"
    : dirty
      ? "base-plus-working-tree"
      : baseInfo.fallbackSingleCommit
        ? "single-commit"
        : "base-range";
  const diffRange = !repo
    ? ""
    : baseInfo.baseCommit
      ? `${baseInfo.baseCommit}..HEAD${dirty ? " + HEAD..working-tree" : ""}`
      : `HEAD${dirty ? " + HEAD..working-tree" : ""}`;

  const title = args.title || theme.replace(/-/g, " ");
  const goals = toList(args.goal, [`围绕“${title}”生成可独立审查的版本交付包。`]);
  const rootCause = args["root-cause"] || "当前迭代需要形成可追踪、可复现、可二次 Review 的固定交付产物。";
  const solution = args.solution || "使用审查包脚本统一收集 Git 信息、diff、变更文件、上下文文件、测试记录、风险与回滚说明，并输出 zip 包。";
  const alternatives = args.alternatives || "未采用手工整理审查包，因为人工步骤容易遗漏 diff、上下文文件或测试失败信息。";
  const notModified = toList(args["not-modified"], [
    "未修改小程序业务逻辑",
    "未修改订单状态流转",
    "未修改价格、抽成或收入计算",
    "未修改云函数业务逻辑",
    "未引入运行时依赖",
  ]);
  const reviewFocus = toList(args["review-focus"], [
    "审查包是否覆盖完整 diff 和关键源码文件",
    "敏感文件与大目录是否被排除",
    "生成脚本是否适合后续版本迭代复用",
  ]);
  const knownIssues = toList(args["known-issue"], ["未包含运行时截图；脚本会生成截图占位说明，需人工补充实际页面截图。"]);
  const acceptance = toList(args.acceptance, [
    "生成 review-packages 下的审查包目录",
    "生成同名 zip 压缩包",
    "包含 00-15 固定文档、MANIFEST.json 和 SECURITY_AND_PRIVACY.md",
    "包含完整 diff 与变更文件副本",
    "不包含 node_modules、miniprogram_npm、构建产物或敏感配置",
  ]);
  const testNotes = toList(args.test, []);
  const testCommands = toList(args["test-command"], []);
  const testLogFiles = toList(args["test-log-file"], []);
  const manualChecks = toList(args["manual-check"], ["未执行页面级手动测试。"]);
  const notTested = toList(args["not-tested"], ["未使用微信开发者工具编译。"]);
  const risks = toList(args.risk, ["脚本是交付工具，不参与小程序运行；主要风险是审查包元数据填写不完整。"]);

  const manualContextRaw = args.context || [];
  const context = getContextFiles(files, manualContextRaw);
  const autoContextFiles = context.auto.filter((file) => fs.existsSync(path.join(ROOT, file)));
  const manualContextFiles = context.manual;

  const uiChanged = files.some((file) => /^miniprogram\/.+\.(wxml|wxss)$/.test(file));
  const cloudChanged = files.some((file) => file.startsWith("cloudfunctions/"));
  const businessLogicChanged = files.some((file) =>
    /^miniprogram\/pages\/|^miniprogram\/components\/|^miniprogram\/utils\/|^cloudfunctions\//.test(file)
  );

  const committedDiff = getCommittedDiff(baseInfo, safeCommittedPaths);
  const workingDiff = dirty ? getWorkingDiff(safeWorkingPaths) : "";
  const untrackedDiff = dirty
    ? safeUntrackedPaths.map((file) => pseudoDiffForUntracked(file, maxBytes, skippedUnsafe, skippedLarge)).filter(Boolean).join("\n")
    : "";

  const fullDiff = dirty
    ? [
        "# Committed changes since base",
        committedDiff,
        "",
        "# Working tree changes since HEAD",
        workingDiff || "(no safe working tree changes)",
        "",
        "# Untracked files captured by review package generator",
        untrackedDiff || "(no safe untracked files)",
      ].join("\n")
    : committedDiff;

  const committedDiffStat = getCommittedDiffStat(baseInfo, safeCommittedPaths);
  const workingDiffStat = dirty ? getWorkingDiffStat(safeWorkingPaths) : "(working tree clean)";
  const diffStatText = repo
    ? [
        "# Committed diff stat",
        `$ git ${baseInfo.baseCommit ? `diff --stat ${baseInfo.baseCommit}..HEAD` : "show --stat --oneline HEAD"}`,
        committedDiffStat,
        "",
        "# Working tree diff stat",
        dirty ? "$ git diff --stat HEAD" : "$ git diff --stat HEAD",
        workingDiffStat,
      ].join("\n")
    : "当前目录不是 git 仓库，无法记录 diff stat。";

  const commitsIncludedText = commitsIncluded.length ? commitsIncluded.join("\n") : "(no commits included)";

  const gitStatusText = repo
    ? [
        commandCapture("git status", "git", ["status"]),
        commandCapture("git branch --show-current", "git", ["branch", "--show-current"]),
        commandCapture("git rev-parse --short HEAD", "git", ["rev-parse", "--short", "HEAD"]),
      ].join("\n\n")
    : "当前目录不是 git 仓库，无法记录 git status。";

  writeText(
    path.join(packageDir, "00_REVIEW_README.md"),
    `# Review Package - ${version}

## 迭代主题
${title}

## 基本信息
- 本次版本号：${version}
- 上一版本号或基准 commit：${baseInfo.baseCommit || "未指定，已退化为 HEAD 单提交模式"}
- 基准来源：${baseInfo.source}
- 当前 commit hash：${shortHead}${dirty ? "（未提交工作区）" : ""}
- 分支名：${branch}
- 创建时间：${displayDate(createdAt)}
- 工作区状态：${statusKind}
- diff mode：${diffMode}
- diff range：${diffRange || "无"}

${baseInfo.fallbackSingleCommit ? "> 注意：未找到可用 baseCommit，本次审查包已退化为 HEAD 单提交模式。\n" : ""}

## 迭代目标
${mdList(goals)}

## 修改范围
${mdList(files)}

## 明确未修改范围
${mdList(notModified)}

## 验收标准
${checkboxList(acceptance)}

## 当前已知问题
${mdList(knownIssues)}

## 需要 GPT 重点 Review
${mdList(reviewFocus)}
`
  );

  writeText(
    path.join(packageDir, "01_VERSION_SUMMARY.md"),
    `# Version Summary - ${version}

## 用户原始问题或需求摘要
${mdList(goals)}

## 根因判断
${rootCause}

## 实际采用的解决方案
${solution}

## 采用该方案的原因
该方案把审查包生成流程固化为脚本，后续每次 Version 迭代可以复用同一套目录结构、Git 记录、diff、源码副本、上下文文件和风险说明，降低人工漏项概率。

## 未采用的替代方案
${alternatives}

## 对业务逻辑的影响判断
${businessLogicChanged ? "本次包含可能影响小程序运行代码的文件，请结合变更文件重点确认。" : "无业务逻辑影响。"}

## 对 UI 的影响判断
${uiChanged ? "本次包含 WXML/WXSS 变更，需要检查相关页面显示。" : "无 UI 运行表现影响。"}

## 对数据结构的影响判断
未发现数据库字段或本地缓存结构变更。

## 对云函数的影响判断
${cloudChanged ? "本次包含 cloudfunctions 目录变更，请检查云函数入参、返回值和部署影响。" : "未修改云函数。"}
`
  );

  writeText(
    path.join(packageDir, "02_CHANGELOG.md"),
    `# Changelog

## Added
${mdList(categorized.added)}

## Changed
${mdList(categorized.modified)}

## Fixed
无

## Removed
${mdList(categorized.deleted)}

## Refactored
无

## Risk
${mdList(risks)}
`
  );

  writeText(path.join(packageDir, "03_GIT_STATUS.txt"), `${gitStatusText}\n`);
  writeText(path.join(packageDir, "04_DIFF_STAT.txt"), `${diffStatText}\n`);
  writeText(path.join(packageDir, "04_COMMITS_INCLUDED.txt"), `${commitsIncludedText}\n`);
  writeText(path.join(packageDir, "05_FULL_DIFF.patch"), `${fullDiff || "(no diff)"}\n`);
  writeText(path.join(packageDir, "06_CHANGED_FILES_TREE.txt"), changedFilesTree(categorized));

  const changedFilesRoot = path.join(packageDir, "07_CHANGED_FILES");
  ensureDir(changedFilesRoot);
  const copiedChanged = files.filter((file) => copyPreservingPath(file, changedFilesRoot, maxBytes, skippedUnsafe, skippedLarge));
  writeText(
    path.join(changedFilesRoot, "README.md"),
    copiedChanged.length
      ? `# Changed Files\n\n已复制 ${copiedChanged.length} 个安全变更文件，保留原始路径结构。\n`
      : "# Changed Files\n\n本次没有可复制的安全变更文件，或变更文件均为删除/不安全/超大文件。\n"
  );

  const contextRoot = path.join(packageDir, "08_RELATED_CONTEXT_FILES");
  ensureDir(contextRoot);
  const skippedContext = [];
  const copiedAutoContext = [];
  const copiedManualContext = [];

  autoContextFiles.forEach((file) => {
    if (copyPreservingPath(file, contextRoot, maxBytes, skippedUnsafe, skippedLarge)) {
      copiedAutoContext.push(file);
    } else {
      skippedContext.push(file);
    }
  });

  manualContextFiles.forEach((file) => {
    if (copyPreservingPath(file, contextRoot, maxBytes, skippedUnsafe, skippedLarge)) {
      copiedManualContext.push(file);
    } else {
      skippedContext.push(file);
    }
  });

  const copiedContext = unique([...copiedAutoContext, ...copiedManualContext]);
  writeText(
    path.join(contextRoot, "README.md"),
    copiedContext.length
      ? `# Related Context Files\n\n已复制 ${copiedContext.length} 个上下文文件。\n`
      : "# Related Context Files\n\n本次没有可复制的上下文文件，或上下文文件不存在/不安全/超大。\n"
  );

  const logsDir = path.join(packageDir, "09_TEST_LOGS");
  ensureDir(logsDir);
  const executedTests = executeTestCommands(testCommands, logsDir);
  const copiedTestLogs = copyTestLogFiles(testLogFiles, logsDir, maxBytes, skippedUnsafe, skippedLarge);

  writeText(
    path.join(packageDir, "09_TEST_REPORT.md"),
    `# Test Report

## Automated Checks

### Free-form Notes
${mdList(testNotes, "未传入 free-form test note")}

### Executed Commands
${
  executedTests.length
    ? executedTests
        .map(
          (item) => `#### ${item.command}
- exit code: ${item.status}
- log: 09_TEST_LOGS/${item.logName}

stdout:
\`\`\`text
${truncate(item.stdout || "(empty)")}
\`\`\`

stderr:
\`\`\`text
${truncate(item.stderr || "(empty)")}
\`\`\``
        )
        .join("\n\n")
    : "未通过 --test-command 执行命令。"
}

### Copied Test Logs
${mdList(copiedTestLogs)}

## Manual Checks
${mdList(manualChecks)}

## Not Tested
${mdList(notTested)}

## Risk Notes
${mdList(risks)}
`
  );

  writeText(
    path.join(packageDir, "10_UI_REVIEW.md"),
    uiChanged
      ? `# UI Review

## 涉及页面
请根据 07_CHANGED_FILES 和 08_RELATED_CONTEXT_FILES 逐项确认。

## 涉及组件
请重点检查被修改的 WXML/WXSS 文件。

## 修改前异常表现
${args["ui-before"] || "详见用户需求或 PR 描述。"}

## 修改后预期表现
${args["ui-after"] || "相关页面无重叠、无裁切、无空状态色块。"}

## 不同状态覆盖情况
- 待处理：待验证
- 进行中：待验证
- 已完成：待验证
- 已取消：待验证
- 已评价：待验证
- 未评价：待验证
- 可接订单：待验证
- 指派订单：待验证
- 有距离：待验证
- 无距离：待验证
- 非当前城市：待验证
- 有更多按钮：待验证
- 无更多按钮：待验证
- 长地址：待验证
- 长服务标题：待验证
`
      : `# UI Review

本次不涉及 UI 文件修改。
`
  );

  writeText(
    path.join(packageDir, "11_SCREENSHOTS", "README.md"),
    `# Screenshots

本次未由脚本自动生成截图。

## 未生成原因
- 当前脚本只负责打包 Git 变更、源码和审查文档。
- 微信小程序页面截图仍需要通过微信开发者工具或人工真机/模拟器补充。

## 建议用户重点截图的位置
${uiChanged ? "- 被修改页面的修改前后对比\n- 不同订单状态下的列表和详情页\n- 长文本、无距离、非同城等边界状态" : "- 如 GPT Review 需要，可补充工具脚本运行结果或 PR 文件列表截图"}

## 建议 GPT Review 对比页面
${uiChanged ? "- 住户端订单页\n- 家洁师端接单首页\n- 家洁师端订单页\n- 订单详情页" : "- 本次主要 Review 脚本产物结构和敏感信息排除规则"}
`
  );

  const riskFile = path.join(packageDir, "12_RISK_AND_ROLLBACK.md");
  writeText(
    riskFile,
    `# Risk and Rollback

## Main Risks
${mdList(risks)}

## Affected Pages
${uiChanged ? "涉及 UI 文件，需按变更文件确认页面范围。" : "无页面运行影响。"}

## Affected Components
${files.some((file) => file.includes("/components/")) ? "涉及组件文件，请检查复用场景。" : "无组件运行影响。"}

## Data Risk
未发现数据结构变更。

## Backend Risk
${cloudChanged ? "涉及云函数目录，请确认是否需要部署。" : "未修改云函数。"}

## Online User Risk
${businessLogicChanged ? "存在运行时代码变更，请按验收标准验证后发布。" : "低。本次为审查包工具链变更，不影响线上小程序运行。"}

## Rollback Plan
回退以下文件：
${mdList(files)}

## Zip Generation
如果 zip 文件存在，说明压缩阶段已完成；如果压缩失败，脚本会在此文件追加失败原因并返回非 0，同时保留审查包目录。
`
  );

  writeText(
    path.join(packageDir, "13_ACCEPTANCE_CHECKLIST.md"),
    `# Acceptance Checklist

${checkboxList(acceptance)}
`
  );

  writeText(
    path.join(packageDir, "14_DATA_AND_API_IMPACT.md"),
    `# Data and API Impact

- 数据库字段：无影响
- 云函数入参：${cloudChanged ? "请检查 cloudfunctions 变更" : "无影响"}
- 云函数返回值：${cloudChanged ? "请检查 cloudfunctions 变更" : "无影响"}
- 本地缓存：无影响
- 页面 query 参数：无影响
- 组件 properties：${files.some((file) => file.includes("/components/")) ? "请检查组件变更" : "无影响"}
- event 事件：无影响
- 订单状态枚举：无影响
- 用户角色权限：无影响
`
  );

  const notesFile = path.join(packageDir, "15_CODEX_NOTES.md");
  writeText(
    notesFile,
    `# Codex Notes

## 最不确定的地方
${args.uncertainty || "脚本只能根据 Git 状态自动推断变更范围；业务背景、手动测试结果和截图仍需要调用者通过参数或人工补充。"}

## 希望 GPT 重点看什么
${mdList(reviewFocus)}

## 最可能的回归风险
${mdList(risks)}

## 未完全验证的路径
${mdList(notTested)}

## 临时方案或技术债
${args.debt || "审查包脚本优先使用 PowerShell Compress-Archive 生成 zip，并提供 pwsh 与 zip -r fallback；如三者均不可用，会保留目录并明确失败原因。"}

${baseInfo.fallbackSingleCommit ? "## Diff Fallback\n未找到可用 baseCommit，本次审查包退化为 HEAD 单提交模式。\n" : ""}
`
  );

  const manifest = {
    project: "家洁到家",
    version,
    theme,
    created_at: displayDate(createdAt),
    branch,
    commit: shortHead,
    commit_full: fullHead,
    base_commit: baseInfo.baseCommit || "",
    base_source: baseInfo.source,
    status: statusKind,
    diff_mode: diffMode,
    diff_range: diffRange,
    commits_included: commitsIncluded,
    changed_files: files,
    safe_changed_files: files,
    skipped_unsafe_files: skippedUnsafe,
    skipped_large_files: skippedLarge,
    copied_changed_files: copiedChanged,
    auto_related_context_files: autoContextFiles,
    manual_related_context_files: manualContextFiles,
    copied_related_context_files: copiedContext,
    skipped_related_context_files: unique(skippedContext),
    business_logic_changed: businessLogicChanged,
    cloud_functions_changed: cloudChanged,
    database_schema_changed: false,
    ui_changed: uiChanged,
    requires_manual_review: true,
    review_focus: reviewFocus,
  };

  writeText(path.join(packageDir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  writeText(
    path.join(packageDir, "SECURITY_AND_PRIVACY.md"),
    `# Security and Privacy

## Sensitive Information Policy
- 未打包 .env 文件。
- 未打包密钥、token、私有证书。
- 未打包 project.private.config.json。
- 未打包 node_modules。
- 未打包 miniprogram_npm。
- 未打包 dist/build/coverage 输出目录。
- 未打包 review-packages 历史包。
- 05_FULL_DIFF.patch 也经过敏感路径过滤，只包含 safe changed files。
- 被跳过的不安全路径只记录在 05_SKIPPED_UNSAFE_FILES.txt 中，不记录文件内容。

## Included Files Review
- 变更文件副本数量：${copiedChanged.length}
- 上下文文件副本数量：${copiedContext.length}
- 跳过不安全文件数量：${skippedUnsafe.length}
- 跳过超大文件数量：${skippedLarge.length}

## Notes
如后续某次迭代必须包含可能敏感的配置文件，应先脱敏再放入审查包。
`
  );

  writeText(path.join(packageDir, "05_SKIPPED_UNSAFE_FILES.txt"), `${skippedList(skippedUnsafe)}\n`);
  writeText(path.join(packageDir, "05_SKIPPED_LARGE_FILES.txt"), `${skippedList(skippedLarge)}\n`);

  const zipResult = zipPackage(packageDir, zipPath, packageName);
  if (!zipResult.success) {
    const reason = zipResult.errors.join("\n");
    appendText(riskFile, `\n## Zip Generation Failure\nzip 未生成。原因：\n\`\`\`text\n${reason}\n\`\`\`\n`);
    appendText(notesFile, `\n## Zip Generation Failure\nzip 未生成。原因：\n\`\`\`text\n${reason}\n\`\`\`\n`);
    console.log(`REVIEW_PACKAGE_DIR=${packageDir}`);
    console.log(`REVIEW_PACKAGE_ZIP_FAILED=${zipPath}`);
    console.error(reason);
    process.exitCode = 1;
    return;
  }

  console.log(`REVIEW_PACKAGE_DIR=${packageDir}`);
  console.log(`REVIEW_PACKAGE_ZIP=${zipPath}`);
  console.log(`REVIEW_PACKAGE_ZIP_METHOD=${zipResult.method}`);
}

main();
