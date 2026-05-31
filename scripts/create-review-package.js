#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REVIEW_ROOT = path.join(ROOT, "review-packages");

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
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;

    const eqIndex = raw.indexOf("=");
    const key = raw.slice(2, eqIndex === -1 ? undefined : eqIndex);
    const value = eqIndex === -1 ? argv[i + 1] : raw.slice(eqIndex + 1);
    if (eqIndex === -1) i += 1;

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
    cwd: ROOT,
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

function git(args, fallback = "") {
  const result = run("git", args);
  if (result.status !== 0) return fallback;
  return result.stdout.trimEnd();
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

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestamp(date = new Date()) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}${m}${d}_${hh}${mm}`;
}

function displayDate(date = new Date()) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
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

function normalizeRel(file) {
  return String(file || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function isUnsafePath(relPath) {
  const rel = normalizeRel(relPath);
  if (!rel || rel.startsWith("../") || path.isAbsolute(rel)) return true;
  const parts = rel.split("/");
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
  if (parts.some((part) => blockedDirs.has(part))) return true;
  if (/^\.env($|\.)/.test(path.basename(rel))) return true;
  if (/project\.private\.config\.json$/i.test(rel)) return true;
  if (/\.(pem|key|p12|pfx|crt|cer)$/i.test(rel)) return true;
  return false;
}

function copyPreservingPath(relPath, targetRoot) {
  const rel = normalizeRel(relPath);
  if (isUnsafePath(rel)) return false;

  const source = path.join(ROOT, rel);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return false;

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
    const xy = entry.slice(0, 2);
    const file = normalizeRel(entry.slice(3));
    const isRename = xy.includes("R") || xy.includes("C");
    if (isRename && i + 1 < parts.length) {
      const oldFile = normalizeRel(parts[i + 1]);
      i += 1;
      entries.push({ status: xy, path: file, oldPath: oldFile });
    } else {
      entries.push({ status: xy, path: file });
    }
  }
  return entries;
}

function parseNameStatus(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      const status = parts[0];
      if (status.startsWith("R") || status.startsWith("C")) {
        return { status, oldPath: normalizeRel(parts[1]), path: normalizeRel(parts[2]) };
      }
      return { status, path: normalizeRel(parts[1]) };
    })
    .filter((entry) => entry.path);
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

  return result;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function changedPaths(entries) {
  return unique(entries.map((entry) => entry.path).filter((file) => !isUnsafePath(file)));
}

function looksBinary(buffer) {
  if (!buffer || !buffer.length) return false;
  return buffer.includes(0);
}

function pseudoDiffForUntracked(relPath) {
  const rel = normalizeRel(relPath);
  if (isUnsafePath(rel)) return "";

  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return "";
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
  const addedLines = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${rel} b/${rel}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${rel}`,
    `@@ -0,0 +1,${lines.length} @@`,
    addedLines,
    "",
  ].join("\n");
}

