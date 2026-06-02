# 风险登记表

| 风险编号 | 风险描述 | 影响页面/云函数 | 严重级别 | 发生概率 | 解决方案 | 是否上线阻塞 | Owner | 验收方式 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | 普通用户可调用 `initCollections`、migrations、`autoAcceptOverdueOrders` | quickstartFunctions | P0 | 高 | 所有管理动作必须 `requireAdmin`，production migration 要 explicit confirm | 是 | 技术 | 普通用户调用返回 `FORBIDDEN` |
| R-002 | production seed/mock 缺少硬开关，环境变量缺失时 fail-open | quickstartFunctions | P0 | 高 | `isProduction()` fail-closed，只有显式 dev/test/local 才允许 mock/seed | 是 | 技术 | APP_ENV 缺失时 `mockPayOrder` 返回拒绝 |
| R-003 | `customerProfile` 可能被非本人查询 | getCustomerProfile | P0 | 高 | 普通用户只能读自己；查询他人必须 admin | 是 | 技术/隐私 | 普通用户查询他人返回 `FORBIDDEN` |
| R-004 | `getOrderDetail` 可能通过 customerProfile 泄露联系方式 | getOrderDetail | P0 | 高 | customerProfile 按 owner/fulfillment/public 三类白名单返回 | 是 | 技术/隐私 | 未选中家洁师看不到手机号、微信、详细地址、`_openid` |
| R-005 | `publicCleaner` 直接 spread 导致家洁师电话、微信、位置、证件 fileID、保单号泄露 | listCleaners, getCleanerDetail, orderDetail | P0 | 高 | `publicCleanerProfile` 白名单；履约联系方式也只返回必要字段 | 是 | 技术/隐私 | 公开接口无 phone、wechat、lastLocation、fileID、policyNo、riskLevel |
| R-006 | 普通读接口间接触发自动验收，导致订单状态和结算字段变化 | listMyOrders, getOrderDetail, getIncomeStats | P0 | 高 | 从读接口移除 `autoAcceptOverdueOrdersInternal`；仅 admin/system 触发 | 是 | 技术 | 普通读接口不修改 waiting_complete 订单 |
| R-007 | 缺少 `auditLogs`，关键状态和管理动作不可追踪 | quickstartFunctions | P0 | 中 | 最小 audit log，敏感字段脱敏摘要 | 是 | 技术 | updateOrderStatus/hide/updateAvailability 等写日志且无敏感原文 |
| R-008 | 支付链路未接入真实能力但前端展示支付/托管承诺 | order-detail, order-list, format/constants | P0 | 高 | 前端不展示支付按钮，不调用 mock，文案改为支付能力待接入/待平台确认 | 是 | 产品/技术 | 小程序静态扫描无托管类误导文案和 `mockPayOrder` |
| R-009 | support ticket 可用他人 orderId 提交，造成订单枚举或敏感信息联想 | createSupportTicket | P0 | 中 | 带 orderId 时校验订单参与人或 admin；仅 orderNo 不读取订单 | 是 | 技术/隐私 | 非订单参与人提交返回 `FORBIDDEN` |
| R-010 | 缺少合规页面和入口 | app.json, profile, order-create | P0 | 高 | 注册协议、隐私、交易规则、保障、退款取消、删除注销页面 | 是 | 产品/法务 | app.json 页面路径合法，profile/下单页可进入 |
| R-011 | 保险和保障文案在无真实字段时过度承诺 | legal, cleaner/order pages | P0 | 中 | 禁止“已投保”“百万保障”“全额赔付”；统一写实际合同和平台规则为准 | 是 | 产品/法务 | 静态扫描无禁用词 |
| R-012 | CloudBase 数据库规则和部署权限未复核 | CloudBase config/rules | P0 | 中 | 上线前人工复核 database rules、云函数触发器、环境变量和部署权限 | 是 | 技术/运维 | 留存复核记录 |
| R-013 | 优惠券或拉新价压低家洁师收入 | order-create, pricing | P1 | 中 | 引入 `platformFundedDiscount`、`platformSubsidyBudget`、`cashBurn` | 否 | 产品/财务 | 使用优惠后 cleanerIncome 不下降 |
| R-014 | 开荒保洁按小时导致亏损或服务争议 | order-create, pricing | P1 | 中 | 开荒按面积和难度加价 | 否 | 产品 | 60 平方米起步，特殊项需确认 |
| R-015 | 多人响应和选择并发导致状态错乱 | selectOrderResponse, acceptOrder | P1 | 中 | 状态乐观锁、幂等键、重复点击保护 | 否 | 技术 | 并发选择只成功一次 |
