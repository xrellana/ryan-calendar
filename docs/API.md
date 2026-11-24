# 工作日程 & 评估项目管理平台 REST API 文档（Android 端接入指南）

- **线上地址**：`https://calendar.meowoo.net`
- **协议格式**：HTTP/HTTPS + JSON（UTF-8）
- **数据隔离**：除 `/healthz`、`/ics/*` 与全站共享的节假日表外，所有业务接口均严格按当前登录用户的 `user_id` 隔离。

---

## 1. Android 客户端接入必读

### 1.0 Android 端功能范围
Android 端**只面向普通用户**，不包含任何管理功能，**不做任何 Excel 导入/导出**，**不提供载入示例数据**，也**不做数据备份恢复、批量清空和评估规则/费率维护**。以下接口 Android 端**不接入**（仅 Web 端使用）：

| 接口 | 原因 |
| :--- | :--- |
| `/api/admin/*`（§7 全部） | 账号管理、节假日维护、服务端备份均只在 Web 端由管理员操作 |
| `POST /api/eval/projects/import` | Excel 导入评估项目（Web 端在浏览器内解析 Excel 后调用） |
| `POST /api/eval/travels/import` | Excel 导入差旅记录（同上） |
| `POST /api/events/import-ledger` | 旧版台账导入，已废弃 |
| `POST /api/events/sample` | 载入示例日程（演示用） |
| `POST /api/eval/projects/sample` | 载入示例评估项目（演示用） |
| `POST /api/backup/restore` | 日程 JSON 备份恢复 |
| `POST /api/eval/backup/restore` | 评估数据 JSON 备份恢复 |
| `DELETE /api/events` | 清空全部普通日程 |
| `DELETE /api/eval/all` | 清空全部评估数据 |
| `PUT /api/eval/settings` | 修改评估天数规则与费率表 |
| `POST /api/eval/settings/reset` | 恢复默认规则与费率 |

补充说明：
- **没有注册和找回密码**：服务端不支持自助注册，也没有找回密码接口，账号只能由管理员在 Web 端创建或重置密码。Android 登录页不要做「注册」「忘记密码」入口，最多提示「请联系管理员」。已登录用户可以在 Android 端自行修改密码（§4.5）。
- 评估规则与费率在 Android 端**只读**：通过 `GET /api/eval/state` 返回的 `settings` 做结束时间推算和费用计算（§8），不提供编辑入口。
- Excel 导出在 Web 端纯前端生成，没有对应接口，Android 端不需要实现。
- 管理员账号也可以登录 Android 端，按普通用户的功能使用即可，不显示任何管理入口。
- Android 端仍会**看到** Web 端导入的数据，包括未排期（`start == ""`）的项目和导入时 `detail` 为空的差旅记录，界面需要能正常展示这些数据。
- 管理员在 Web 端禁用账号或重置密码后，该账号在 Android 端的请求会返回 `401`，按 §1.4 处理即可。

### 1.1 认证与会话机制（Cookie）
服务端采用基于服务端 SQLite 会话表的 `HttpOnly` Cookie 认证，不使用 Bearer Token：
- 登录成功后，响应头通过 `Set-Cookie` 下发 `workcal_sid=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`。
  - `Secure` 仅在 HTTPS 请求下携带（服务端 `COOKIE_SECURE=auto` 默认行为）；本地 HTTP 联调时 Cookie 不含 `Secure`。
- 会话默认有效期 **30 天**，距上次活跃超过 **6 小时** 后任意认证请求会自动滑动续期（响应头可能再次下发 `Set-Cookie`）。
- **Android 建议**：在 `OkHttpClient` 中配置持久化 `CookieJar`（将 Cookie 持久化到 `DataStore` / `EncryptedSharedPreferences`），不要依赖内存 Cookie，避免杀进程后掉登录。

### 1.2 必填请求头（CSRF 防护）
所有**写请求**（`POST`、`PUT`、`PATCH`、`DELETE`）**必须携带**自定义请求头，否则服务端一律拦截返回 `403`：

```http
X-Requested-With: WorkCal
Accept: application/json
Content-Type: application/json   # 有 JSON 请求体时携带
```

> 建议在 OkHttp 全局 Interceptor 中对所有 `/api/*` 请求统一注入 `X-Requested-With: WorkCal` 与 `Accept: application/json`。

### 1.3 Kotlin / OkHttp 拦截器配置参考

