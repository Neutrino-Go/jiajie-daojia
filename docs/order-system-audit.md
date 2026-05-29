# 订单系统审计报告

本报告基于 `dev` 分支当前代码做静态审计，目标是梳理现状和后续优化边界。本次未修改订单业务逻辑、页面 UI、云函数逻辑或字段结构。

## 1. 当前订单相关文件清单

订单创建与用户端链路：

- `miniprogram/pages/order-create/index.js`：用户发布需求、填写服务信息、地址快照、联系方式、实时价格预估并调用 `createOrder`。
- `miniprogram/pages/order-create/index.wxml` / `index.wxss`：发布需求页表单和价格预估展示。
- `miniprogram/pages/order-list/index.js`：用户端/家洁师端共用订单列表、Tab 统计、操作按钮、删除/归档、模拟支付、进入会话。
- `miniprogram/pages/order-list/index.wxml` / `index.wxss`：订单 Tab 和共享 `order-card` 列表。
- `miniprogram/pages/order-detail/index.js`：订单详情、响应/接单、付款、开始服务、提交完成、验收评价、评价修改、上传评价照片、完成照片、电话/会话/收藏。
- `miniprogram/pages/order-detail/index.wxml` / `index.wxss`：订单详情页状态、联系人、价格、评价、完成照片和底部操作。

家洁师接单链路：

- `miniprogram/pages/home/index.js`：角色化首页。家洁师端加载附近订单、全部公开订单、指派订单，统一装饰订单并处理响应/拒绝。
- `miniprogram/pages/home/index.wxml` / `index.wxss`：家洁师接单首页三段式订单列表。
- `miniprogram/pages/accepted-orders/index.js` / `index.wxml`：家洁师“已接服务单”旧入口，仍复用 `order-card`。
- `miniprogram/pages/assigned-orders/index.js` / `index.wxml`：家洁师“指派给我”旧入口，仍复用 `order-card`。

订单卡片与展示工具：

- `miniprogram/components/order-card/index.wxml` / `index.wxss` / `index.js`：用户端订单列表、家洁师订单列表、家洁师首页公开/指派订单复用的订单卡片。
- `miniprogram/utils/format.js`：订单状态文案、状态分组、价格/抽成 fallback、距离字段、完整地址、短订单编号、订单展示字段 `decorateOrder`。
- `miniprogram/utils/constants.js`：服务类型、时长、旧状态文案和旧固定价格常量。
- `miniprogram/utils/location.js`：坐标标准化、距离计算、距离展示。
- `miniprogram/utils/session.js`：当前角色、角色位置、身份上下文。
- `miniprogram/config/pricing.js`：前端城市分层定价配置和 `calculateOrderPrice`。

云函数与领域规则：

- `cloudfunctions/quickstartFunctions/index.js`：`createOrder`、`listOpenOrders`、`listAssignedOrders`、`listMyOrders`、`acceptOrder`、`selectOrderResponse`、`mockPayOrder`、`updateOrderStatus`、`hideOrderForRole`、`getOrderDetail`、`getIncomeStats`、`submitReview`、自动验收等。
- `cloudfunctions/quickstartFunctions/lib/domain.js`：订单状态归一化、状态分组、状态流转校验、自动验收判断、评价规则、隐藏/归档规则、收入统计判断。
- `cloudfunctions/quickstartFunctions/lib/pricing.js`：云端城市分层定价逻辑，和前端 `config/pricing.js` 保持同构。
- `cloudfunctions/quickstartFunctions/test/domain.test.js`：领域函数、状态分组、Tab 角标、状态文案、支付状态、隐藏/归档、收入、自动验收、定价一致性等测试。

其他相关入口：

- `miniprogram/pages/income-stats/index.js`：家洁师收入统计，依赖 settled 订单收入。
- `miniprogram/pages/reviews/index.js`：家洁师收到的评价列表。
- `miniprogram/pages/chat/index.wxml` / `index.wxss`：聊天页内有独立的订单卡片快照布局，没有复用 `components/order-card`。

## 2. 当前订单状态枚举

