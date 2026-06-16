# CloudBase 初始化与生产环境对齐报告

生成时间：2026-06-15

目标云环境：`cloud1-d2g1lrdxc1bd1d890`

当前分支：`feature/v0.2.9-launch-blockers-and-manual-qa-readiness`

执行时基准 commit：`98db081`

## 执行结果摘要

本次已完成本地 schema 初始化清单修正和生产配置报告生成，但远端 CloudBase 数据库集合尚未全部自动创建。

原因：

- 微信开发者工具 CLI 可以读取云环境和云函数信息。
- `quickstartFunctions` 线上存在，状态为 `Active`。
- 但 CLI 上传云函数失败：
  - 整包部署失败：`EISDIR: illegal operation on a directory, read`
  - 增量部署失败：`getCloudAPISignedHeader failed ret=41002 system error`
- 当前微信 CLI 没有提供数据库集合、索引、权限规则的直接创建命令。
- 本机未发现可直接使用的 `tcb` / `cloudbase` 独立 CLI。

因此，数据库集合创建、索引、权限规则仍需在微信开发者工具 / CloudBase 控制台人工完成。

## 本地校验结果

- `node --check cloudfunctions/quickstartFunctions/index.js`：通过
- `node --check cloudfunctions/quickstartFunctions/test/actions.test.js`：通过
- `cmd /c npm.cmd test --prefix cloudfunctions/quickstartFunctions`：通过
- `git diff --check`：通过，仅提示 Windows 下 `index.js` 下次 Git 触碰时 LF 会被替换为 CRLF

## 已纳入 initCollections 清单的 collections

已将以下集合纳入 `cloudfunctions/quickstartFunctions/index.js` 的 `COLLECTIONS` 初始化清单：

### 订单与支付

- `orders`
- `pricingQuotes`
- `pricingRules`
- `paymentIntents`
- `paymentCallbacks`
- `refundRequests`
- `settlements`
- `payoutRecords`

### 用户与家洁师

- `users`
- `customerProfiles`
- `cleaners`
- `cleanerProfiles`
- `cleanerVerifications`
- `insurancePolicies`
- `insuranceEnrollments`

### 风控系统

- `cleanerTrustProfile`
- `orderRiskProfile`
- `behaviorGraph`
- `behaviorGraphEdges`

### 售后与服务

- `protectionClaims`
- `supportTickets`
- `serviceProofs`
- `serviceStandards`
- `protectionPlans`

### 系统与运维

- `auditLogs`
- `systemMetrics`
- `opsActions`
- `platformStats`
- `reviews`
- `conversations`
- `messages`
- `userAddresses`
- `adminUsers`
- `favorites`
- `coupons`
- `payoutAdjustments`
- `reconciliationReports`

## 远端创建状态

未能通过 CLI 自动确认或创建远端集合。

必须人工执行以下二选一流程。

### 推荐流程 A：通过开发者工具上传云函数后调用 initCollections

1. 在微信开发者工具中确认当前项目路径为：

   `C:\Users\18961\.config\superpowers\worktrees\jiajie-daojia\v0.2.1-r2`

2. 右键：

   `cloudfunctions/quickstartFunctions`

3. 选择：

   `上传并部署：云端安装依赖`

4. 上传成功后，确认云函数配置：

   - runtime：建议 Node.js 18 或平台支持的稳定 Node 版本
   - timeout：建议至少 20 秒
   - 环境变量：
     - `APP_ENV=production`
     - `ADMIN_OPENIDS=<管理员 openid 列表>` 或在 `adminUsers` 集合维护管理员
     - 微信支付相关变量仅在真实联调时配置，不写入代码

5. 使用管理员账号在调试器 Console 中执行：

```js
wx.cloud.callFunction({
  name: "quickstartFunctions",
  data: {
    action: "initCollections",
    data: { seed: false }
  }
}).then(console.log).catch(console.error)
```

6. 返回结果应包含 `success: true` 和 collections 列表。

### 备用流程 B：CloudBase 控制台手动创建集合

进入 CloudBase 控制台，选择环境：

`cloud1-d2g1lrdxc1bd1d890`

逐一创建本报告“已纳入 initCollections 清单”中的集合。

## 权限规则摘要

原则：所有敏感数据禁止前端直接写入，必须通过云函数写入。

### 禁止客户端直接写入

- `orders`
- `pricingQuotes`
- `pricingRules`
- `paymentIntents`
- `paymentCallbacks`
- `refundRequests`
- `settlements`
- `payoutRecords`
- `cleanerTrustProfile`
- `orderRiskProfile`
- `behaviorGraph`
- `behaviorGraphEdges`
- `protectionClaims`
- `serviceProofs`
- `auditLogs`
- `systemMetrics`
- `opsActions`