```kotlin
val okHttpClient = OkHttpClient.Builder()
    .cookieJar(persistentCookieJar) // 持久化保存 workcal_sid
    .addInterceptor { chain ->
        val req = chain.request().newBuilder()
            .header("X-Requested-With", "WorkCal")
            .header("Accept", "application/json")
            .build()
        chain.proceed(req)
    }
    .build()
```

### 1.4 通用约定与错误码
- **请求体大小上限**：`5 MB`（超限返回 `413`）。
- **缓存控制**：所有 `/api/*` 与 `/ics/*` 响应均携带 `Cache-Control: no-store`。
- **日期格式**：统一 `YYYY-MM-DD`（如 `2026-11-24`）；时间格式 `HH:mm`（24 小时制）；时间戳为 ISO-8601 UTC 字符串。
- **错误响应体**：统一返回 JSON `{ "error": "中文错误说明", "code": "可选错误码" }`。

| HTTP 状态码 | 常见 `code` | 含义与客户端处理建议 |
| :--- | :--- | :--- |
| `200` / `201` | — | 成功 / 创建成功 |
| `400` | — | 参数校验失败或业务规则拦截（直接 Toast 展示 `error`） |
| `401` | `UNAUTHORIZED` | 未登录、Cookie 过期或账号被管理员禁用/改密下线 → 清空本地态并跳转登录页 |
| `403` | `CSRF_REJECTED` / `FORBIDDEN` | 缺少 `X-Requested-With: WorkCal` 头（`CSRF_REJECTED`）；登录接口对已禁用账号返回 `403`（无 `code`），应提示「账号已被禁用」。`FORBIDDEN` 只出现在管理员接口，Android 端不接入这些接口，正常不会遇到。已登录账号被禁用后，其他接口返回的是 `401` |
| `404` | — | 资源不存在或不属于当前登录用户 |
| `409` | — | 资源冲突（如新建账号用户名已存在） |
| `413` | — | 请求 JSON 超过 5MB 上限 |
| `429` | — | 登录失败过多触发限流（同一 IP 或账号 15 分钟内最多 10 次失败） |
| `500` / `502` | — | 服务端内部错误 / 上游节假日源拉取失败 |

---

## 2. 核心数据模型

### 2.1 User（用户）
```json
{
  "id": "usr-m8x9a1-3f2c1b0a9e",
  "username": "zhangsan",
  "displayName": "张三",
  "role": "user",
  "isActive": true,
  "icsToken": "64位十六进制私有订阅Token",
  "createdAt": "2026-11-01T08:00:00.000Z",
  "updatedAt": "2026-11-24T01:00:00.000Z",
  "lastLoginAt": "2026-11-24T01:00:00.000Z"
}
```
- `role`: `"admin"` | `"user"`

### 2.2 Category（日程类别）
```json
{
  "id": "cat-assessment",
  "name": "外出评估",
  "color": "#D97A12",
  "protected": true
}
```
- 列表返回顺序即同日取色优先级（索引 0 最高）。
- `id == "cat-assessment"`（默认名称「外出评估」）为**系统受保护类别**（`protected: true`）：不可删除，允许改名、修改 `color` 和调整排序。
- 日程与评估项目的联动只认 `id == "cat-assessment"`，不认 `name`。客户端判断、展示该类别时必须按 `id` 匹配，显示名称取自 `GET /api/state` 返回的 `categories`，不要写死「外出评估」。

### 2.3 CalendarEvent（工作日程）
```json
{
  "id": "evt-m8x9b2-a1b2c3d4e5",
  "title": "华东新能源装备（正式评估）",
  "categoryId": "cat-assessment",
  "startDate": "2026-12-13",
  "endDate": "2026-12-15",
  "allDay": true,
  "startTime": "",
  "endTime": "",
  "notes": "阶段：正式评估 | 等级：三级 | 角色：组长 | 状态：待开始 | 现场核验",
  "source": "eval",
  "evalProjectId": "p-m8x9b1-1122334455",
  "ledgerKey": "",
  "ledgerMeta": {
    "projectName": "华东新能源装备",
    "stage": "正式评估",
    "level": "三级",
    "role": "组长",
    "status": "待开始",
    "settle": "未结"
  },
  "createdAt": "2026-11-24T01:00:00.000Z",
  "updatedAt": "2026-11-24T01:00:00.000Z"
}
```
- `endDate`: 单日日程为空字符串 `""`；跨天日程为结束日期 `YYYY-MM-DD`（闭区间，含当天）。
- `source`: `"manual"`（普通手工日程）| `"eval"`（与评估项目绑定）| `"ledger"`（旧版台账导入、且类别不是 `cat-assessment` 的历史日程）。
- `evalProjectId`: 非空时表示该日程与评估项目一对一绑定；为空字符串表示普通日程。
- `ledgerKey` / `ledgerMeta`: **仅当 `source` 为 `"ledger"` 或 `"eval"` 时返回**，普通日程的响应中不含这两个字段，Android 数据模型需声明为可空。
  - 在评估项目页新建的日程 `ledgerKey` 为 `""`；由旧台账迁移而来的日程保留原 `ledgerKey`。
  - 即使 `source` 为 `"ledger"`，`ledgerMeta` 也可能缺失（库中无元数据时直接省略该字段）；旧台账日程的 `ledgerMeta` 不含 `status` / `settle`。

