# Local Account Labels Implementation Plan

**Goal:** 为明确本地信号添加可关闭、不影响布局的头像标记。

**Architecture:** 现有响应解析保留最小账号字段；纯规则模块返回原因；独立覆盖图层绑定本帖作者头像。

**Tech Stack:** 原生 JavaScript、Chrome MV3、现有 Popup 与 Python 打包脚本。

**Spec:** ../specs/2026-10-28-local-account-labels-design.md

## Global Constraints

两个开关默认关闭；无新增权限或请求；无布局位移；帖子证据不能污染其他帖子；不把缺失数据判成异常。

## Review Focus

引用/否定/代码的误标；头像用户和帖子作者不一致；节点复用的旧标记；开关关闭及断开节点清理；安装包漏文件。

### Task 1: 规则与元数据

- [x] 新建 account-signals.js，提供 normalizeAccount(user) 和 classify({account,text})，返回 ai/warning 原因数组。
- [x] metrics-core.js 保留最小账号信息、跨更新合并；manifest.json 在两个环境中按顺序加载规则模块。

### Task 2: 图层与设置

- [x] 新建 account-decorations.js，提供 sync(articles,settings,resolve)，只选择与作者匹配的本帖头像；覆盖图层跟随滚动与缩放。
- [x] content.js 在原观察器暂停期间同步装饰，排除自身变更；Popup 增加独立布尔开关并兼容旧设置。

### Task 3: 交付

- [x] 版本更新为 0.1.5，维护打包文件列表及开发预览加载顺序，补充 README 的规则范围。
- [x] 检查 JavaScript 语法、diff；查看浏览器预览中的布局及清理行为。打包依赖由发布脚本核对。
交付步骤：复核后按用户既有 Git 流程提交、推送并更新可下载安装包；实际交付结果以 Git 与 Releases 为准。

## 验证范围

本次使用静态检查、打包检查和手动界面走查，不包含新增或运行测试套件，也不代表真实登录 X 后的兼容性验收。

## 复核记录

静态复核修正了引用删除后错误拼接、模型自述的研究者/开发者后缀、同账号 DOM 帖子证据继承及固定页头遮挡。虚构帖子界面已查看黄色 AI、红色问号、滚动定位、当前帖子内容更新、总开关清理和默认关闭的 Popup。未连接真实 X，实际返回字段与页面结构仍需现场反馈。