| 状态 | 当前含义 | 主要出现位置 |
| --- | --- | --- |
| `pending` | 历史/兼容状态。前端按 `publishMode` 归一为公开待响应或指派待接单；云端仍在公开订单、指派订单和测试中兼容。 | `format.js`、`domain.js`、`index.js`、测试 |
| `waiting_response` | 公开订单已发布，等待家洁师响应。 | `createOrder`、`listOpenOrders`、订单列表、详情页、状态文案 |
| `waiting_confirm` | 已有家洁师响应，等待用户选择家洁师。 | `acceptOrder`、`selectOrderResponse`、用户详情响应列表 |
| `assigned_waiting_accept` | 用户指派家洁师，等待该家洁师接受。 | `createOrder`、`listAssignedOrders`、详情页、Tab 统计 |
| `assigned_declined` | 指派家洁师拒绝，用户可改为公开或重新指派。 | `declineAssignedOrder`、`updateOrderPublishMode`、用户详情 |
| `waiting_payment` | 用户已选择/家洁师已接受，等待用户支付到平台托管。 | `acceptOrder` 指派链路、`selectOrderResponse`、`mockPayOrder`、列表/详情操作 |
| `confirmed` | 用户已支付，平台托管中，等待上门服务。 | `mockPayOrder`、`updateOrderStatus` 开始服务、详情/列表 |
| `accepted` | 旧状态别名，前端和领域层归一为 `confirmed`，部分操作判断仍兼容。 | `format.js`、`domain.js`、订单列表/详情 |
| `in_service` | 家洁师已开始服务。 | `updateOrderStatus`、订单列表/详情 |
| `waiting_complete` | 家洁师已提交完成，等待用户验收。 | `updateOrderStatus`、自动验收、订单列表/详情 |
| `waiting_acceptance` | 旧/前端提交别名，云函数收到后转成 `waiting_complete`。 | `order-detail/index.js`、`updateOrderStatus`、展示兼容 |
| `completed` | 用户主动验收并评价后完成，支付状态应为 settled。 | `completeOrderWithReview`、`submitReview`、收入/评价统计 |
| `auto_completed` | 超时未验收，系统自动完成并结算，不生成手动评分。 | `autoAcceptOverdueOrdersInternal`、收入统计、状态分组 |
| `cancelled` | 用户取消订单。 | `updateOrderStatus`、列表/详情、隐藏/归档 |
| `assigned_pending` | Tab 统计里出现的兼容状态，但当前状态文案和归一化链路没有完整覆盖。 | `format.js` 的 `getOrderTabCount`、测试数据 |

支付状态枚举：

- `unpaid`：未支付或待用户确认阶段。
- `pending_pay`：待支付。
- `escrowed`：已支付到平台托管。
- `settled`：已结算。
- `refunded`：已退款。

## 3. 当前订单流转路径

公开订单主路径：

1. 用户在 `order-create` 发布公开需求，云函数 `createOrder` 写入 `publishMode = "public"`、`status = "waiting_response"`、`paymentStatus = "unpaid"`。
2. 家洁师在首页“附近订单/全部订单”看到公开订单，点击响应，云函数 `acceptOrder` 将订单推进到 `waiting_confirm`，并在 `responses` 中追加该家洁师响应记录。
3. 用户在订单详情的响应列表中选择家洁师，`selectOrderResponse` 将订单推进到 `waiting_payment`、`paymentStatus = "pending_pay"`，并写入 `acceptedCleanerOpenid`。
4. 用户点击模拟支付，`mockPayOrder` 将订单推进到 `confirmed`、`paymentStatus = "escrowed"`，并创建/确保会话。
5. 家洁师在订单详情或列表点击开始服务，`updateOrderStatus(in_service)` 校验已托管后推进到 `in_service`。
6. 家洁师提交完成，`updateOrderStatus(waiting_acceptance)` 在云端归一为 `waiting_complete`，保存 `completionPhotoUrls` / `completionPhotos`，等待用户验收。
7. 用户验收并评价，`updateOrderStatus(completed)` 调用 `completeOrderWithReview`，写入 `completed`、`paymentStatus = "settled"`、`settledAt`，创建手动评价并刷新家洁师统计。
8. 如果用户超时未验收，`autoAcceptOverdueOrdersInternal` 将 `waiting_complete` 推进到 `auto_completed`、`paymentStatus = "settled"`，不创建手动评价。

指派订单主路径：

1. 用户发布指派订单，`createOrder` 写入 `publishMode = "assigned"`、`assignedCleanerOpenid`、`status = "assigned_waiting_accept"`。
2. 被指派家洁师在“指派订单”看到订单，可接受或拒绝。
3. 接受后 `acceptOrder` 直接推进到 `waiting_payment`，等待用户支付。
4. 拒绝后 `declineAssignedOrder` 推进到 `assigned_declined` 并清空 `assignedCleanerOpenid`，用户可重新指派或改公开。
5. 支付后的服务、完成、验收、结算路径与公开订单一致。