> **旧台账自动迁移**：服务端启动时、日程备份恢复后、旧版台账导入后，会把类别为 `cat-assessment` 且未绑定项目的旧台账日程自动转换为评估项目并绑定（`source` 随之变为 `"eval"`）。等级 / 角色 / 阶段无法识别时使用默认值（`二级` / `组员` / `预评估`），并在项目 `note` 末尾追加「（由旧版台账日程自动迁移，请核对：…）」。项目状态按日期推断（已结束 → `已完成`，进行中 → `进行中`，未开始 → `待开始`），结算状态统一为 `未结`。

### 2.4 EvalProject（评估项目记录）
```json
{
  "id": "p-m8x9b1-1122334455",
  "name": "华东新能源装备",
  "level": "三级",
  "role": "组长",
  "stage": "正式评估",
  "start": "2026-12-13",
  "end": "2026-12-15",
  "status": "待开始",
  "settle": "未结",
  "note": "现场核验",
  "feeManual": null,
  "createdAt": "2026-11-24T01:00:00.000Z",
  "updatedAt": "2026-11-24T01:00:00.000Z"
}
```
**枚举全集**：
- `level`: `"一级"` | `"二级"` | `"三级"` | `"四级"`
- `role`: `"组员"` | `"组长"`
- `stage`: `"预评估"` | `"正式评估"`
- `status`: `"待开始"` | `"进行中"` | `"已提交"` | `"已完成"`
- `settle`: `"未结"` | `"已结"`
- `feeManual`: `Double?`，`null` 表示按规则自动计费；非 `null` 表示人工改写费用（保留两位小数，不随费率表变化）。传入负数或非数字时服务端静默按 `null` 处理，不报错。
- `start` 可为空字符串 `""`（未排期项目，仅能通过导入、备份恢复或 `allowUnscheduled` 产生），此时不生成工作日程。

### 2.5 EvalTravel（项目差旅记录）
```json
{
  "id": "t-m8x9c3-9988776655",
  "date": "2026-12-13",
  "name": "华东新能源装备",
  "stage": "正式评估",
  "level": "三级",
  "planStart": "2026-12-13",
  "planEnd": "2026-12-15",
  "planText": "2026/12/13 ~ 2026/12/15",
  "cat": "自定义",
  "catCustom": "机场停车费",
  "amount": 326.5,
  "detail": "T2航站楼停车三天",
  "reimb": "未报",
  "createdAt": "2026-11-24T01:00:00.000Z",
  "updatedAt": "2026-11-24T01:00:00.000Z"
}
```
**枚举全集**：
- `cat`: `"打车"` | `"高铁"` | `"飞机"` | `"自驾"` | `"住宿"` | `"餐饮"` | `"自定义"`（选 `"自定义"` 时 `catCustom` 必填）
  - 传入不在列表中的非空值时，服务端会自动改为 `"自定义"`，并把原值（截断至 40 字）写入 `catCustom`；传空则默认为 `"打车"`。
- `reimb`: `"未报"` | `"已报"` | `"已结"`

### 2.6 EvalSettings（基础规则设置）
```json
{
  "daysRules": {
    "一级": { "预评估": null, "正式评估": 2 },
    "二级": { "预评估": 1, "正式评估": 2 },
    "三级": { "预评估": 2, "正式评估": 3 },
    "四级": { "预评估": 2, "正式评估": 4 }
  },
  "feeRates": {
    "一级": { "组员": null, "组长": null },
    "二级": { "组员": 1000, "组长": 2000 },
    "三级": { "组员": 1250, "组长": 3000 },
    "四级": { "组员": null, "组长": null }
  }
}
```

---

## 3. 健康检查与日历订阅（无需登录）

### 3.1 服务健康检查
- **GET** `/healthz`
- **响应 `200`**：`{ "ok": true }`（数据库异常返回 `503 { "ok": false }`）

