# Management and Scoring Implementation Plan

**Goal:** 完成用户确认的四项功能。
**Architecture:** 原生 MV3，独立规则和榜单模块；MAIN 读取页面正常响应，隔离内容脚本承接只读任务，后台串行写本机数据，管理页负责查询与展示。
**Tech Stack:** 原生 JavaScript/HTML/CSS，Chrome storage/tabs，Python ZIP。
**Spec:** ../specs/2026-10-28-management-and-scoring-design.md

## Global Constraints

无实际关注/取关操作、无模型或密钥、无后台全站监控承诺；数据必须标明覆盖；不完整关系不覆盖完整基线；不运行测试套件。

## Review Focus

关系未知误判为false；部分采集冒充完整；累计计数当期间事件；多账号串数据；页面任务被伪造为敏感操作；拖动时覆盖保存位置；引用触发AI误判。

### Task 1: 榜单位置

独立处理 content.js 的榜单 UI 和新 board-position.js。对外 attach(board,{handle,toggle,body,save}) 返回 update(settings), reset()。保存键 leaderboardPosition={x:0..1,y:0..1}, leaderboardDock={edge:left|right,y:0..1}；收起沿用 leaderboardCollapsed。主集成负责 config/manifest/Popup。

### Task 2: AI评分

独立修改 account-signals.js。classify({account,text,samples=[]}) 兼容返回 ai/warning 原因数组，新增 automationScore/contentScore/score/level/evidence/sampleCount。主集成负责 avatar调用samples与显示分值；样本字段 {id,text,createdAt,replyToId,isRepost}，不将其它帖子声明作为当前帖子证据。

### Task 3: 数据与管理页

新 management-core.js 提供只读解析、关系快照应用、目标校验、趋势统计；data-bridge.js MAIN 解析 Following/帖子响应；manager-content.js 只在用户启动的关注页执行可停止滚动；background.js 串行存储 xaManagerData 与 xaRelationJob；management.html/css/js 独立管理页。提取 reply/quote/repost 关联与作者ID，记录有界7天观察与快照。Popup 新入口。

### Task 4: 集成与交付

更新加载顺序、版本0.2.0、22文件之后的打包清单、README和规则说明；静态检查、包检查、手动界面核对，独立代码复核。然后提交、推送、发布、匿名下载验证。

## 执行记录

四项已获用户授权。分开拥有文件的评分与榜单部分并行完成，主线程负责数据管理集成；不改其它工作区。沿用当前干净的用户项目目录和默认 Git 交付。

2026-10-29：四项代码及 Popup 入口、使用说明已集成。独立复核后修正分页连续性、串行写入、缓存原观测时间、七天淘汰、未知关系与空关注页边界。关系 CSV 与当前完整／部分结果共用取关标记范围。15 个根目录 JavaScript 已通过语法检查；未新增或运行测试套件。

私有虚构数据页面手动核对了关系筛选、24／72 小时统计和缺失提示；榜单验证拖动后立即收起、24×36 像素边缘按钮、按钮上下拖动、展开恢复位置及重置。没有登录真实 X 验证采集字段、分页与跨脚本消息链路，规则准确率也未校准。发布包由文件白名单生成，后续以公开下载包哈希核验交付。
