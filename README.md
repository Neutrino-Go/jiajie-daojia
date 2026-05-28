# 家洁到家

微信家政小程序 MVP：面向社区家政服务，支持住户发布保洁需求、家洁师接单、订单流转、收藏家洁师、再约、评价、消息会话和收入统计。

## 打开方式

在微信开发者工具中打开本文件夹：

```text
D:\WeChat MiNi App\家洁到家
```

通用 AI 团队制度文档在：

```text
D:\WeChat MiNi App\ai-team
```

## 云环境配置

如果 `miniprogram/envList.js` 为空，小程序会使用微信开发者工具当前选择的云环境初始化：

```js
const envList = [];
```

建议在微信云开发中创建环境后，把真实环境 ID 填入：

```js
const envList = [{ envId: "你的云环境ID", alias: "dev" }];
```

然后在微信开发者工具中：

1. 右键 `cloudfunctions/quickstartFunctions`
2. 选择 `创建并部署：云端安装依赖（不上传 node_modules）`
3. 重新编译小程序
4. 打开首页点 `初始化`

如果没有配置云环境或云函数未部署，页面仍会显示，但涉及登录、初始化、下单、接单等云函数操作会提示超时或云服务不可用。

## 本地检查

```powershell
Get-ChildItem -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
Get-ChildItem -Recurse -Filter *.json | ForEach-Object { node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" $_.FullName }
```

云函数测试：

```powershell
cd cloudfunctions\quickstartFunctions
npm.cmd test
```