### 3.2 私有 `.ics` 日历订阅
- **GET** `/ics/:token.ics`（兼容不带 `.ics` 后缀）
- **说明**：供系统日历订阅，不走 Cookie，凭用户专属 `icsToken` 访问；包含用户全部工作日程（含评估项目联动生成的日程）。
- **响应 `200`**：`Content-Type: text/calendar; charset=utf-8`（Token 无效或账号已禁用返回 `404`）。

---

## 4. 账号认证与个人中心 (`/api/auth`)

### 4.1 获取当前登录态
- **GET** `/api/auth/me`
- **是否需要登录**：否（未登录返回 `user: null`，不返回 401）
- **响应 `200`**：`{ "user": User | null }`

### 4.2 账号密码登录
- **POST** `/api/auth/login`
- **请求体**：
  ```json
  { "username": "zhangsan", "password": "your_password" }
  ```
- **响应 `200`**：`Set-Cookie: workcal_sid=...` + `{ "user": User }`
- **错误**：`400` 参数空 / `401` 账号或密码错误 / `403` 账号已禁用 / `429` 触发限流

### 4.3 退出登录
- **POST** `/api/auth/logout`
- **响应 `200`**：清除服务端会话与 Cookie，返回 `{ "ok": true }`

### 4.4 修改个人显示名称
- **PUT** `/api/auth/profile`（需登录）
- **请求体**：`{ "displayName": "张三" }`（非空，最长 32 字）
- **响应 `200`**：`{ "user": User }`

### 4.5 修改登录密码
- **PUT** `/api/auth/password`（需登录）
- **请求体**：`{ "currentPassword": "old", "newPassword": "new_password" }`（新密码 6~100 位）
- **说明**：修改成功后自动下线该账号在**其他设备**上的全部旧会话，保留当前设备会话。
- **响应 `200`**：`{ "ok": true }`

### 4.6 重置 `.ics` 订阅链接 Token
- **POST** `/api/auth/ics-token/reset`（需登录）
- **请求体**：`{}`
- **响应 `200`**：`{ "icsToken": "新64位Token" }`（旧订阅链接立即失效）

---

## 5. 工作日程与类别 (`/api`)

> 以下接口均**需要登录**。

### 5.1 获取完整日历状态
- **GET** `/api/state`
- **响应 `200`**：
  ```json
  {
    "version": 1,
    "categories": [ /* Category[] */ ],
    "events": [ /* CalendarEvent[] */ ],
    "updatedAt": "2026-11-24T01:00:00.000Z"
  }
  ```
- **同步提示**：`updatedAt` 聚合了 `events`、`categories`、`eval_projects`、`eval_travels`、`eval_settings` 的最新修改时间，可用于客户端轮询/切前台增量判断。

### 5.2 获取法定节假日与调休（全站共享）
- **GET** `/api/holidays`
- **响应 `200`**：
  ```json
  {
    "years": [2024, 2025, 2026, 2027],
    "yearMeta": [{ "year": 2026, "source": "builtin", "syncedAt": "..." }],
    "entries": [
      { "date": "2026-01-01", "year": 2026, "type": "holiday", "name": "元旦", "source": "builtin", "updatedAt": "..." },
      { "date": "2026-01-04", "year": 2026, "type": "workday", "name": "元旦调休上班", "source": "builtin", "updatedAt": "..." }
    ]
  }
  ```
- `type`: `"holiday"`（休）| `"workday"`（调休班）

### 5.3 类别管理
| 方法 | 路径 | 请求体 | 响应 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/categories` | `{ "name": "内部评审", "color": "#7C3AED" }` | `201 { "category", "categories" }` | `name` 最长 20 字，`color` 支持 `#RGB/#RRGGBB` |
| `PATCH` | `/api/categories/:id` | `{ "name"?: "...", "color"?: "#..." }` | `200 { "category", "categories" }` | 名称去空格后不能为空（返回 `400`）；`cat-assessment` 允许改名与改色，联动不受影响 |
| `DELETE` | `/api/categories/:id` | — | `200 { "ok": true, "categories" }` | `cat-assessment` 禁止删除（返回 `400`） |
| `PUT` | `/api/categories/reorder` | `{ "orderedIds": ["cat-1", "cat-2", ...] }` | `200 { "categories" }` | 按数组顺序重排同日优先级 |

