#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const assert = require("assert");
const zlib = require("zlib");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const GENERATOR = path.join(SOURCE_ROOT, "scripts", "create-review-package.js");

function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    ...options,
  });
  if (options.allowFailure) return result;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout || ""}\n${result.stderr || ""}`
    );
  }
  return result;
}

function git(repo, args) {
  return run("git", args, { cwd: repo }).stdout.trim();
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function setupRepo(name) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `review-pack-${name}-`));
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.copyFileSync(GENERATOR, path.join(repo, "scripts", "create-review-package.js"));
  write(path.join(repo, "package.json"), JSON.stringify({ scripts: { "review:pack": "node scripts/create-review-package.js" } }, null, 2));
  git(repo, ["init"]);
  git(repo, ["config", "user.name", "Review Pack Test"]);
  git(repo, ["config", "user.email", "review-pack-test@example.com"]);
  return repo;
}

function commit(repo, message) {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function packageDirs(repo) {
  const root = path.join(repo, "review-packages");
  return fs
    .readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .map((name) => path.join(root, name));
}

function latestPackage(repo) {
  const dirs = packageDirs(repo);
  assert.strictEqual(dirs.length, 1, `expected one package dir, found ${dirs.length}`);
  return dirs[0];
}

function pack(repo, args = []) {
  run("node", ["scripts/create-review-package.js", "--version", "vtest", "--theme", "test", ...args], { cwd: repo });
  return latestPackage(repo);
}

function read(pkg, rel) {
  return fs.readFileSync(path.join(pkg, rel), "utf8");
}

function listZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const entries = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      const flags = buffer.readUInt16LE(offset + 6);
      const method = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const fileName = buffer.slice(nameStart, nameStart + fileNameLength).toString("utf8");
      entries.push(fileName);
      const dataStart = nameStart + fileNameLength + extraLength;

      if (flags & 0x08) {
        const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
        if (next === -1) break;
        offset = next;
      } else if (method === 0 || method === 8 || method === 9) {
        offset = dataStart + compressedSize;
      } else {
        const maybeInflate = zlib;
        void maybeInflate;
        offset = dataStart + compressedSize;
      }
      continue;
    }
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    offset += 1;
  }
  return entries;
}

function testCommittedRangeIncludesTwoCommits() {
  const repo = setupRepo("committed");
  write(path.join(repo, "file.txt"), "base\n");
  const base = commit(repo, "base commit");
  write(path.join(repo, "file.txt"), "base\nchange-one\n");
  commit(repo, "change one");
  write(path.join(repo, "another.txt"), "change-two\n");
  commit(repo, "change two");

  const pkg = pack(repo, ["--base", base]);
  const patch = read(pkg, "05_FULL_DIFF.patch");
  const commits = read(pkg, "04_COMMITS_INCLUDED.txt");
  assert.match(patch, /change-one/);
  assert.match(patch, /change-two/);
  assert.match(commits, /change one/);
  assert.match(commits, /change two/);
}

function testDirtyModeIncludesCommittedWorkingAndUntracked() {
  const repo = setupRepo("dirty");
  write(path.join(repo, "base.txt"), "base\n");
  const base = commit(repo, "base commit");
  write(path.join(repo, "committed.txt"), "committed-change\n");
  commit(repo, "committed change");
  write(path.join(repo, "tracked.txt"), "tracked-old\n");
  commit(repo, "tracked baseline");
  write(path.join(repo, "staged.txt"), "staged-change\n");
  git(repo, ["add", "staged.txt"]);
  write(path.join(repo, "tracked.txt"), "unstaged-new\n");
  write(path.join(repo, "untracked.txt"), "untracked-change\n");

  const pkg = pack(repo, ["--base", base]);
  const patch = read(pkg, "05_FULL_DIFF.patch");
  assert.match(patch, /# Committed changes since base/);
  assert.match(patch, /# Working tree changes since HEAD/);
  assert.match(patch, /# Untracked files captured by review package generator/);
  assert.match(patch, /committed-change/);
  assert.match(patch, /staged-change/);
  assert.match(patch, /unstaged-new/);
  assert.match(patch, /untracked-change/);
}

function testUnsafeFilesAreFilteredFromFullDiff() {
  const repo = setupRepo("unsafe");
  write(path.join(repo, "safe.txt"), "safe-base\n");
  write(path.join(repo, ".env"), "TOKEN=old\n");
  const base = commit(repo, "base commit");
  write(path.join(repo, "safe.txt"), "safe-change\n");
  write(path.join(repo, ".env"), "TOKEN=super-secret-value\n");
  commit(repo, "change safe and env");

  const pkg = pack(repo, ["--base", base]);
  const patch = read(pkg, "05_FULL_DIFF.patch");
  const skipped = read(pkg, "05_SKIPPED_UNSAFE_FILES.txt");
  assert.doesNotMatch(patch, /super-secret-value/);
  assert.match(patch, /safe-change/);
  assert.match(skipped, /\.env/);
}

function testContextLargeFileReadmesHelpAndZip() {
  const repo = setupRepo("context");
  write(path.join(repo, "base.txt"), "base\n");
  const base = commit(repo, "base commit");
  write(path.join(repo, "safe-context.txt"), "context\n");
  write(path.join(repo, "large.bin"), "x".repeat(6 * 1024 * 1024));
  write(path.join(repo, "feature.txt"), "feature\n");
  commit(repo, "feature commit");

  const help = run("node", ["scripts/create-review-package.js", "--help"], { cwd: repo }).stdout;
  assert.match(help, /--context/);
  assert.match(help, /dirty working-tree/i);
  assert.match(help, /unsafe/i);

  const pkg = pack(repo, ["--base", base, "--context", "safe-context.txt|large.bin"]);
  const manifest = JSON.parse(read(pkg, "MANIFEST.json"));
  const large = read(pkg, "05_SKIPPED_LARGE_FILES.txt");
  const patch = read(pkg, "05_FULL_DIFF.patch");
  assert(manifest.manual_related_context_files.includes("safe-context.txt"));
  assert(manifest.copied_related_context_files.includes("safe-context.txt"));
  assert.match(large, /large\.bin/);
  assert.doesNotMatch(patch, /xxxxxx/);
  assert(fs.existsSync(path.join(pkg, "07_CHANGED_FILES", "README.md")));
  assert(fs.existsSync(path.join(pkg, "08_RELATED_CONTEXT_FILES", "README.md")));

  const zipFile = path.join(path.dirname(pkg), `${path.basename(pkg)}.zip`);
  assert(fs.existsSync(zipFile), "zip should be generated");
  const entries = listZipEntries(zipFile);
  assert(entries.every((entry) => entry.startsWith(`${path.basename(pkg)}\\`) || entry.startsWith(`${path.basename(pkg)}/`)));
}

function main() {
  const tests = [
    testCommittedRangeIncludesTwoCommits,
    testDirtyModeIncludesCommittedWorkingAndUntracked,
    testUnsafeFilesAreFilteredFromFullDiff,
    testContextLargeFileReadmesHelpAndZip,
  ];

  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }
}

main();
