# 公司 Store 笔记本部署 · 操作卡

**目标仍为 ACTIVE。** 本云端环境 `wrangler whoami` 未登录，请在你的笔记本上完成耐久 HTTPS 部署。完整说明见 [`company-fork-deploy.md`](./company-fork-deploy.md#b-from-your-laptop--durable-deploy-recommended)。

## 复制粘贴（笔记本）

```bash
# 0) 仓库根目录（已 clone 本 fork 分支）
cd awesome-deepseek-harness-plugins   # 或你的本地路径
git checkout cursor/company-store-fork-cb2c
npm ci

# 1) Cloudflare 登录（浏览器交互）
npx wrangler login
npx wrangler whoami

# 2) 一键耐久部署（workers.dev）
npm run deploy:company-store-laptop
```

脚本成功后会打印 **PUBLIC ORIGIN**（形如 `https://company-store.<subdomain>.workers.dev`）。

## 把 HTTPS 发回 / 钉死桌面常量

任选其一：

1. **把打印的 HTTPS origin 发回** Store PR [#1](https://github.com/hopefullstack-collab/awesome-deepseek-harness-plugins/pull/1) 或云端 agent 对话（便于自动 pin）。
2. 本机直接 pin：

```bash
COMPANY_STORE_ORIGIN='https://company-store.<subdomain>.workers.dev' \
  npm run pin:company-store-origin -- --verify

# 写入桌面 PR #19 工作树：
COMPANY_STORE_ORIGIN='…' npm run pin:company-store-origin -- \
  --apply --verify --desktop-path /path/to/deepseek-harness-desktop
```

## 重要：trycloudflare 只作联调

| 用途 | 可否钉生产 `COMPANY_STORE_*` |
| --- | --- |
| `wrangler dev --local` / localhost | **否** |
| `*.trycloudflare.com` 快速隧道 | **否**（联调 / 匿名 smoke 专用；`pin:company-store-origin` 会拒绝） |
| `*.workers.dev` 或公司 apex（笔记本 `deploy:company-store-laptop`） | **是**（M1 耐久门） |

当前联调 origin（非 M1、不可 pin）：见 PR #1 / [`examples/smoke-evidence/LIVE.md`](./examples/smoke-evidence/LIVE.md)。
