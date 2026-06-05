# 上线前技术与产品审计

## 审计范围

本次检查范围：

- `cloudfunctions/quickstartFunctions/index.js`
- `cloudfunctions/quickstartFunctions/lib/domain.js`
- `cloudfunctions/quickstartFunctions/lib/pricing.js`
- `miniprogram/config/pricing.js`
- `miniprogram/pages/order-create/index.js`
- `miniprogram/pages/order-detail/index.js`
- `miniprogram/pages/order-list/index.js`
- `miniprogram/pages/profile/index.js`
- `miniprogram/pages/cleaner-detail/index.wxml`
- `miniprogram/app.json`
- `docs/order-system-audit.md`

## P0 必须上线前解决

### P0-r2-001 管理动作不能被普通用户触发

- `initCollections`、`migrateOrderPaymentStatus`、`migrateOrderNos`、`autoAcceptOverdueOrders` 必须 `requireAdmin`。
- production 下 migration 必须显式 confirm。
- production seed/mock 必须有硬开关，环境变量缺失时按 production 处理。

### P0-r2-002 普通读接口不能触发自动验收写操作

- `listMyOrders`、`getOrderDetail`、`getIncomeStats` 不能调用 `autoAcceptOverdueOrdersInternal`。
- 自动验收只允许 admin action、未来云定时或明确 internal/system 调用。
- 实际自动完成订单必须写 audit log。

### P0-r2-003 客户资料和订单详情必须按视角脱敏

- 普通用户不能通过 `data.openid` 或 `data.customerOpenid` 查询他人 customerProfile。
- 未选中家洁师不能看到客户手机号、微信号、详细地址、精确坐标或 `_openid`。
- 已确认接单家洁师只能看到履约必要联系方式，不应看到内部字段或未来证件字段。

### P0-r2-004 家洁师公开资料必须使用白名单

- `publicCleaner` 不能直接 spread 原始 cleaner。
- `listCleaners`、`getCleanerDetail`、`listSavedCleaners`、`getOrderDetail` 不得泄露 phone、wechatContact、lastLocation、证件 fileID、保单号或内部风险字段。
- malformed cleaner 数据也不得原样返回。

### P0-r2-005 support ticket 和合规页面是最小上线入口

- `createSupportTicket` 带 orderId 时必须校验订单归属。
- Profile、订单详情、下单页必须能进入客服/反馈或合规页面。
- 小程序页面不得显示“暂未开放”类 production 文案。

### P0-001 production 不能继续使用 mockPayOrder

现状：

- `cloudfunctions/quickstartFunctions/index.js` 暴露 `mockPayOrder`。
- `order-detail` 和 `order-list` 的支付按钮直接调用 `mockPayOrder`。
- 支付后订单进入 `confirmed` 和 `paymentStatus = escrowed`。

风险：

- 用户看到“平台托管中”，但实际没有真实资金托管。
- 无支付回调、无退款、无对账、无幂等。

要求：

- production 禁用 `mockPayOrder`。
- 如果不接真实微信支付，产品必须标记试运营/线下支付。

### P0-002 无退款和结算冻结闭环

现状：

- `completed` 和 `auto_completed` 会直接写 `paymentStatus = settled`。
- 取消订单可根据 paidAt 兼容 `refunded`，但没有真实退款请求和退款状态机。
- 没有售后中暂停结算。

风险：

- 用户售后、理赔、退款与家洁师结算可能冲突。

要求：

- 新增退款请求、售后状态、结算冻结原因。
- 完成支付回调、退款回调和结算幂等。

### P0-003 客服、售后、投诉入口未闭环

现状：

- 我的页仍有 `客服入口暂未开放`、`感谢反馈，入口暂未开放`。
- 订单详情没有完整售后/返工/退款/财物损坏入口。

风险：

- 服务失败后用户无平台处理入口。
- 家洁师异常环境无法及时报备。

要求：

- 至少上线工单集合和客服处理台前的用户提交能力。

### P0-004 保障和保险文案必须受真实字段约束

现状：

- 项目没有完整 `insuranceStatus`、保单号、保险公司、有效期字段。

风险：

- 若 UI 宣称已投保或高额保障，会形成合规与履约风险。

要求：

- 无真实保单时只能显示“平台保障规则”或“保险未接入/待确认”。

### P0-005 云函数权限和价格防篡改需专项审计

现状：

- `createOrder` 已在云端重新算价，这是正确方向。
- 但支付、退款、售后、补偿、结算尚未形成统一权限校验与审计日志。

风险：

- 资金类操作缺少管理员权限、幂等键和审计日志。

要求：

- v0.2.4 前完成支付/退款/结算权限审计和 `auditLogs`。

## P1 上线初期解决

### P1-001 阿姨准入信息不足

现状：

- 家洁师资料主要依赖 `manualApproved`、`available`、`phoneVerified`。
- 缺少实名、健康证、背景核查、培训、服务证、保险状态。

建议：

- v0.2.3 建立 `cleanerVerifications` 和 `cleanerProfiles` 扩展字段。

### P1-002 定价账务字段不足

现状：

- 当前有 `orderAmount`、`platformFee`、`cleanerIncome`、`pricingSnapshot`。
- 平台抽成固定 5%。
- 缺少 `couponDiscount`、`platformSubsidy`、`protectionFee`、`insuranceCostAllocation`、`grossMargin`。

建议：

- v0.2.2 建立报价 quote 和动态费率。

### P1-003 自动验收后售后期缺失

现状：

- 自动验收会进入 `auto_completed` 和 `settled`。
- 不生成手动评价，这是正确的。
- 但缺少自动验收后的售后期。

建议：

- 自动验收写入 `autoAcceptanceAfterSalesEndsAt`，售后中暂停结算或保留追溯机制。

### P1-004 多阿姨响应和指派流程并发风险

现状：

- 公开单通过 `responses` 数组保存响应。
- 用户选择后写 `acceptedCleanerOpenid`。
- 指派单接受后进入待支付。

风险：

- 多端重复点击、并发选择、重复支付需要幂等处理。

建议：

- 为 `selectOrderResponse`、`mockPayOrder`/真实支付、`updateOrderStatus` 加幂等键和乐观状态校验。

### P1-005 假数据和 seed 生产隔离不足

现状：

- 云函数中存在 seed cleaner 初始化路径。
- profile 中仍有暂未开放入口。

建议：

- 增加 `APP_ENV` 和 production 禁用 seed/mock 开关。

## P2 后续优化

- 建立管理后台或运营配置集合。
- 家洁师信用评分、申诉、异常环境标签。
- 优惠券体系、会员体系和老客周期保洁。
- 风险订单识别：异地、超低价、用户频繁取消、家洁师高投诉。
- 更细服务标准：厨房重油、玻璃、收纳、宠物毛发、外窗高空。

