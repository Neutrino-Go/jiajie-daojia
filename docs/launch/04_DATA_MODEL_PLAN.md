# 数据模型和迁移计划

## 原则

本阶段只设计模型，不强行迁移线上数据。

模型目标：

- 每单保障可追溯。
- 每单价格可追溯。
- 售后、退款、补偿、保险、结算可审计。
- 阿姨准入信息和用户可见信息分层。
- 历史订单可兼容。

## 新增或扩展集合

### serviceStandards

字段：

- `_id`
- `serviceType`
- `version`
- `title`
- `includedItems`
- `excludedItems`
- `requiredTools`
- `durationRules`
- `areaRules`
- `photoRequirements`
- `enabled`
- `createdAt`
- `updatedAt`

### protectionPlans

字段：

- `_id`
- `version`
- `name`
- `serviceTypes`
- `rules`
- `afterSalesWindowHours`
- `autoAcceptanceAfterSalesWindowHours`
- `damageClaimEnabled`
- `reworkEnabled`
- `refundEnabled`
- `enabled`

### protectionClaims

字段：

- `_id`
- `orderId`
- `claimType`
- `createdByOpenid`
- `createdByRole`
- `description`
- `photoUrls`
- `requestedAmount`
- `approvedAmount`
- `status`
- `handlerOpenid`
- `resolution`
- `createdAt`
- `updatedAt`

### insurancePolicies

字段：

- `_id`
- `provider`
- `policyNo`
- `coverageSummary`
- `effectiveAt`
- `insuredUntil`
- `status`
- `documentFileIDs`
- `createdAt`
- `updatedAt`

### insuranceEnrollments

字段：

- `_id`
- `policyId`
- `cleanerOpenid`
- `orderId`
- `status`
- `insuredAt`
- `expiresAt`
- `snapshot`

### cleanerVerifications

字段：

- `_id`
- `cleanerOpenid`
- `realNameVerified`
- `idVerificationStatus`
- `healthCertStatus`
- `healthCertFileIDs`
- `backgroundCheckStatus`
- `trainingStatus`
- `serviceCertificateStatus`
- `insuranceStatus`
- `insurancePolicyNo`
- `insuredUntil`
- `platformApprovedAt`
- `riskLevel`
- `reviewerOpenid`
- `createdAt`
- `updatedAt`

### pricingRules

字段：

- `_id`
- `version`
- `city`
- `cityTier`
- `serviceType`
- `durationHours`
- `areaMin`
- `areaMax`
- `listPrice`
- `launchPrice`
- `platformFeeRate`
- `minCleanerHourlyIncome`
- `protectionFee`
- `insuranceCostAllocation`
- `enabled`

### pricingQuotes

字段：

- `_id`
- `quoteId`
- `customerOpenid`
- `city`
- `serviceType`
- `durationHours`
- `areaSize`
- `listPrice`
- `launchPrice`
- `couponDiscount`
- `platformSubsidy`
- `customerPayAmount`
- `cleanerIncome`
- `platformFee`
- `grossMargin`
- `priceRuleVersion`
- `expiresAt`
- `createdAt`

### coupons

字段：

- `_id`
- `couponId`
- `type`
- `amount`
- `minSpend`
- `serviceTypes`
- `cityScope`
- `fundedBy`
- `enabled`
- `validFrom`
- `validTo`

### compensations

字段：

- `_id`
- `orderId`
- `receiverOpenid`
- `receiverRole`
- `type`
- `amount`
- `reason`
- `status`
- `settledAt`

### refundRequests

字段：

- `_id`
- `orderId`
- `requesterOpenid`
- `reason`
- `requestedAmount`
- `approvedAmount`
- `status`
- `paymentTransactionId`
- `refundTransactionId`
- `handlerOpenid`
- `createdAt`
- `updatedAt`

### auditLogs

字段：

- `_id`
- `actorOpenid`
- `actorRole`
- `action`
- `targetType`
- `targetId`
- `before`
- `after`
- `requestId`
- `createdAt`

### adminUsers

字段：

- `_id`
- `openid`
- `roles`
- `permissions`
- `status`
- `createdAt`
- `updatedAt`

### platformRules

字段：

- `_id`
- `ruleType`
- `version`
- `title`
- `content`
- `enabled`
- `publishedAt`
- `createdAt`
- `updatedAt`

## 扩展 orders 字段

- `protectionPlanId`
- `protectionSnapshot`
- `protectionFee`
- `insuranceStatus`
- `insuranceProvider`
- `workerInsurancePolicyNo`
- `guaranteeStatus`
- `disputeStatus`
- `serviceProof`
- `beforePhotoUrls`
- `completionPhotoUrls`
- `customerAcceptanceAt`
- `refundStatus`
- `refundAmount`
- `compensationAmount`
- `compensationType`
- `cancelPolicySnapshot`
- `serviceStandardSnapshot`
- `quoteId`
- `priceRuleVersion`

## 扩展 cleanerProfiles / cleaners 字段

- `realNameVerified`
- `idVerificationStatus`
- `healthCertStatus`
- `healthCertFileIDs`
- `backgroundCheckStatus`
- `trainingStatus`
- `serviceCertificateStatus`
- `insuranceStatus`
- `insurancePolicyNo`
- `insuredUntil`
- `platformApprovedAt`
- `riskLevel`

## 迁移计划

### Phase 1：只读兼容

- 新字段缺失时使用 fallback，不改变旧订单。
- 新文档和 UI 读取时显示“未接入/待完善”。

### Phase 2：新订单写入

- 新订单创建时写入 `pricingSnapshot`、`protectionSnapshot`、`serviceStandardSnapshot`。
- 老订单不回填，除非需要展示。

### Phase 3：历史数据批处理

- 为历史订单补 `priceRuleVersion = legacy`。
- 为历史订单补 `guaranteeStatus = none`。
- 为历史家洁师补 `riskLevel = unknown`。

### Phase 4：强校验

- production 对缺失 quote、缺失服务标准、缺失保障快照的新订单拒绝创建。