### pricingQuotes

- 客户端只允许读取自己的 quote。
- 客户端禁止写入。
- 创建、消费、过期处理必须由云函数完成。

### paymentIntents / paymentCallbacks / settlements / payoutRecords

- 仅云函数和管理员后台可访问。
- 普通用户不得直接读取回调、结算、payout 明细。

### trust / risk / behavior

- server write only。
- 普通客户端只允许读取脱敏后的公开信任状态，不读取原始评分原因和行为图。

### cleaner verification / insurance

- 证件、健康证、服务证、保单原件、保单号仅管理员或本人审核流程可见。
- 公开家洁师资料只显示 badge 和克制文案。

规则草案文件：

- `cloudbase/security-rules/database.rules.json`
- `cloudbase/security-rules/storage.rules.json`

注意：上述 JSON 是生产规则设计草案，不能直接保证等同于 CloudBase 控制台表达式，必须在控制台按实际规则语法配置并验证。

## 索引列表

请在 CloudBase 控制台创建以下索引。

### orders

- `customerOpenid + status`
- `acceptedCleanerOpenid + status`
- `assignedCleanerOpenid + status`
- 如控制台只能配置单个字段，至少建立：
  - `customerOpenid`
  - `acceptedCleanerOpenid`
  - `assignedCleanerOpenid`
  - `status`
  - `createdAt`
  - `updatedAt`

### pricingQuotes

- `quoteId`
- `userOpenid + status`
- `expiresAt`

### paymentIntents

- `intentId`
- `intentKey`
- `outTradeNo`
- `orderId`
- `status`

### settlements

- `orderId`
- `settlementId`
- `status`

### refundRequests

- `orderId`
- `refundRequestId`
- `status`

### trust / risk

- `cleanerTrustProfile.cleanerId`
- `orderRiskProfile.orderId`
- `behaviorGraphEdges.orderId`
- `behaviorGraphEdges.sourceId`
- `behaviorGraphEdges.targetId`

## 云存储安全规则

### admin only

- cleaner documents
- insurance
- certificates

### order participants + admin

- service proof images
- claim images

### public

- avatars
- public marketing/static assets

云存储规则草案：

- `cloudbase/security-rules/storage.rules.json`

## 验证任务状态

- [ ] `createPricingQuote` 不再报 collection not exists
- [ ] `orders` 正常写入
- [ ] `paymentIntents` 可写
- [ ] `settlements` 可写
- [ ] `refundRequests` 可写
- [ ] `cleanerTrustProfile` / `orderRiskProfile` / `behaviorGraph` 可创建记录
- [ ] storage 权限不泄露敏感文件

上述验证依赖远端集合创建和云函数部署成功。本次 CLI 未能完成部署，因此验证未执行。

## 当前阻塞

1. 微信开发者工具 CLI 部署失败。
   - 整包部署错误：`EISDIR`
   - 增量部署错误：`getCloudAPISignedHeader failed ret=41002 system error`
2. CLI 不支持数据库集合、索引、权限规则直接配置。
3. `miniprogram/envList.js` 当前为空，小程序端未显式锁定 `cloud1-d2g1lrdxc1bd1d890`。建议人工测试前确认是否需要写入环境 ID，避免误连默认环境。

## 风险点说明

- 生产数据库集合缺失会导致 `pricingQuotes collection not exists`、订单创建失败、支付/售后/风控写入失败。
- 如果权限规则未配置，普通客户端可能获得不必要的读写能力。
- 如果 `adminUsers` / `ADMIN_OPENIDS` 未配置，生产环境无法执行 `initCollections` 和后台管理动作。
- 如果云函数仍为旧版，v0.2.9 的 provider、退款、payout、准入集合初始化不会生效。
- 如果环境 ID 未显式配置，小程序可能连接到非预期 CloudBase 环境。

## 下一步人工操作

1. 在微信开发者工具中右键 `cloudfunctions/quickstartFunctions`，执行“上传并部署：云端安装依赖”。
2. 在云函数环境变量中配置：
   - `APP_ENV=production`
   - `ADMIN_OPENIDS=<你的管理员 openid>`，或先手动创建 `adminUsers` 记录。
3. 用管理员账号调用 `initCollections`，`seed:false`。
4. 在 CloudBase 控制台创建索引。
5. 按规则草案配置数据库和云存储权限。
6. 运行人工验证：
   - 住户下单触发 `createPricingQuote`
   - 创建订单
   - 触发支付意图
   - 管理员创建 refund request / settlement 测试记录
   - 检查敏感集合客户端不可写
