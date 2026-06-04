# 保障方案研究与设计

## 当前项目现状

当前订单链路已支持：

- 住户发布公开或指派订单。
- 家洁师响应公开订单或接受指派订单。
- 用户选择家洁师后进入待支付。
- 通过 `mockPayOrder` 模拟支付后进入待服务。
- 家洁师开始服务、提交完成。
- 住户验收并评价。
- 超时自动验收。
- 家洁师完成照片字段和评价图片字段已有部分实现基础。

当前保障能力主要停留在业务状态和 UI 提示层，没有形成“每单保障计划、服务标准快照、售后工单、退款/返工/赔付处理、保险状态”的闭环。

## 缺口

### 每单保障缺口

- 没有 `protectionPlanId` 或 `protectionSnapshot`。
- 没有服务标准快照，订单创建后无法证明用户购买的是哪一套服务标准。
- 没有售后期字段，自动验收后仍缺少明确售后窗口。
- 没有返工、部分退款、财物损坏、爽约补偿等工单集合。
- 没有真实资金托管和退款能力，不能正式承诺“平台托管中”。
- 完成服务照片已初步支持，但没有纳入保障规则和验收证据链。

### 阿姨保障缺口

- 当前准入字段主要为 `manualApproved`、`available`、`phoneVerified`。
- 缺少实名认证、健康证明、培训、背景核查、服务证、保险状态。
- 缺少用户临时取消导致的误工补偿规则。
- 缺少用户追加工作量时的加价确认机制。
- 缺少异常环境和危险环境报备入口。
- 当前优惠券/补贴模型尚未确保阿姨收入不被用户优惠压低。

### 用户保障缺口

- 用户无法看到可信的阿姨审核状态分层。
- 服务标准、不包含范围、售后规则没有独立页面。
- 客服、投诉、反馈入口仍存在“暂未开放”风险。
- 缺少返工、退款、理赔和评价申诉入口。
- 联系电话和地址虽有订单状态隐藏规则，但缺少完整隐私规则页。

### 保险原则缺口

项目不得在没有真实保单的情况下展示“已投保”。

保险展示必须以以下字段为依据：

- `insuranceStatus`
- `policyNo`
- `insuredUntil`
- `insuranceProvider`
- `coverageSummary`
- `insuranceSnapshot`

UI 文案必须包含：

> 保障范围以实际保险合同和平台规则为准。

禁止文案：

- 百万保障
- 全额赔付
- 已投保，放心下单
- 平台全赔

除非真实保单、平台规则和履约能力都已经建立。

## 推荐规则

### 每单保障

每个订单创建时固化：

- `protectionPlanId`
- `protectionSnapshot`
- `serviceStandardSnapshot`
- `cancelPolicySnapshot`
- `afterSalesWindowHours`
- `autoAcceptanceAfterSalesWindowHours`
- `protectionFee`
- `insuranceStatus`
- `insuranceProvider`
- `insuranceSnapshot`

规则建议：

1. 未服务全退：服务开始前，若家洁师未上门且无用户违约，支持全额退款。
2. 爽约包赔：家洁师超时未到或取消，进入 `compensation` 工单，赔付可先用平台券或余额，不直接承诺现金。
3. 不满意返工：验收后 24 小时内可发起返工申请；返工优先于退款。
4. 部分退款：按客服判责、证据照片、服务时长、未完成项目计算。
5. 财物损坏：用户提交照片、描述和金额，平台客服审核，必要时进入保险理赔。
6. 自动验收：自动验收后仍保留售后期，例如 24 小时。
7. 服务完成照片：家洁师提交完成时可上传，作为验收证据，不替代用户评价图片。

### 阿姨保障

1. 订单取消补偿：用户在服务开始前较短时间取消，可根据时间窗口生成 `compensation`。
2. 追加工作量：家洁师提交追加项，用户确认后生成补价记录；未确认不得强制收费。
3. 危险环境报备：出现高空作业、重污、宠物攻击、违法物品等情况时，家洁师可暂停并报备。
4. 收入保护：`cleanerIncome` 必须基于服务标准价或平台补贴后计算，不被 `couponDiscount` 直接压低。
5. 申诉机制：用户差评或退款后，家洁师应能提交申诉证据。

### 用户保障

1. 家洁师资料页展示审核状态，但不展示证件原件。
2. 订单详情展示服务标准、不包含范围、保障规则入口。
3. 订单详情在 `waiting_complete`、`completed`、`auto_completed` 展示服务完成照片。
4. 售后入口覆盖返工、退款、投诉、财物损坏。
5. 客服入口必须真实可用，至少支持工单提交。

## 数据字段

### orders

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
- `afterSalesWindowEndsAt`
- `autoAcceptanceAfterSalesEndsAt`
- `refundStatus`
- `refundAmount`
- `compensationAmount`
- `compensationType`
- `cancelPolicySnapshot`
- `serviceStandardSnapshot`

### protectionClaims

- `orderId`
- `claimType`
- `createdByOpenid`
- `role`
- `description`
- `photoUrls`
- `status`
- `requestedAmount`
- `approvedAmount`
- `handlerOpenid`
- `resolution`
- `createdAt`
- `updatedAt`

### compensations

- `orderId`
- `payerType`
- `receiverType`
- `reason`
- `amount`
- `status`
- `settledAt`

## 云函数改造点

- `createOrder`：写入保障快照、服务标准快照、取消规则快照。
- `updateOrderStatus`：在开始服务、提交完成、验收、取消时写入保障相关时间点。
- `autoAcceptOverdueOrdersInternal`：自动验收时写入售后期结束时间，不生成手动评价。
- 新增 `createProtectionClaim`、`listProtectionClaims`、`updateProtectionClaimStatus`。
- 新增 `reportCleanerException`。
- 新增 `requestRework`、`requestRefund`、`requestCompensation`。
- 支付结算完成前需检查 `disputeStatus`，售后中暂停结算。

## 页面改造点

- 订单创建页：展示服务标准、保障规则、取消规则。
- 订单详情页：展示保障卡、服务标准快照、售后入口、服务完成照片。
- 家洁师详情页：展示审核状态和保险状态摘要，不展示证件原件。
- 家洁师订单详情页：增加异常报备和追加工作量入口。
- 我的页：客服和投诉入口真实可用。
- 新增平台规则、服务保障、退款取消规则页面。

## 状态机影响

建议新增独立的保障/售后状态，不要把所有售后状态塞进订单主状态：

- `guaranteeStatus`: `none | active | claim_open | claim_resolved`
- `disputeStatus`: `none | rework_requested | refund_requested | damage_claimed | under_review | resolved`
- `refundStatus`: `none | requested | approved | rejected | processing | refunded`
- `settlementHoldReason`: `none | after_sales | refund | damage_claim | manual_review`

订单主状态仍保持简洁：待响应、待确认、待支付、待服务、服务中、待验收、已完成、系统已完成、已取消。

## 风险和灰度上线方式

灰度建议：

1. 第一期只对受控城市和少量家洁师启用保障快照。
2. 售后工单先人工处理，不自动退款。
3. 保险字段先只展示“未接入/待确认/已接入”，不展示营销化承诺。
4. 赔付先使用平台优惠券或人工退款，不做自动现金赔付。
5. 自动验收订单进入售后期，不立即释放争议冻结金额。

