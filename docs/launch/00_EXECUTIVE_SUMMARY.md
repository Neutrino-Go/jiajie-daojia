# 家洁到家上线前执行摘要

版本：v0.2.1-r2

主题：prelaunch-security-privacy-production-gates-fix

日期：2026-06-02

## 结论

v0.2.1-r2 聚焦正式上线前的 P0 安全、隐私和生产开关修复，不进入 v0.2.2。

本轮修复方向：

1. 管理动作加 admin gate，production migration 加显式确认。
2. production 判断 fail-closed，环境变量缺失时按 production 处理。
3. mock 支付只允许显式 dev/test/local，production 直接拒绝。
4. customerProfile、cleanerProfile 和 orderDetail 使用白名单脱敏。
5. 普通读接口不再触发自动验收写操作。
6. 关键管理动作、状态变更、隐藏订单、家洁师可接单开关写入最小审计日志。
7. support ticket 最小闭环校验订单归属。
8. 小程序去除模拟支付入口和资金托管承诺文案。
9. 增加合规页面最小壳和入口。

## 仍是上线阻塞

1. 真实微信支付、退款和结算未接入。
2. CloudBase 数据库权限、云函数部署权限和 production 环境变量仍需人工复核。
3. 微信开发者工具真实编译和体验版验证仍需执行。
4. 完整售后、返工、退款工单流转尚未进入 v0.2.1-r2 范围。
5. 定价引擎、补贴预算和账务字段仍待 v0.2.3。

## 后续版本顺序

1. `v0.2.1-r2_prelaunch-security-privacy-production-gates-fix`
2. `v0.2.2_order-protection-and-after-sales`
3. `v0.2.3_pricing-engine-and-subsidy-accounting`
4. `v0.2.4_cleaner-verification-and-launch-hardening`
5. `v0.2.5_payment-refund-settlement`

## 受控试运营要求

- 未接入微信支付前，不展示“资金托管”“平台托管中”“支付到平台托管”等生产承诺。
- 订单处于 `waiting_payment` 时，页面应提示“支付能力待接入”或“试运营流程待平台确认”。
- 保障范围以实际保险合同和平台规则为准。
- 保险能力待接入时，只能写“保险能力待接入/以实际订单保障页为准”。