### 5.4 新建普通日程
- **POST** `/api/events`
- **注意**：在 Android 端如果用户选择类别为 **`cat-assessment`（外出评估）**，**不要调用此接口**，应切换为评估项目表单并调用 `POST /api/eval/projects`（服务端会事务双写项目与日程）。
- **请求体**：
  ```json
  {
    "title": "项目汇报会",
    "categoryId": "cat-consulting",
    "startDate": "2026-11-26",
    "endDate": "",
    "allDay": false,
    "startTime": "09:30",
    "endTime": "11:30",
    "notes": "三楼会议室"
  }
  ```
  - `title` 必填（最长 60 字）；`startDate` 必填；`endDate` 可空或 `>= startDate`（等于 `startDate` 自动归一为空）；`allDay` 默认 `true`；`notes` 最长 500 字。
- **响应 `201`**：`{ "event": CalendarEvent }`

### 5.5 编辑普通日程
- **PATCH** `/api/events/:id`
- **请求体**：同新建（仅传需修改的字段）
- **响应 `200`**：`{ "event": CalendarEvent }`
- **评估项目关联日程（`evalProjectId` 非空）**：
  - 客户端应优先打开评估项目编辑页，并调用 `PATCH /api/eval/projects/:evalProjectId`。若本地找不到该项目，先重新拉取 `GET /api/eval/state` 再判断。
  - 本接口对关联日程**只允许修改 `startDate` / `endDate`**，服务端会把新日期回写到评估项目（单日日程的 `endDate` 为空时，项目 `end` 按 `startDate` 处理），再重新生成日程的标题与备注。响应额外带 `"evalProjectUpdated": true`，客户端应随后刷新评估数据。
  - 修改 `categoryId` → `400 评估项目关联日程不可更改类别`。
  - 修改 `title`、`notes` 或把 `allDay` 改为 `false` → `400 评估项目关联日程的标题、备注与时段请在评估项目中修改`。
  - 若关联的项目已不存在（历史脏数据），按普通日程处理。

### 5.6 删除单条日程（支持联动双删）
- **DELETE** `/api/events/:id`
- **联动行为**：若该日程绑定了 `evalProjectId`，服务端会在同一事务内**同步删除对应的评估项目记录**（历史差旅支出保留）。客户端删除前应检查 `event.evalProjectId` 并在确认弹窗中提示用户。
- **响应 `200`**：
  ```json
  { "ok": true, "deletedEvalProjectId": "p-xxxx 或空字符串" }
  ```

### 5.7 清空普通日程
- **DELETE** `/api/events`（**仅 Web 端**，Android 端不接入，见 §1.0）
- **说明**：仅清空非评估关联的普通日程（`eval_project_id == ''`），自动跳过评估项目联动日程以保护台账。
- **响应 `200`**：`{ "ok": true, "deleted": 12, "skippedEvalCount": 5 }`

### 5.8 加载示例日程 / 备份恢复
- **POST** `/api/events/sample`（**仅 Web 端**，Android 端不接入，见 §1.0）：请求体 `{ "year": 2026, "month": 11 }` → 响应 `200 { "count": 6, "state": CalendarState }`
- **POST** `/api/backup/restore`（**仅 Web 端**，Android 端不接入，见 §1.0）：
  - 请求体：`{ "mode": "replace" | "merge", "categories": [...], "events": [...] }`（`mode` 缺省为 `replace`；类别上限 200，日程上限 10000）
  - 响应 `200`：`{ "categories": 4, "events": 10, "skippedEvalEvents": 2, "state": CalendarState }`
  - `replace` 模式：清空当前类别与普通日程后导入；评估项目关联日程保留不动，受保护类别 `cat-assessment` 恢复后自动补齐。
  - 备份中带 `evalProjectId` 的日程**一律跳过**（计入 `skippedEvalEvents`），因为它们由评估数据生成；评估数据请通过 `POST /api/eval/backup/restore` 恢复。
  - 备份中类别为 `cat-assessment` 的旧台账日程，恢复后会自动迁移为评估项目（见 §2.3）。

### 5.9 旧版台账导入（已废弃）
- **POST** `/api/events/import-ledger`
- **说明**：旧版 Web 端「导入台账」使用的接口，仍可调用，仅为兼容保留。**Android 端不接入**（见 §1.0）；Web 端已改用 `POST /api/eval/projects/import`。
  - 导入后，类别为 `cat-assessment` 的条目会立即迁移为评估项目；按 `ledgerKey` 匹配到已迁移的日程时，只把日期回写到对应项目。

---

## 6. 评估项目管理平台 (`/api/eval`)

> 以下接口均**需要登录**，严格按当前用户 `user_id` 隔离。
> 涉及项目变更的接口都会**自动同步工作日程**，并在响应中同时返回最新的 `evalState` 与 `calendarState`，Android 端可直接用响应刷新两个模块的本地状态。