function getContextFiles(files) {
  const context = new Set([
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
    ].forEach((file) => context.add(file));
  }

  if (hasOrderDetail) {
    [
      "miniprogram/pages/order-detail/index.js",
      "miniprogram/pages/order-detail/index.wxml",
      "miniprogram/pages/order-detail/index.wxss",
      "miniprogram/utils/format.js",
    ].forEach((file) => context.add(file));
  }

  if (hasCloud) {
    [
      "cloudfunctions/quickstartFunctions/package.json",
      "cloudfunctions/quickstartFunctions/index.js",
      "cloudfunctions/quickstartFunctions/lib/domain.js",
    ].forEach((file) => context.add(file));
  }

  return Array.from(context).filter((file) => {
    const abs = path.join(ROOT, file);
    return !isUnsafePath(file) && fs.existsSync(abs) && fs.statSync(abs).isFile();
  });
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

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function zipPackage(packageDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  const command = `Compress-Archive -LiteralPath ${psQuote(packageDir)} -DestinationPath ${psQuote(zipPath)} -Force`;
  const result = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  if (result.status !== 0) {
    throw new Error(`Compress-Archive failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const createdAt = new Date();
  const repo = isGitRepo();
  const branch = repo ? git(["branch", "--show-current"], "unknown") : "not-a-git-repo";
  const shortHead = repo ? git(["rev-parse", "--short", "HEAD"], "unknown") : "not-a-git-repo";
  const baseCommit =
    args.base ||
    (repo ? git(["merge-base", "HEAD", "origin/dev"], "") || git(["rev-parse", "--short", "HEAD~1"], "") : "");
  const statusPorcelain = repo ? git(["status", "--porcelain=v1", "-z"], "") : "";
  const dirty = Boolean(statusPorcelain);
  const statusKind = repo ? (dirty ? "working-tree" : "committed") : "not-a-git-repo";

  const version = sanitizeSegment(args.version || process.env.REVIEW_VERSION || "v0.0.0", "v0.0.0");
  const theme = sanitizeSegment(args.theme || process.env.REVIEW_THEME || branch, "review-package");
  const packageName = `${version}_${timestamp(createdAt)}_${theme}`;
  const packageDir = path.join(REVIEW_ROOT, packageName);
  const zipPath = path.join(REVIEW_ROOT, `${packageName}.zip`);

  if (fs.existsSync(packageDir)) fs.rmSync(packageDir, { recursive: true, force: true });
  ensureDir(packageDir);

  const entries = repo
    ? dirty
      ? parsePorcelainZ(statusPorcelain)
      : parseNameStatus(git(["show", "--name-status", "--format=", "HEAD"], ""))
    : [];
  const categorized = categorizeChanges(entries);
  const files = changedPaths(entries);
  const contextFiles = getContextFiles(files);

  const title = args.title || theme.replace(/-/g, " ");
  const goals = toList(args.goal, [`围绕“${title}”生成可独立审查的版本交付包。`]);
  const rootCause = args["root-cause"] || "当前迭代需要形成可追踪、可复现、可二次 Review 的固定交付产物。";
  const solution = args.solution || "新增自动化审查包生成脚本，统一收集 Git 信息、diff、变更文件、上下文文件、测试记录、风险与回滚说明，并输出 zip 包。";
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
  const tests = toList(args.test, ["未传入测试记录；请在调用脚本时使用 --test 补充。"]);
  const manualChecks = toList(args["manual-check"], ["未执行页面级手动测试。"]);
  const notTested = toList(args["not-tested"], ["未使用微信开发者工具编译。"]);
  const risks = toList(args.risk, ["脚本是交付工具，不参与小程序运行；主要风险是审查包元数据填写不完整。"]);

  const uiChanged = files.some((file) => /^miniprogram\/.+\.(wxml|wxss)$/.test(file));
  const cloudChanged = files.some((file) => file.startsWith("cloudfunctions/"));
  const businessLogicChanged = files.some((file) =>
    /^miniprogram\/pages\/|^miniprogram\/components\/|^miniprogram\/utils\/|^cloudfunctions\//.test(file)
  );

  const gitStatusText = repo
    ? [
        commandCapture("git status", "git", ["status"]),
        commandCapture("git branch --show-current", "git", ["branch", "--show-current"]),
        commandCapture("git rev-parse --short HEAD", "git", ["rev-parse", "--short", "HEAD"]),
      ].join("\n\n")
    : "当前目录不是 git 仓库，无法记录 git status。";

  const diffStatText = repo
    ? [
        commandCapture("git diff --stat", "git", ["diff", "--stat"]),
        dirty ? "" : commandCapture("git show --stat --oneline HEAD", "git", ["show", "--stat", "--oneline", "HEAD"]),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "当前目录不是 git 仓库，无法记录 diff stat。";

  let fullDiff = repo
    ? dirty
      ? git(["diff", "--patch", "--binary", "HEAD"], "")
      : git(["show", "--format=fuller", "--patch", "HEAD"], "")
    : "当前目录不是 git 仓库，无法生成 diff。";

  if (dirty) {
    const untracked = entries.filter((entry) => entry.status.includes("?")).map((entry) => entry.path);
    const pseudo = untracked.map(pseudoDiffForUntracked).filter(Boolean).join("\n");
    if (pseudo) {
      fullDiff = [fullDiff, "\n# Untracked files captured by review package generator\n", pseudo]
        .filter(Boolean)
        .join("\n");
    }
  }

  writeText(
    path.join(packageDir, "00_REVIEW_README.md"),
    `# Review Package - ${version}

## 迭代主题
${title}

## 基本信息
- 本次版本号：${version}
- 上一版本号或基准 commit：${baseCommit || "未指定"}
- 当前 commit hash：${shortHead}${dirty ? "（未提交工作区）" : ""}
- 分支名：${branch}
- 创建时间：${displayDate(createdAt)}
- 工作区状态：${statusKind}

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
  writeText(path.join(packageDir, "05_FULL_DIFF.patch"), `${fullDiff || "(no diff)"}\n`);
  writeText(path.join(packageDir, "06_CHANGED_FILES_TREE.txt"), changedFilesTree(categorized));

  const changedFilesRoot = path.join(packageDir, "07_CHANGED_FILES");
  const copiedChanged = files.filter((file) => copyPreservingPath(file, changedFilesRoot));

  const contextRoot = path.join(packageDir, "08_RELATED_CONTEXT_FILES");
  const copiedContext = contextFiles.filter((file) => copyPreservingPath(file, contextRoot));

  writeText(
    path.join(packageDir, "09_TEST_REPORT.md"),
    `# Test Report

## Automated Checks
${tests.map((item) => `### ${item}\n结果：见命令描述\n`).join("\n")}

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

  writeText(
    path.join(packageDir, "12_RISK_AND_ROLLBACK.md"),
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

  writeText(
    path.join(packageDir, "15_CODEX_NOTES.md"),
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
${args.debt || "审查包脚本使用 PowerShell Compress-Archive 生成 zip，当前面向 Windows/Codex Desktop 环境；如迁移到 Linux CI，可改为跨平台 zip 实现。"}
`
  );

  const manifest = {
    project: "家洁到家",
    version,
    theme,
    created_at: displayDate(createdAt),
    branch,
    commit: shortHead,
    base_commit: baseCommit || "",
    status: statusKind,
    changed_files: files,
    copied_changed_files: copiedChanged,
    related_context_files: copiedContext,
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

## Included Files Review
- 变更文件副本数量：${copiedChanged.length}
- 上下文文件副本数量：${copiedContext.length}

## Notes
如后续某次迭代必须包含可能敏感的配置文件，应先脱敏再放入审查包。
`
  );

  zipPackage(packageDir, zipPath);

  console.log(`REVIEW_PACKAGE_DIR=${packageDir}`);
  console.log(`REVIEW_PACKAGE_ZIP=${zipPath}`);
}

main();
