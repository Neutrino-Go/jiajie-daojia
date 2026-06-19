# CloudBase 初始化补充报告 v0.2.9-r2

生成时间：2026-06-18

目标环境：`cloud1-d2g1lrdxc1bd1d890`

分支：`feature/v0.2.9-r2-verification-gate-fix`

## 本轮新增/确认集合

### 家洁师准入

- `cleanerVerifications`
- `cleanerVerificationQueue`
- `cleanerTrustProfile`
- `insurancePolicies`
- `insuranceEnrollments`

### 订单、报价、支付、退款、结算

- `orders`
- `pricingRules`
- `pricingQuotes`
- `paymentIntents`
- `paymentCallbacks`
- `refundRequests`
- `settlements`
- `payoutRecords`

## 权限规则摘要

- `cleanerVerifications`：仅本人或 admin 可读，禁止 client 直接写入。
- `cleanerVerificationQueue`：仅本人或 admin 可读，禁止 client 直接写入。
- `pricingRules` / `pricingQuotes`：禁止 client 写入，报价创建和消费必须走云函数。
- `paymentIntents` / `paymentCallbacks` / `refundRequests` / `settlements` / `payoutRecords`：禁止 client 写入。
- `cleanerTrustProfile` / `orderRiskProfile` / `behaviorGraph`：server write only，普通端只允许通过云函数读取脱敏结果。
- `insurancePolicies` / `insuranceEnrollments`：admin/cloud function only。

## 索引建议

- `orders`: `customerOpenid + status`
- `orders`: `acceptedCleanerOpenid + status`
- `orders`: `assignedCleanerOpenid + status`
- `pricingQuotes`: `quoteId`
- `pricingQuotes`: `userOpenid + status`
- `paymentIntents`: `outTradeNo`
- `settlements`: `orderId`
- `refundRequests`: `orderId`
- `cleanerVerifications`: `cleanerId + status`
- `cleanerVerificationQueue`: `verificationId`
- `cleanerVerificationQueue`: `status + updatedAt`

## 本轮自动化验证项

- 空资料不能进入审核队列。
- 缺身份证号不能进入审核队列。
- 完整资料通过系统校验后进入 `cleanerVerificationQueue`。
- 管理员 approve 后同步更新 queue 状态。
- 公开家洁师展示名使用脱敏实名/昵称/fallback，不直接以 openid 作为主展示名。

## 未完成项

- CloudBase 控制台中的真实权限规则仍需人工复核。
- 微信开发者工具真机预览仍需人工执行。
- 真实微信支付、退款、结算仍未接入。
- 真实证件/健康凭证上传和存储权限仍需按生产环境复核。

## 风险点

- 本版本仅做规则型资料完整性和格式校验，不替代真实人工审核。
- 身份证号仅用于云函数校验和内部审核，不应在公开接口、公开页面或日志中展示原文。
- `cleanerVerificationQueue` 是审核队列，不应允许前端直接写入或伪造状态。