### 6.1 获取评估平台完整状态（触发自动推进）
- **GET** `/api/eval/state?today=2026-11-24`
- **Query 参数**：`today`（可选，`YYYY-MM-DD`，建议传设备本地当天日期，缺省按服务端东八区日期）。
- **自动规则**：拉取时自动把当前用户所有 `status == "待开始"` 且 `start <= today` 的项目单向推进为 `"进行中"` 并同步关联日程。
  - 该推进**不仅在本接口触发**：所有在响应中返回 `evalState` 的写接口都会按请求里的 `today` 再执行一次。建议 Android 端对所有 `/api/eval/*` 请求都传 `today`（Query 或 JSON 体均可），否则按服务端东八区日期计算。
- **响应 `200`**：
  ```json
  {
    "projects": [ /* EvalProject[] */ ],
    "travels": [ /* EvalTravel[] */ ],
    "settings": { /* EvalSettings */ },
    "mergeNames": true,
    "updatedAt": "2026-11-24T01:00:00.000Z"
  }
  ```

### 6.2 新建评估项目（自动同步工作日程）
- **POST** `/api/eval/projects`
- **请求体**：
  ```json
  {
    "name": "华东新能源装备有限公司",
    "level": "三级",
    "role": "组长",
    "stage": "正式评估",
    "start": "2026-12-13",
    "end": "2026-12-15",
    "status": "待开始",
    "settle": "未结",
    "note": "现场核验",
    "feeManual": null,
    "today": "2026-11-24"
  }
  ```
  - 必填：`name`、`level`、`role`、`stage`、`start`；若提供 `end`，必须满足 `end >= start`。
  - `feeManual`：若传入数值恰好等于当前规则计算费用（差值 `< 0.005`），服务端会自动存为 `null`（不标「改」）。
- **联动行为**：自动在工作日程创建全天日程，类别固定 `cat-assessment`（「外出评估」），标题为 `${name}（${stage}）`。
- **响应 `201`**：
  ```json
  {
    "project": { /* EvalProject */ },
    "event": { /* CalendarEvent | null */ },
    "evalState": { /* 完整 EvalState */ },
    "calendarState": { /* 完整 CalendarState */ }
  }
  ```

### 6.3 编辑评估项目 / 合并态整组改状态
- **PATCH** `/api/eval/projects/:id`
- **用法 A — 常规字段更新**：传任意要修改的字段（如 `name`、`level`、`role`、`stage`、`start`、`end`、`status`、`settle`、`note`、`feeManual`、`today`）。
  - `start` 变更：自动更新对应的工作日程。
  - **清空 `start`（改为未排期）必须同时传 `"allowUnscheduled": true`**，否则返回 `400 开始时间不能为空`。清空后服务端会删除对应的工作日程：
    ```json
    { "start": "", "end": "", "allowUnscheduled": true, "today": "2026-11-24" }
    ```
  - 对本来就未排期的项目，只要不传 `start`，即可修改其他字段（如行内改状态）。
- **用法 B — 合并态项目整体改状态**：
  ```json
  { "status": "已完成", "syncGroupStatus": true, "today": "2026-11-24" }
  ```
  - 服务端会将**同名项目的所有阶段记录**统一设为该状态并同步对应日程。
- **响应 `200`**：
  - 常规更新：`{ "project", "event", "evalState", "calendarState" }`
  - 整组改状态：`{ "project", "affectedCount": 2, "evalState", "calendarState" }`

### 6.4 批量更新项目状态 / 费用状态
- **POST** `/api/eval/projects/batch`
- **请求体**（`status` 与 `settle` 至少传一个）：
  ```json
  {
    "ids": ["p-1", "p-2"],
    "status": "已完成",
    "settle": "已结",
    "today": "2026-11-24"
  }
  ```
- **响应 `200`**：`{ "updatedCount": 2, "projectCount": 1, "evalState", "calendarState" }`

### 6.5 删除评估项目（同步删除关联日程）
- **DELETE** `/api/eval/projects/:id?today=2026-11-24`
- **说明**：同步删除工作日程中绑定的日程记录；不删除该项目的历史差旅记录。
- **响应 `200`**：`{ "ok": true, "evalState", "calendarState" }`

