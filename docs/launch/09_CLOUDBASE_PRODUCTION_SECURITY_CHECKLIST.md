# CloudBase 生产安全复核清单

版本：v0.2.9

## 必须复核

- [ ] 生产环境 `APP_ENV=production`，未配置时默认按生产处理。
- [ ] `ADMIN_OPENIDS` 使用环境变量或 `adminUsers` 集合，不写死在代码。
- [ ] `paymentIntents`、`paymentCallbacks`、`refundRequests`、`settlements`、`payoutRecords` 只允许云函数写入。
- [ ] `auditLogs` 只允许管理员读取，所有写入通过云函数。
- [ ] `cleanerVerifications` 和 `insurancePolicies` 不对普通用户开放原始文件 ID、保单号或证件内容。
- [ ] 订单、售后、评价、服务证明图片必须通过云函数脱敏后返回。
- [ ] `review-packages/` 不提交 git，也不上传到小程序代码包。

## 数据库规则草案

草案文件：

- `cloudbase/security-rules/database.rules.json`
- `cloudbase/security-rules/storage.rules.json`

这些文件不是 CloudBase 控制台的最终表达式，正式上线前必须由开发者在控制台按真实环境逐项转换和验证。

## 支付与退款

- [ ] 微信支付商户号、证书序列号、API v3 key、私钥、回调 URL 只配置在环境变量或密钥管理中。
- [ ] 生产环境不能使用 `manual_stub` provider。
- [ ] 支付回调必须校验微信签名。
- [ ] 退款提交必须由管理员触发，且 provider 配置完整时才进入真实提交流程。

## 未完成上线阻塞

- 微信开发者工具真实编译和真机预览仍需执行。
- CloudBase 生产数据库规则和部署权限仍需人工复核。
- 真实微信支付、退款、结算仍需真实商户配置与联调。
