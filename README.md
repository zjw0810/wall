# 六味情书 · 爱的表白墙（LED 弹幕互动）

> 惠州华贸天地 2026 七夕爱心表白墙，按本版本二次开发

一个轻量的现场互动表白墙系统：观众手机扫码进入 H5 页面，选择一种「味道」主题写下情话，经后台审核后实时投放到 LED 大屏，以弹幕形式循环播放。

## 功能特性

- **H5 收集页**：选择味道 → 写情话 → 生成表白卡（可投屏 / 保存图片）
- **Node.js 后端**（零依赖）：提交 / 读取 / 审核 / 删除 / 登录接口
- **LED 大屏弹幕**：头像 + 昵称 + 内容 + 爱心特效，按味道配色，循环滚动
- **内容审核**：投稿默认待审核，后台通过后才上大屏
- **违禁词过滤**：`banned-words.txt`（一行一词，命中即拒绝）
- **登录鉴权**：账号配置于 `config.json`（默认 admin / liuwei888，上线前请修改）

## 快速开始

```bash
node server.js
```

打开：

- 收集页：http://localhost:3000/
- 大屏弹幕：http://localhost:3000/screen.html （需登录）
- 后台审核：http://localhost:3000/admin.html （需登录）

## 目录结构

```
├── confession-wall-step1.html   首页 / 选味道
├── confession-wall-step2.html   写情话 / 提交
├── screen.html                  ★ LED 大屏弹幕页
├── admin.html                   后台审核页
├── login.html                   登录页
├── server.js                    ★ 后端服务（Node.js 零依赖，自托管）
├── config.json                  登录账号（SHA-256 哈希）
├── banned-words.txt             违禁词表
└── data/confess.json            投稿数据（运行时自动生成）
```

## 数据与安全

- 投稿数据持久化在 `data/confess.json`（首次运行自动创建），请定期备份。
- 修改密码：`node -e "console.log(require('crypto').createHash('sha256').update('新密码').digest('hex'))"`，将输出写入 `config.json` 对应账号的 `passHash`。

## 部署（阿里云 / 自托管）

1. 上传代码到服务器（如 `/root/wall`）。
2. 安装 Node.js 18+。
3. 安装并启动 pm2：

   ```bash
   npm install -g pm2
   pm2 start server.js --name wall
   pm2 save
   ```

4. 防火墙放行 TCP 3000 端口，浏览器访问 `http://服务器IP:3000/`。

> 数据文件 `data/confess.json` 为运行时生成，升级代码不会覆盖现场数据。