取消/隐藏：

- 用户可在未完成的特定状态取消订单，`assertStatusTransition` 统一校验。
- `completed` / `auto_completed` / `cancelled` 可通过 `hideOrderForRole` 前台隐藏：用户端写 `hiddenForCustomer`，家洁师端写 `hiddenForCleaner`，不物理删除。

## 4. 用户端订单链路

创建订单：

- `order-create/index.js` 只允许 customer 进入。
- 地址来自 `getRoleLocation("customer")`，发布时保存 `locationSnapshot`，包含省市区街道、小区、详细地址、完整地址和经纬度。
- 前端根据城市、服务类型、服务时长调用 `calculateOrderPrice` 实时展示价格，但最终价格由云函数 `createOrder` 重新计算并落库。
- 发布时提交 `publishMode`，公开订单进入 `waiting_response`，指派订单进入 `assigned_waiting_accept`。

订单列表：

- `order-list/index.js` 调用 `listMyOrders`，用 `decorateOrder` 生成展示字段、状态分组和价格字段。
- Tab 基于完整 `allOrders` 统计，不只统计当前筛选列表。
- 用户端操作包括查看详情、取消、立即支付、联系家洁师、验收评价、评价家洁师、修改评价。
- 终态订单通过三点菜单触发删除，实际调用 `hideOrderForRole({ role: "customer" })` 前台隐藏。

订单详情：

- `getOrderDetail` 返回订单、家洁师资料、客户资料、评价信息、是否收藏、是否可编辑评价。
- 用户可在 `waiting_confirm` 选择响应家洁师。
- 用户可在 `waiting_payment` 模拟支付。
- 用户可在 `waiting_complete` / `waiting_acceptance` 验收并强制评分。
- 已评价且 24 小时内、未修改过时可修改一次评价。
- 用户评价照片保存在 `reviews.imageUrls`，家洁师完成照片保存在订单 `completionPhotoUrls` / `completionPhotos`。

## 5. 家洁师端订单链路

首页接单：

- `home/index.js` 在 cleaner 角色下加载三组订单：
  - `listOpenOrders({ scope: "nearby" })`：同城/同区附近公开订单。
  - `listOpenOrders({ scope: "all" })`：全部公开订单，非同城订单会带 `nonLocal` / `locationTag`。
  - `listAssignedOrders()`：指派给当前家洁师的订单。
- 每条订单使用 `decorateOrder(order, login.openid, "cleaner", cleanerLocation)`，再注入响应或拒绝动作。
- 休息中时响应按钮置为禁用，点击响应会提示先切换接单中。
- 非同城公开订单响应前有二次确认。

家洁师订单列表：

- `order-list/index.js` 在 cleaner 角色下调用 `listMyOrders`，包含已响应等待用户确认、已接、指派等与当前家洁师有关的订单。
- 列表会先用 `decorateOrderDistance(order, cleanerLocation)` 计算距离，再 `decorateOrder`。
- 家洁师操作包括查看详情、开始服务、提交完成、联系客户。
- 终态订单通过三点菜单触发归档，调用 `hideOrderForRole({ role: "cleaner" })`。

订单详情：

- 家洁师可查看公开可响应订单、自己响应过的订单、自己被指派或已接订单。
- 家洁师只有在 `paymentStatus = "escrowed"` 且订单为 `confirmed` / `accepted` 时才能开始服务。
- `in_service` 状态下可上传最多 6 张服务完成照片并提交完成；不上传照片也可提交。
- 联系方式在确认后开放，家洁师端看到用户联系方式。

## 6. 价格与抽成相关字段

定价配置与计算位置：

- 前端：`miniprogram/config/pricing.js`。
- 云端：`cloudfunctions/quickstartFunctions/lib/pricing.js`。
- 创建订单云函数：`createOrder` 调用 `calculateOrderPricing` 重新计算，防止前端篡改金额。
- 展示 fallback：`miniprogram/utils/format.js` 的 `estimatePrice` 和 `commissionFor`。

核心配置：

- `baseHourlyPrice = 46`。
- `platformFeeRate = 0.05`。
- 城市系数由城市平均薪资配置压缩计算，限制在 `0.88 - 1.25`。
- 城市最低家洁师时薪保护，目前默认最低 40 元，上海/北京/深圳等更高。
- 服务类型系数：日常保洁 `1.0`、深度保洁 `1.3`、开荒保洁 `1.5`、家务整理 `1.2`。

