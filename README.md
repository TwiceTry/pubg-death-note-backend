# PUBG Death Note

> **你的 PUBG 专属"死亡笔记"——记录每一场对局中的每一次击杀。**

## 项目亮点

- **你的 PUBG 死亡笔记**：自动记录每一场对局中的每一次击杀，生成专属"死亡笔记"，让对手无处遁形
- **反向验证，以彼之道还施彼身**：不仅能查自己击杀了谁，还能查谁击杀过你——输入对方昵称，一键还原对局真相
- **一键分享，社交利器**：专属链接 `/n/你的昵称`，分享给好友随时查看，让战绩成为你的名片

## 客户端界面

![客户端界面](./docs/screenshot.png)

## 功能特性

- **死亡笔记生成**：自动拉取并解析 PUBG 玩家对局数据，生成完整的击杀记录汇总
- **每日增量更新**：支持断点续传，每天自动补充新对局数据
- **反向击杀查询**：在已有记录中查询自己是否被某个玩家击杀过
- **专属分享链接**：每个玩家拥有专属链接 `/n/玩家昵称`，一键复制分享给好友，随时查看自己的死亡笔记
- **日历视图**：按日期浏览击杀记录，快速定位特定对局
- **管理后台**：任务管理、数据同步、死亡笔记生成/增量更新/列表查看

## 环境要求

- Node.js >= 20
- npm >= 10
- （可选）Docker & Docker Compose

## 快速开始

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 PUBG_API_KEY_1

# 3. 初始化数据库
npx prisma migrate deploy

# 4. 启动服务
npm run start:dev
```

启动后访问：
- 客户端: `http://localhost:3000/n/玩家昵称`
- 管理后台: `http://localhost:3000/admin/`

### Docker 部署

```bash
# 1. 配置环境变量
cp .env.example .env
vim .env  # 填入 PUBG_API_KEY_1

# 2. 构建并启动
docker compose build
docker compose up -d

# 3. 查看日志
docker compose logs -f
```

数据持久化在 `./data/`、`./logs/` 和 `./game-data/` 目录。

## 项目结构

```
├── src/
│   ├── main.ts                     # 应用入口
│   ├── app.module.ts               # 根模块
│   ├── common/                     # 共享工具（守卫、验证器、日志）
│   ├── config/                     # 环境变量验证
│   ├── constants.ts                # 全局常量
│   ├── death-note/                 # 客户端模块（查询、展示）
│   ├── prisma/                     # 数据库模块
│   ├── pubg/                       # PUBG 模块（API 调用、数据解析、任务管理）
│   │   ├── pubg-match.service.ts   # 比赛数据同步与遥测重解析
│   │   ├── pubg-death-note.service.ts  # 死亡笔记生成与增量更新
│   │   ├── pubg-user.service.ts    # 玩家查询
│   │   └── pubg-task.controller.ts # 管理后台任务接口
│   ├── scheduled-task/             # 定时任务（每日增量更新）
│   └── task/                       # 任务状态管理
│       ├── task.service.ts         # 任务 CRUD 与执行
│       └── task.decorator.ts       # @ExecutableTask 装饰器
├── public/                         # 静态前端资源
│   ├── index.html                  # 客户端页面
│   ├── css/style.css
│   ├── js/app.js
│   └── admin/                      # 管理后台
│       ├── index.html
│       ├── css/style.css
│       └── js/app.js
├── prisma/
│   ├── schema.prisma               # 数据库模型
│   └── migrations/                 # 数据库迁移
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── clean.sh                        # 清理脚本
```

## 环境变量

详见 [.env.example](.env.example)。

| 变量 | 必填 | 说明 |
|------|------|------|
| `PUBG_API_KEY_1` | ✅ | PUBG 开发者 API Key |
| `PUBG_API_KEY_2` | ❌ | 备用 API Key |
| `PUBG_API_KEY_3` | ❌ | 备用 API Key |
| `PUBG_API_REGION` | ❌ | API 区域，默认 `steam` |
| `DATABASE_URL` | ✅ | SQLite 路径 |
| `PORT` | ❌ | 服务端口，默认 `3000` |
| `LOG_LEVEL` | ❌ | 日志级别，默认 `info` |
| `CACHE_TTL` | ❌ | 缓存过期时间（秒），默认 `3600` |

## 常用命令

```bash

# 重新安装依赖
npm install

# 初始化数据库
npx prisma migrate deploy

# 构建
npm run build

# 启动
npm run start:prod
```

## 许可证

MIT
