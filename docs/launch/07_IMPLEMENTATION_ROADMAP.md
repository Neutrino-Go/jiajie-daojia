# 实施路线图

## v0.2.1_order-protection-and-after-sales

目标：补齐每单保障、服务标准和售后入口。

范围：

- 新增 `serviceStandards`
- 新增 `protectionPlans`
- 创建订单写入 `protectionSnapshot`
- 创建订单写入 `serviceStandardSnapshot`
- 新增售后/投诉/返工/退款工单
- 订单详情展示保障卡
- 订单详情展示售后入口
- 家洁师端异常报备
- 客服入口不再是“暂未开放”

验收：

- 每个新订单都有保障快照。
- 用户能在订单详情发起售后工单。
- 家洁师能在订单详情提交异常报备。
- 不触发真实退款，仅创建工单。

## v0.2.2_pricing-engine-and-city-price-rules

目标：建立服务端统一报价和账务字段。

范围：

- 新增 `pricingRules`
- 新增 `pricingQuotes`
- 前端请求 quote 后下单
- 下单使用 `quoteId`
- 动态 `platformFeeRate`
- 记录 `platformSubsidy`
- 记录 `couponDiscount`
- `cleanerIncome` 不被优惠券压低
- 前后端 pricing 去重

验收：

- 上海价格高于哈尔滨。
- 开荒保洁按面积报价。
- 用户优惠不降低阿姨收入。
- 订单保存 `priceRuleVersion` 和 `quoteId`。

## v0.2.3_cleaner-verification-and-launch-hardening

目标：补齐阿姨准入和 production 风险开关。

范围：

- 新增 `cleanerVerifications`
- 扩展 `cleanerProfiles`
- 实名认证状态
- 手机认证状态
- 健康证状态
- 培训状态
- 服务证状态
- 保险状态
- cleaner-detail 展示可信状态
- production 禁用 seed/mock
- 隐私/协议/平台规则页面
- 假数据清理
- 云函数权限和并发审计

验收：

- 未通过平台审核的家洁师不能接单。
- 用户看到的审核状态不泄漏证件原件。
- production 下 seed/mock 被阻断。

## v0.2.4_payment-refund-settlement

目标：接入真实支付、退款、结算。

范围：

- 微信支付 provider
- mockProvider 仅 dev/test
- 支付回调幂等
- 退款流程
- 结算流程
- 售后中暂停结算
- 对账和 auditLogs

验收：

- production 禁止 mockPayOrder。
- 支付回调重复调用不会重复推进订单。
- 退款回调重复调用不会重复退款。
- 售后中订单不结算。

## 推荐执行顺序

1. v0.2.1
2. v0.2.2
3. v0.2.3
4. v0.2.4

原因：

- 保障和售后是交易前提。
- 账务字段需要在真实支付前固定。
- 阿姨准入和生产风险开关需要在扩大流量前完成。
- 真实支付最后接入，避免在规则不完整时引入资金风险。

