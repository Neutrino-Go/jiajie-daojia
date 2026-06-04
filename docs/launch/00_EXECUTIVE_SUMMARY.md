# 家洁到家上线前执行摘要

版本：v0.2.0

主题：prelaunch-research-audit-and-design

日期：2026-06-01

## 结论

当前项目已经具备 MVP 订单主链路：住户发布需求、家洁师响应或接受指派、住户选择家洁师、模拟支付、服务开始、提交完成、验收评价、自动验收、收入统计和评价统计。

但按正式上线标准，仍存在明显 P0 风险：

1. 支付仍依赖 `mockPayOrder`，没有真实微信支付 provider、支付回调幂等、退款和结算冻结机制。
2. “资金托管”“已支付”“已结算”等交易文案已有雏形，但缺少真实资金链路支持；production 不应继续展示真实托管含义。
3. 用户售后、返工、退款、投诉、财物损坏上报、客服工单尚未闭环。
4. 阿姨准入只覆盖 `manualApproved`、`available`、`phoneVerified` 等基础字段，缺少实名认证、健康证、培训、服务证、保险等上线可信状态。
5. 保险和保障不能在没有真实保单字段与平台规则时宣称“已投保”“百万保障”“全额赔付”。
6. 当前定价仍以固定 5% 抽成和城市薪资系数为主，缺少报价版本、优惠券补贴、保障费、保险成本、毛利和阿姨收入保护的完整账务模型。

## 推荐上线策略

不建议直接正式上线完整交易闭环。

推荐先进入“受控试运营”：

- 若未接入微信支付：产品文案必须标注“试运营/线下支付”，不能写资金托管。
- 若接入微信支付：必须先完成 v0.2.4 的支付、退款、结算、回调幂等和对账。
- 阿姨端必须完成基础准入与人工审核，至少补齐实名、手机、健康证、培训和平台审核状态。
- 每单必须有服务标准、保障快照、售后入口、服务完成照片和自动验收后的售后期。

## 后续版本顺序

建议顺序：

1. `v0.2.1_order-protection-and-after-sales`
2. `v0.2.2_pricing-engine-and-city-price-rules`
3. `v0.2.3_cleaner-verification-and-launch-hardening`
4. `v0.2.4_payment-refund-settlement`

原因：

- 先补保障和售后，避免“服务失败后无处理入口”。
- 再统一报价和账务字段，避免后续支付结算反复迁移。
- 再补阿姨准入和 production hardening，保证可控试运营。
- 最后接入真实支付退款结算，避免资金风险先于规则上线。

## 本阶段产出

本阶段只新增研究、审计、方案文档和价格调研表，不修改小程序业务逻辑、UI、云函数或订单状态机。

输出文件：

- `docs/launch/01_PROTECTION_DESIGN.md`
- `docs/launch/02_PRICING_RESEARCH_AND_POLICY.md`
- `docs/launch/03_PRELAUNCH_AUDIT.md`
- `docs/launch/04_DATA_MODEL_PLAN.md`
- `docs/launch/05_PAYMENT_REFUND_SETTLEMENT_PLAN.md`
- `docs/launch/06_COMPLIANCE_AND_PRIVACY_PLAN.md`
- `docs/launch/07_IMPLEMENTATION_ROADMAP.md`
- `docs/launch/08_RISK_REGISTER.md`
- `docs/launch/price-research/competitive_pricing_matrix.csv`
- `docs/launch/price-research/sources.md`
- `docs/launch/price-research/pricing_research_notes.md`

