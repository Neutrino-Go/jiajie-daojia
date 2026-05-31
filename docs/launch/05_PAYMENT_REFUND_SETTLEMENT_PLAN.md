# 支付、退款、结算计划

## 核心原则

1. 没有真实微信支付配置时，production 禁止 `mockPayOrder`。
2. 如果暂不接入支付，产品必须标记为试运营或线下支付，不能写资金托管。
3. 真实支付必须具备 provider 抽象、回调幂等、退款能力、对账和审计日志。
4. 售后、退款、理赔中必须暂停或延迟结算。

## paymentProvider 抽象

接口建议：

- `createPayment(order, quote, payer)`
- `handlePaymentNotify(rawPayload)`
- `queryPayment(transactionId)`
- `createRefund(order, amount, reason)`
- `handleRefundNotify(rawPayload)`
- `queryRefund(refundId)`

provider：

- `mockProvider`：仅 dev/test 可用。
- `wechatPayProvider`：production 可用。

环境规则：

- `APP_ENV=production` 时，调用 `mockPayOrder` 必须直接拒绝。
- `APP_ENV=dev/test` 时，`mockPayOrder` 可保留用于测试。

## 支付流程

1. 用户选择家洁师后生成待支付订单。
2. 前端请求 `createPayment`。
3. 云函数创建微信支付订单，写入 `paymentIntent`。
4. 用户完成支付。
5. 微信支付回调触发 `handlePaymentNotify`。
6. 云函数幂等更新：
   - `paymentStatus = escrowed`
   - `status = confirmed`
   - `paidAt`
   - `paymentTransactionId`
7. 创建或确保会话。

幂等要求：

- 回调使用 `paymentTransactionId` 或 `outTradeNo` 幂等。
- 已经 `escrowed` 的订单重复回调不得重复推进状态。

## 退款流程

### 未服务全退

触发：

- 家洁师未开始服务。
- 用户取消且符合全退规则。

结果：

- `refundStatus = approved`
- `paymentStatus = refunded`
- `status = cancelled`

### 阿姨爽约退款

触发：

- 家洁师未按时上门或取消。

结果：

- 用户退款。
- 可能生成 `compensation` 给用户。
- 家洁师信用记录扣分。

### 用户取消扣补偿

触发：

- 服务临近开始时用户取消。

结果：

- 部分退款。
- 补偿给家洁师，不能超过平台规则。

### 售后部分退款

触发：

- 用户不满意、财物损坏、服务缺失。

结果：

- 创建 `refundRequests`。
- 客服审核后发起部分退款。
- 售后中暂停或部分结算。

## 结算流程

### 用户主动验收

1. 用户提交评价并验收。
2. 订单进入 `completed`。
3. 若无售后冻结，进入结算。
4. 写入：
   - `paymentStatus = settled`
   - `settlementStatus = settled`
   - `settledAt`

### 自动验收

1. 到达超时时间。
2. 订单进入 `auto_completed`。
3. 不生成手动评分。
4. 进入售后期。
5. 售后期内如无争议，可结算。

### 售后中

若 `disputeStatus != none`：

- `settlementStatus = on_hold`
- `settlementHoldReason = after_sales`
- 不释放家洁师收入或只释放无争议部分。

## 状态字段建议

- `paymentStatus`: `unpaid | pending_pay | escrowed | settled | refunded | failed`
- `settlementStatus`: `pending | escrowed | on_hold | settled | partially_settled | failed`
- `refundStatus`: `none | requested | approved | rejected | processing | refunded | failed`
- `paymentProvider`: `mock | wechat`
- `paymentTransactionId`
- `refundTransactionId`
- `paymentNotifyLogIds`
- `refundNotifyLogIds`

## v0.2.4 最小验收

- production 禁用 mock pay。
- 支付回调重复调用不重复结算。
- 退款请求重复调用不重复退款。
- 自动验收不生成评分。
- 售后中订单不立即结算。

