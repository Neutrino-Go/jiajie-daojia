# 按钮功能映射表

本表用于回归检查：所有按钮必须有跳转、数据操作或明确提示。

| 页面路径 | 按钮/入口 | 当前点击行为 | 目标页面或功能 | 状态 |
| --- | --- | --- | --- | --- |
| `pages/home/index` 客户 | 左上地址 | 跳转 | `pages/location-select/index` | 已修复 |
| `pages/home/index` 客户 | 初始化 | 数据操作 | `initCollections` | 已修复 |
| `pages/home/index` 客户 | 发布需求 | 跳转 | `pages/order-create/index` | 已修复 |
| `pages/home/index` 客户 | 我的订单 | Tab 跳转 | `pages/order-list/index` | 已修复 |
| `pages/home/index` 客户 | 推荐/附近家洁师 | 跳转 | `pages/cleaner-list/index` | 已修复 |
| `pages/home/index` 客户 | 收藏家洁师 | 跳转 | `pages/saved-cleaners/index` | 已修复 |
| `pages/home/index` 客户 | 已完成统计 | 筛选跳转 | 订单列表 `completed` | 已修复 |
| `pages/home/index` 客户 | 可约家洁师统计 | 跳转 | `pages/cleaner-list/index` | 已修复 |
| `pages/home/index` 客户 | 好评统计 | 跳转 | `pages/reviews/index` | 已修复 |
| `pages/home/index` 客户 | 社区统计 | 跳转 | `pages/address-manage/index` | 已修复 |
| `pages/home/index` 家洁师 | 接单状态 | 数据操作 | `updateCleanerAvailability` | 已修复 |
| `pages/home/index` 家洁师 | 附近订单/指派订单 | 页面内切换 | 切换订单列表 | 已修复 |
| `pages/home/index` 家洁师 | 抢单/接单 | 数据操作 + 跳转 | `acceptOrder` 后进入订单详情 | 已修复 |
| `pages/home/index` 家洁师 | 拒绝 | 数据操作 | `declineAssignedOrder` | 已修复 |
| `pages/order-create/index` | 服务类型 | 页面内选择 | 更新服务类型与参考价 | 已修复 |
| `pages/order-create/index` | 预约方式 | 页面内选择 | 公开/指派 | 已修复 |
| `pages/order-create/index` | 服务日期/时间 | Picker | 日期与时间选择 | 已修复 |
| `pages/order-create/index` | 服务地址 | 跳转 | `pages/location-select/index`，小区手动输入 | 已修复 |
| `pages/order-create/index` | 发布需求 | 数据操作 + 跳转 | `createOrder` 后进入订单详情 | 已修复 |
| `pages/order-list/index` | 状态 Tabs | 页面内筛选 | 订单状态筛选 | 已修复 |
| `pages/order-list/index` | 联系对方 | 跳转 | `pages/chat/index` | 已修复 |
| `pages/order-list/index` | 取消/开始/完成 | 数据操作 | `updateOrderStatus` | 已修复 |
| `pages/order-detail/index` | 联系对方 | 跳转 | `pages/chat/index` | 已修复 |
| `pages/order-detail/index` | 接单/拒绝/取消/开始/完成 | 数据操作 | 云函数订单动作 | 已修复 |
| `pages/order-detail/index` | 重新指派/改为公开 | 数据操作 | `updateOrderPublishMode` | 已修复 |
| `pages/order-detail/index` | 提交评价 | 数据操作 | `submitReview` | 已修复 |
| `pages/messages/index` | 会话卡片 | 跳转 | `pages/chat/index` | 已新增 |
| `pages/chat/index` | 发送 | 数据操作 | `sendMessage` | 已新增 |
| `pages/profile/index` 客户 | 我的订单/收藏/地址 | 跳转 | 对应页面 | 已修复 |
| `pages/profile/index` 客户 | 优惠券 | Toast | 暂未开放 | 已修复 |
| `pages/profile/index` 家洁师 | 我的订单/收入/评价/资料 | 跳转 | 对应页面 | 已修复 |
| `pages/cleaner-detail/index` 家洁师 | 服务范围 | 数据编辑 | 手动输入小区并形成多个标签 | 已修复 |
| `pages/location-select/index` | 街道 | Picker | 根据省市区更新候选街道 | 已修复 |
| `pages/location-select/index` | 小区名称 | 手动输入 | 保存到 `currentLocation` 与用户资料 | 已修复 |
| `pages/profile/index` 通用 | 客服/反馈 | Toast | 暂未开放 | 已修复 |
| `pages/profile/index` 通用 | 设置 | ActionSheet | 身份切换确认 / 初始化 | 已修复 |