订单字段：

- `amount` / `orderAmount` / `estimatedPrice`：订单金额。
- `platformFee`：平台服务费。
- `cleanerIncome`：家洁师预计收入。
- `pricingSnapshot`：订单创建时的定价快照，包含城市、系数、服务类型系数、时长、订单金额、平台费、家洁师收入、最低时薪保护等。
- `durationHours`：服务时长。
- `serviceType`：服务类型。
- `paymentStatus`：支付状态。
- `settlementStatus`：结算状态。
- `settledAt`：结算时间。

收入统计规则：

- 云端 `isSettledIncomeOrder` 只统计 `completed` / `auto_completed` 且 `paymentStatus = "settled"` 的订单。
- `getIncomeStats` 以 `cleanerIncome` 或订单收入计算结果为收入来源。
- 自动验收订单计入收入和完成数，但不计入手动评分平均值。

兼容风险：

- `utils/constants.js` 仍保留 `SERVICE_PRICE`、`DAILY_CLEANING_PRICE`、`COMMISSION_CAP`、`DEEP_CLEANING_UNIT_PRICE`、`POST_CONSTRUCTION_UNIT_PRICE` 等旧固定价字段。当前主链路已使用城市分层定价，但旧常量存在误用风险。
- 前端和云端各复制一份定价逻辑，当前测试覆盖同构，但后续修改需要同步双端。

## 7. UI 风险点

状态标签空色块：

- 共享订单卡片已改为 `wx:if="{{order.statusBadgeText}}"` / `reviewBadgeText` / `distanceDisplayText`，理论上能避免空胶囊。
- `decorateOrder` 也会给 `statusBadgeText` 做 fallback，不应为空。
- 风险仍在于旧入口或未装饰订单直接传入 `order-card`，会缺少 `statusBadgeText`、`distanceDisplayText` 等字段。

状态、评价、距离重叠：

- `components/order-card/index.wxml` 当前为三行结构：标题/更多、时间/主状态、评价/非同城/距离，已比单行堆叠稳定。
- 但第三行 `order-extra-group` 仍是横向排列，如果同时出现“已评价 + 非同城 + 较长距离文本”，窄屏仍可能压缩；当前靠 `max-width` 和 ellipsis 缓解。
- `order-card/index.js` 仍有一次性的 `[order-card display]` 调试日志，适合在下一轮清理。

距离 fallback：

- `decorateOrderDistance` 缺坐标时会显示“距离未知”并输出缺坐标日志。
- `decorateOrder` 在没有 `referenceLocation` 时也会给非同城以外订单 fallback 到“距离未知”。
- 用户端订单列表目前不计算距离，只在家洁师列表/接单页按家洁师位置计算。若用户端未来也展示距离，需要明确用户位置来源。

长文本与卡片溢出：

- `order-card` 标题、时间、距离文本已设置 `min-width: 0` / ellipsis。
- 地址使用 `word-break: break-all`，不易横向溢出，但过长地址会拉高卡片。
- 订单详情页的 `info-row` 展示完整地址和订单编号，仍需在视觉测试中确认长地址不会挤压右侧值。

重复订单卡片 UI：

- 主订单列表、家洁师首页、已接服务单、指派给我都复用 `components/order-card`。
- 聊天页 `miniprogram/pages/chat/index.wxml` 有独立 `order_card` 消息快照布局，不复用共享组件。
- 订单详情页是独立详情布局，不应复用列表卡片，但状态文案需继续依赖统一 formatter。

WXML/WXSS/JS 字段一致性：

- `order-card` 依赖 `statusBadgeText`、`statusStyle`、`reviewBadgeText`、`nonLocalText`、`distanceDisplayText`、`priceText`、`platformFeeDeductText`、`cleanerIncomeText` 等字段。
- `order-list` 和 `home` 主链路均调用 `decorateOrder` 后再传给 `order-card`。
- `accepted-orders` 和 `assigned-orders` 也调用 `decorateOrder`，但没有注入家洁师位置，因此距离可能只能 fallback。

## 8. 发现的问题列表

### P0

未发现会直接导致当前主订单流程完全不可用的问题。订单创建、响应、选择、支付、开始服务、提交完成、验收评价、自动验收、隐藏/归档在代码中都有对应链路和测试覆盖。

### P1

