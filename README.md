# PUBG Death Note Backend

PUBG 死亡笔记后端服务，基于 NestJS + Prisma + SQLite 构建。

## 功能特性

- 自动拉取并解析 PUBG 玩家对局数据
- 生成玩家"死亡笔记"（击杀记录汇总）
- 每日增量更新，支持断点续传
- 面向客户端的 RESTful API
- 移动端友好的前端页面
- 多 API Key 轮询，提高并发能力

## 环境要求

- Node.js >= 20
- npm >= 10
- （可选）Docker & Docker Compose

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 PUBG_API_KEY_1
```

### 3. 初始化数据库

```bash
npx prisma migrate deploy
```

### 4. 启动服务

```bash
# 开发模式（热重载）
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

服务启动后访问：
- API: `http://localhost:3000/api/v1`
- 前端: `http://localhost:3000/n/玩家昵称`

## Docker 部署

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 PUBG_API_KEY_1
```

### 2. 构建并启动

```bash
docker compose build
docker compose up -d
```

### 3. 查看日志

```bash
docker compose logs -f
```

### 4. 停止服务

```bash
docker compose down
```

数据持久化在 `./data/`、`./logs/` 和 `./game-data/` 目录。

### 从镜像部署

如果你已经下载了镜像：

```bash
# 加载镜像（如果是 tar 文件）
docker load -i pubg-death-note.tar

# 配置环境变量
cp .env.example .env
vim .env  # 填入 PUBG_API_KEY_1

# 启动
docker compose up -d
```

## 项目结构

```
├── src/
│   ├── main.ts                     # 应用入口
│   ├── common/                     # 共享工具
│   │   ├── cache.utils.ts          # 内存缓存
│   │   ├── error.utils.ts          # 错误处理
│   │   ├── logging.utils.ts        # 日志格式
│   │   ├── validation.utils.ts     # 输入验证
│   │   └── dual-output-logger.service.ts
│   ├── config/
│   │   └── env.validation.ts       # 环境变量验证
│   ├── constants.ts                # 全局常量
│   ├── death-note/                 # 客户端模块（查询、展示）
│   ├── prisma/                     # 数据库模块
│   ├── pubg/                       # 管理模块（API 调用、数据解析）
│   ├── scheduled-task/             # 定时任务
│   └── task/                       # 任务状态管理
├── public/                         # 静态前端资源
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── prisma/
│   ├── schema.prisma               # 数据库模型
│   └── migrations/                 # 数据库迁移
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── clean.sh                        # 清理脚本
```

## API 接口

### 死亡笔记

| 接口 | 说明 |
|------|------|
| `GET /api/v1/death-note/nickname/:nickname` | 获取用户死亡笔记状态 |
| `GET /api/v1/death-note/nickname/:nickname/matches?page=1&pageSize=10` | 分页获取死亡笔记（按天分组） |
| `GET /api/v1/death-note/nickname/:nickname/victim/:victimNickname` | 查询受害者被击杀记录 |
| `GET /api/v1/death-note/i18n/game-data` | 获取游戏数据翻译对照表 |
| `POST /api/v1/death-note/nickname/:nickname/generate` | 请求生成死亡笔记 |

### 对局管理

| 接口 | 说明 |
|------|------|
| `GET /api/v1/pubg/match/:matchId` | 获取对局详情 |
| `GET /api/v1/pubg/user/:nickname` | 搜索玩家 |

### 任务管理

| 接口 | 说明 |
|------|------|
| `GET /api/v1/pubg/tasks` | 获取任务列表 |
| `GET /api/v1/pubg/tasks/:taskId` | 获取任务状态 |

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
# 清理项目（编译产物、依赖、数据库、日志、游戏数据）
./clean.sh

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

UNLICENSED