### 6.6 批量导入评估项目 / 载入示例项目
- **POST** `/api/eval/projects/import`（**仅 Web 端**，Android 端不接入，见 §1.0）
  - 请求体：`{ "mode": "append" | "replace", "items": [ /* EvalProject 输入数组，允许 start 为空(未排期) */ ], "today": "2026-11-24" }`
  - 去重规则（`append` 模式）：按 `name + stage + start` 签名去重。单次上限 3000 条。
  - 响应 `200`：`{ "imported": 5, "skippedDup": 1, "mode": "append", "evalState", "calendarState" }`
- **POST** `/api/eval/projects/sample`（**仅 Web 端**，Android 端不接入，见 §1.0）
  - 请求体：`{ "today": "2026-11-24" }`
  - 写入 7 条演示记录（含 2 个双阶段项目）并自动同步日程。
  - **不去重**：每次调用都会再追加 7 条。
  - 响应 `200`：`{ "count": 7, "evalState", "calendarState" }`；示例数据校验失败时返回 `400`。

### 6.7 项目差旅 CRUD 与批量操作
| 方法 | 路径 | 请求体 | 响应 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/eval/travels` | `{ date, name, stage, level?, planStart?, planEnd?, planText?, cat, catCustom?, amount, detail, reimb }` | `201 { "travel", "evalState" }` | `amount > 0`（自动保留 2 位小数）；`detail` 必填；`cat=="自定义"` 时 `catCustom` 必填 |
| `PATCH` | `/api/eval/travels/:id` | 任意待更新字段（行内改报销状态仅传 `{ "reimb": "已报" }`） | `200 { "travel", "evalState" }` | — |
| `POST` | `/api/eval/travels/batch` | `{ "ids": ["t-1", "t-2"], "reimb": "已结" }` | `200 { "updatedCount", "evalState" }` | — |
| `DELETE` | `/api/eval/travels/:id` | — | `200 { "ok": true, "evalState" }` | — |
| `POST` | `/api/eval/travels/import` | `{ "mode": "append" \| "replace", "items": [...] }` | `200 { "imported", "skippedDup", "mode", "evalState" }` | **仅 Web 端**（Excel 导入），Android 端不接入；按 6 字段签名去重，上限 5000 笔，导入允许 `detail` 为空 |

### 6.8 基础数据设置、偏好、JSON 备份恢复与清空
| 方法 | 路径 | 请求体 | 响应 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `PUT` | `/api/eval/settings` | `{ "daysRules": {...}, "feeRates": {...} }` | `200 { "settings", "evalState" }` | **仅 Web 端**；保存天数规则与费率表 |
| `POST` | `/api/eval/settings/reset` | `{}` | `200 { "settings", "evalState" }` | **仅 Web 端**；恢复默认规则与费率 |
| `PUT` | `/api/eval/preferences` | `{ "mergeNames": true }` | `200 { "mergeNames": true }` | 保存「合并同名项目」开关 |
| `POST` | `/api/eval/backup/restore` | `{ "projects": [...], "travels": [...], "settings": {...}, "mergeNames"?: true, "today"?: "..." }` | `200 { "projects", "travels", "evalState", "calendarState" }` | **仅 Web 端**；覆盖恢复评估数据并重同步评估日程（不影响其他类别日程） |
| `DELETE` | `/api/eval/all?today=...` | — | `200 { "ok": true, "evalState", "calendarState" }` | **仅 Web 端**；清空全部项目与差旅、重置默认设置并移除评估关联日程 |

---

## 7. 管理员后台 (`/api/admin`)（仅 Web 端，Android 端不接入）

> **Android 端不实现本节任何接口**，这里只作为 Web 端参考保留。
> 以下接口要求当前用户 `role == "admin"`，否则返回 `403 FORBIDDEN`。

| 方法 | 路径 | 请求体 / 参数 | 响应 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/users` | — | `200 { "users": [...] }` | 附带 `eventCount` 与 `categoryCount` |
| `POST` | `/api/admin/users` | `{ "username", "displayName"?, "password"?, "role"?: "user"\|"admin" }` | `201 { "user", "initialPassword" }` | `password` 留空则自动生成强密码 |
| `PATCH` | `/api/admin/users/:id` | `{ "displayName"?, "role"?, "isActive"? }` | `200 { "user" }` | 禁用账号会立即销毁其全部会话；不可禁用自己或最后一个管理员 |
| `POST` | `/api/admin/users/:id/reset-password` | `{ "password"?: "" }` | `200 { "ok": true, "username", "password" }` | 留空自动生成并下线该账号全部旧会话 |
| `DELETE` | `/api/admin/users/:id` | — | `200 { "ok": true }` | 级联删除该用户所有日程与评估数据 |
| `GET` | `/api/admin/holidays` | — | `200 HolidayPayload` | 查看已入库节假日 |
| `POST` | `/api/admin/holidays/sync` | `{ "year": 2027, "overwriteManual"?: false }` | `200 { "summary", "holidays" }` | 从开源源 `holiday-cn` 同步整年节假日 |
| `PUT` | `/api/admin/holidays/:date` | `{ "type": "holiday"\|"workday", "name": "元旦" }` | `200 { "holidays" }` | 手工增改单日休/班 |
| `DELETE` | `/api/admin/holidays/:date` | — | `200 { "holidays" }` | 删除单日配置 |
| `GET` | `/api/admin/backups` | — | `200 { "dbSize", "backups": [...] }` | 列出服务端 SQLite 快照 |
| `POST` | `/api/admin/backups` | `{}` | `201 { "backup", "backups" }` | 立即创建热备份 |
| `GET` | `/api/admin/backups/download` | `?file=calendar_YYYYMMDD_HHMMSS.db`（可选） | 二进制 `.db` 文件流 | 不传 `file` 则实时生成最新快照下载 |