- 状态枚举仍存在多套兼容名：`accepted`、`waiting_acceptance`、`pending`、`assigned_pending` 与主状态并存。前端 formatter、云端 domain、列表 actions、测试中覆盖程度不完全一致，后续容易出现状态文案、Tab 统计或按钮可见性不一致。
- `assigned_pending` 只在 Tab 统计和测试数据中作为 cleaner 待处理状态出现，但当前 `normalizeOrderStatus` 和 `getOrderStatusCopy` 没有显式覆盖它，真实数据若出现可能落入 fallback 文案。
- `orderDistanceFields` 内部仍可能把非同城写成 `distanceText = "非当前城市"`，虽然 `decorateOrder` 又拆成 `nonLocalText`，但其他页面若直接使用 `distanceText`，可能把非同城当距离展示。
- `buildAutoAcceptanceReview` 仍返回默认 5 星自动评价对象，但当前自动验收路径没有调用它。该函数本身和“自动验收不计入评分”的规则表达冲突，容易被后续误用。

### P2

- `utils/constants.js` 仍保留旧固定价和旧抽成上限常量，当前主链路不用它们计算新订单，但后续开发者可能误引用，破坏城市分层定价。
- 前端和云端各维护一份 `pricing.js`，配置同构但重复，改价时需要双端同步。已有测试降低风险，但维护成本仍在。
- `accepted-orders`、`assigned-orders` 是旧入口页面，虽然复用 `order-card`，但和首页/订单列表的筛选、距离、操作能力不完全一致，后续可能形成重复维护。
- 聊天页订单卡片快照布局独立于共享 `order-card`，状态、价格、地址展示规则不会自动继承订单卡片修复。
- `order-card/index.js` 有临时调试日志 `[order-card display]`，长期保留会污染控制台。
- 公开订单 `listOpenOrders` 先拉取最多 100 条再内存过滤位置和状态，MVP 可接受，但订单量增长后会有漏单和性能风险。
- 订单详情 `onShow` 每次都会 `load()`，评价草稿已有防覆盖逻辑；完成照片草稿没有类似 dirty 标识，从相册返回是否被覆盖需要专项验证。

### P3

- 建议在 formatter 中集中导出“可操作按钮状态”或按钮策略，减少 `order-list`、`order-detail`、`home` 各自判断状态的重复。
- 建议为 `decorateOrder` 增加小型快照测试，覆盖 `statusBadgeText`、`reviewBadgeText`、`distanceDisplayText` 不为空/不误渲染的组合。
- 建议给 `order-card` 增加典型状态 mock 截图用例：已完成已评价、非同城距离、待支付、待验收、长地址、无坐标。
- 建议逐步移除 `constants.js` 中不再参与主链路的旧价格常量，或明确标注 legacy。

## 9. 建议的下一轮开发任务

建议拆成 5 个小 PR，避免一次性大改订单核心链路。

1. PR：统一订单状态枚举与兼容状态收口
   - 目标：明确 canonical 状态，集中处理 `pending`、`accepted`、`waiting_acceptance`、`assigned_pending`。
   - 范围：`utils/format.js`、`cloudfunctions/quickstartFunctions/lib/domain.js`、相关测试。
   - 验证：状态分组、状态文案、按钮可见性测试。

2. PR：订单卡片展示字段测试与调试日志清理
   - 目标：保证 `statusBadgeText`、`reviewBadgeText`、`nonLocalText`、`distanceDisplayText` 不出现空胶囊和误显示。
   - 范围：`components/order-card`、`utils/format.js` 测试。
   - 验证：典型订单 mock 数据静态检查和小程序截图。

3. PR：定价 legacy 字段治理
   - 目标：标注或移除旧固定价格常量，防止新订单误用旧价格体系。
   - 范围：`utils/constants.js`、`config/pricing.js`、云端 `lib/pricing.js`、测试。
   - 验证：上海/哈尔滨/无锡等价格示例和最低时薪保护测试。

4. PR：旧订单入口与聊天订单快照收敛
   - 目标：确认 `accepted-orders`、`assigned-orders` 是否仍需保留；聊天订单卡片是否复用统一 formatter。
   - 范围：旧入口页面、聊天页订单快照。
   - 验证：入口跳转、状态文案、订单金额和地址展示。

5. PR：完成照片草稿与上传状态专项修复
   - 目标：确认家洁师提交完成照片从相册返回不会被 `onShow` 刷新覆盖，上传失败/删除/预览体验稳定。
   - 范围：`order-detail/index.js` / `index.wxml` / `index.wxss`。
   - 验证：无照片提交、有照片提交、上传失败、住户验收页预览。
