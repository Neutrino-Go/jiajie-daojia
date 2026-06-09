# 实施路线图

## v0.2.1-r2_prelaunch-security-privacy-production-gates-fix

目标：修复正式上线前 P0 安全、隐私、生产开关和审查包问题。

范围：

- 云函数 admin gate、production fail-closed、seed/mock/migration/autoAccept 硬开关。
- customerProfile、cleanerProfile、orderDetail、openOrders 的最小脱敏。
- `auditLogs` 最小实现，覆盖关键状态变更、自动验收、迁移、隐藏订单和可接单开关。
- support ticket 最小闭环，校验 orderId 归属。
- 合规页面最小壳和 profile/order-create/order-detail 入口。
- 前端移除模拟支付入口和托管类承诺文案。
- 恢复通用 review package 工具链。

验收：

- production 或环境变量缺失时 `mockPayOrder` 拒绝。
- 普通用户不能调用 `initCollections`、migrations、`autoAcceptOverdueOrders`。
- 普通读接口不会触发自动验收写操作。
- 未选中家洁师不能看到客户手机号、微信号、详细地址、`_openid`。
- 公开家洁师资料不返回电话、微信、坐标、证件 fileID、保单号和内部风险字段。
- 小程序端不存在 mock 支付调用、托管承诺、未开放入口文案。

## v0.2.2_order-protection-and-after-sales

目标：补齐服务标准、争议处理、售后和退款工单规则。

范围：

- 新增 `serviceStandards`、`protectionPlans`。
- 创建订单写入 `protectionSnapshot`、`serviceStandardSnapshot`。
- 新增售后/投诉/返工/退款工单类型和处理流转。
- 订单详情展示服务标准和售后入口。
- 家洁师端异常报备。
- 自动验收后设置售后期。

验收：

- 每个新订单都有服务标准快照。
- 用户能从订单详情提交售后工单。
- 家洁师能在订单详情提交异常报备。
- 不触发真实退款，仅创建工单和审计记录。

## v0.2.3_pricing-engine-and-subsidy-accounting

目标：建立服务端报价、补贴预算和财务字段。

范围：

- 新增 `pricingRules`、`pricingQuotes`。
- 前端请求 quote 后下单，下单使用 `quoteId`。
- 动态 `platformFeeRate`。
- 记录 `couponDiscount`、`platformFundedDiscount`、`platformSubsidyBudget`、`cashGrossMargin`、`cashBurn`。
- `cleanerIncome` 不被优惠券或拉新补贴压低。
- 前后端 pricing 去重。

验收：

- 上海价格高于哈尔滨。
- 开荒保洁按面积和难度报价。
- 用户优惠不降低家洁师收入。
- 订单保存 `priceRuleVersion`、`quoteId` 和补贴快照。

## v0.2.4_cleaner-verification-and-launch-hardening

目标：补齐家洁师准入和生产部署加固。

范围：

- 新增 `cleanerVerifications`。
- 扩展 `cleanerProfiles`。
- 实名、手机、健康证、培训、服务证状态。
- cleaner-detail 仅展示可信状态，不展示证件原件。
- CloudBase 数据库规则、云函数部署权限、环境变量复核。
- 假数据清理和 production launch checklist。

验收：

- 未通过平台审核的家洁师不能接单。
- 普通用户接口无证件 fileID 原文。
- CloudBase 权限和 production 环境变量有人工复核记录。

## v0.2.5_payment-refund-settlement

目标：接入真实微信支付、退款和结算。

范围：

- 微信支付 provider。
- mock provider 仅限 dev/test。
- 支付回调幂等。
- 退款申请、审批和回调。
- 结算流程和对账。
- 售后中暂停结算。

验收：

- production 禁止 mockPayOrder。
- 支付回调重复调用不会重复推进订单。
- 退款回调重复调用不会重复退款。
- 售后中订单不结算。

## 推荐执行顺序

1. v0.2.1-r2
2. v0.2.2
3. v0.2.3
4. v0.2.4
5. v0.2.5

原因：

- 先修安全、隐私、production gate，避免上线前 P0 泄露或越权。
- 再补服务保障和售后，避免服务失败后无处理入口。
- 再统一报价和补贴财务字段，避免真实支付后反复迁移账务模型。
- 再补家洁师准入和部署权限，保证试运营流量可控。
- 最后接入真实支付、退款和结算，避免资金风险先于规则上线。

## v0.2.2 implementation update

目标：建立订单保障、服务标准、售后工单、返工/退款申请、财损/异常报备和服务完成证明的最小闭环。

本次范围：

- 新增 `serviceStandards`、`protectionPlans`、`protectionClaims` 最小数据模型。
- 新订单写入 `protectionSnapshot` 和 `serviceStandardSnapshot`，配置缺失时使用安全默认快照。
- 新增 `getServiceStandards`、`getProtectionPlans`、`createProtectionClaim`、`listMyProtectionClaims`、`getProtectionClaimDetail`、`updateProtectionClaimStatus`、`submitServiceProof`、`reportCleanerException`。
- 新增保障规则、服务标准、售后创建、售后列表、售后详情页面。
- Profile 和订单详情增加售后与异常报备入口。
- 订单卡片仅展示简短售后状态，避免改变订单主状态机。

明确不做：

- 不接入真实微信支付。
- 不执行真实退款、赔付、打款或保险理赔。
- 不大改订单主状态机。
- 不大改定价引擎。
- 不恢复 mockPayOrder 前端入口。
- 不使用“百万保障”“全额赔付”“已投保”等未经验证文案。

仍需上线前完成：

- 微信开发者工具真实编译和人工测试，本轮仍记录为待执行。
- CloudBase 生产数据库规则、云函数部署权限和环境变量复核。
- 真实微信支付、退款、结算接入。
- 完整后台客服/理赔处理台。

## v0.2.3 implementation update

目标：建立服务端统一报价、报价快照、城市/服务/时长/面积规则，以及平台补贴和阿姨收入保护的最小闭环。

本次范围：

- 新增服务端 `pricingRules` 默认规则和 `pricingQuotes` 报价生命周期。
- 新增 `getPricingRules`、`createPricingQuote`、`getPricingQuote`。
- `createOrder` 使用 quoteId 校验报价归属、过期、使用状态和订单信息一致性。
- 无 quoteId 的旧入口由服务端生成 fallback quote，并写入 `pricingSnapshot.generatedBy=createOrder_fallback`。
- 下单页改为调用 `createPricingQuote`，提交时传 `quoteId`，本地 pricing config 仅为 UI fallback。
- 开荒保洁按面积报价，记录 actual/billable area。
- coupon/活动价不降低 `cleanerIncome`，现金亏损记录为 `cashBurn/platformSubsidy`。

明确不做：

- 不接入真实微信支付。
- 不执行真实退款、结算或补贴打款。
- 不做完整优惠券中心或后台价格管理系统。
- 不大改订单主状态机。
- 不恢复 mockPayOrder 前端入口或托管类文案。

仍需上线前完成：

- 微信开发者工具真实编译和人工测试。
- CloudBase 生产数据库规则、云函数权限和部署权限复核。
- 真实支付、退款、结算和财务 reconciliation。
- 完整后台价格管理、优惠券发放和财务对账。