---

## 8. Android 端本地计算与交互规范速查

为保证 Android 端与 Web 端体验及统计口径 100% 一致，客户端表单预览与本地统计请遵循以下规则（与仓库内 [`js/eval-core.js`](../js/eval-core.js) 完全一致）：

1. **结束时间自动推算**：`end = start + (ruleDays - 1)`（按自然日顺延，不剔周末与节假日；`ruleDays == null` 时留空不推算）。
2. **评估天数**：`days = (end - start) + 1`（自然日含首尾；缺失任一端或 `end < start` 时为 `0`）。
3. **评估费用双口径**：
   - 若 `feeManual != null`：直接取 `feeManual`，与规则值差值 `>= 0.005` 时展示「改」标记。
   - 若 `feeManual == null` 且对应 `feeRates[level][role] == null`：费用为空，界面展示 **「待设置」**，不计入费用合计并单独计数。
   - 否则：`fee = round2(days * rate)`（`days == 0` 时为 `0.00`）。
4. **工作日程 ↔ 评估项目客户端路由**：
   - 日程页「新建日程」选类别为 `cat-assessment`（默认名称「外出评估」，用户可改名）→ 切换为评估项目表单，保存调用 `POST /api/eval/projects`。
   - 日程页点击已有日程编辑：若 `event.evalProjectId` 非空 → 直接打开评估项目编辑表单，保存调用 `PATCH /api/eval/projects/:evalProjectId`（锁定类别不可切换）。本地评估数据里找不到该项目时，先刷新 `GET /api/eval/state` 再打开；日历上直接改日期可走 `PATCH /api/events/:id`（见 §5.5）。
   - 日程页删除已有日程：若 `event.evalProjectId` 非空 → 二次确认提示“将同步删除评估项目列表中的对应记录（历史差旅保留）”，确认后调用 `DELETE /api/events/:id` 并从本地移除 `deletedEvalProjectId`。
5. **时间统计三口径（不可混用）**：
   - **项目列表时间筛选 / 近期评估窗口**：区间交集（与所选区间有任意一天重叠即命中；未排期不命中）。
   - **月度评估费用分布**：按项目 `start` 所在月份整笔归属。
   - **月度评估天数分布 / 本月评估天数**：按项目区间与每个自然月的**实际重叠自然日数**拆分。
6. **合并同名项目口径**：
   - 组内排序固定：`预评估` 在前、`正式评估` 在后。
   - 合并态项目整体状态：有 `正式评估` 取 `正式评估` 状态，否则取 `预评估` 状态；修改状态时传 `syncGroupStatus: true` 同步整组。
   - 合并态展示：项目名称整组合并；`level` / `role` 仅在组内全部记录取值一致时合并，不一致时逐行展示。
7. **项目数统计口径**：凡是展示「项目数」的地方，一律按项目 `name` 去重计数，同一项目的 `预评估` 与 `正式评估` 只算一个项目；评估天数、评估费用仍按每条记录累加。
   - 适用于：项目列表 KPI、评估费用统计的项目数 / 未结项目数 / 费率待设置项目数 / 分组表项目数、评估天数统计的今日在评估项目 / 窗口内评估项目 / 月度涵盖项目数、差旅的项目数。
   - 未结项目数：该名称下任一记录 `settle == "未结"` 即计入；费率待设置项目数同理。
8. **差旅联动规则**：
   - 选择已有项目名后，按 `|travel.date - project.start|` 距离自动选中最近阶段，并带出该阶段的 `level` 与评估计划区间；允许输入未登记的新项目名称。
