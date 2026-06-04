# 风险登记表

| 风险编号 | 风险描述 | 影响页面/云函数 | 严重级别 | 发生概率 | 解决方案 | 是否上线阻塞 | Owner | 验收方式 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | production 继续使用 mockPayOrder | order-detail, order-list, quickstartFunctions | P0 | 高 | production 禁用 mockProvider；接入微信支付或标记线下试运营 | 是 | 技术 | production 环境调用 mockPayOrder 返回拒绝 |
| R-002 | 无退款流程但展示支付托管/已结算 | order-detail, income-stats, quickstartFunctions | P0 | 高 | 建立 refundRequests、退款 provider、结算冻结 | 是 | 技术/运营 | 退款申请、审批、回调、订单状态一致 |
| R-003 | 服务失败后无售后入口 | order-detail, profile | P0 | 高 | 建立售后工单和客服入口 | 是 | 产品 | 用户可从订单详情提交售后 |
| R-004 | 无真实保险字段却误展示保障承诺 | cleaner-detail, order-detail | P0 | 中 | 禁止未证实保险文案；补保险字段 | 是 | 产品/法务 | 无保单时不显示已投保 |
| R-005 | 阿姨准入字段不足 | cleaner-detail, listOpenOrders, acceptOrder | P1 | 高 | 新增实名、健康证、培训、服务证、保险状态 | 否 | 运营 | 未审核/过期状态不可接单 |
| R-006 | 优惠券压低阿姨收入 | order-create, pricing, income-stats | P1 | 中 | 引入 platformSubsidy 和 cleanerBaseIncome | 否 | 产品/财务 | 使用优惠后 cleanerIncome 不下降 |
| R-007 | 开荒保洁按小时导致亏损或服务争议 | order-create, pricing | P1 | 中 | 开荒改按面积和难度加价 | 否 | 产品 | 60㎡起步、特殊项需确认 |
| R-008 | 多人响应和选择并发导致状态错乱 | selectOrderResponse, acceptOrder | P1 | 中 | 状态乐观锁、幂等键、重复点击保护 | 否 | 技术 | 并发选择只成功一次 |
| R-009 | 自动验收后立即结算，售后争议难处理 | autoAcceptOverdueOrdersInternal | P1 | 中 | 自动验收后设置售后期和结算冻结 | 否 | 技术 | auto_completed 后售后期可见 |
| R-010 | 客服/优惠券/反馈仍显示暂未开放 | profile | P1 | 高 | 真实入口或隐藏未开放功能 | 否 | 产品 | 页面无无效入口 |
| R-011 | 证件材料被普通用户看到 | cleaner-detail, cloudfunctions | P0 | 中 | 证件只给 admin，用户只看状态 | 是 | 技术/法务 | 普通用户接口无 fileID 原件 |
| R-012 | requiredPrivateInfos 与实际权限不一致 | app.json, location-select, chat/order images | P1 | 中 | 隐私指引补齐位置、相册、相机、录音、云存储用途 | 否 | 产品 | 小程序隐私检查通过 |
| R-013 | seed/mock 数据进入生产 | initCollections, listCleaner | P1 | 中 | APP_ENV 隔离，production 禁 seed | 否 | 技术 | production seed 接口拒绝 |
| R-014 | 订单价格配置散落前后端 | config/pricing, lib/pricing | P2 | 高 | 价格规则服务端化，前端只展示 quote | 否 | 技术 | 前端篡改金额不影响订单 |
| R-015 | 缺少 auditLogs，资金和状态问题难追溯 | quickstartFunctions | P1 | 中 | 关键操作写 auditLogs | 否 | 技术 | 支付、退款、状态变更有日志 |

