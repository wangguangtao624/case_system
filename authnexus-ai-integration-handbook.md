# AuthNexus 第三方接入：AI Agent 执行手册

> **文档用途**：供第三方团队（或其在 Cursor / Copilot 等环境中的 AI 助手）实现与 AuthNexus 的 HTTP 对接时作为**单一入口规范**。  
> **典型场景**：Web / 服务端 / 测试管理平台等业务系统接入 AuthNexus，完成**人类用户登录**与后续受保护 API 调用。  
> **权威延展**：本文压缩了契约要点；细节与变更以仓库内 `doc/authnexus-integration.md`、`doc/CLIENT-API-SPEC.md`、`doc/app-id-vs-uuid.md` 为准。

---

## 0. AI 执行约束（必读）

在生成或修改对接代码前，必须遵守：

1. **路径前缀**：所有 API 使用 **`/api` 前缀**。登录完整路径为 **`POST /api/auth/login`**，禁止使用无前缀的 `/auth/login`（易命中前端路由并返回 405 等非预期结果）。
2. **`appId` 必填**：用户登录请求体必须包含可读 **`appId` 字符串**（业务标识），不是数据库内部 UUID。缺省返回 **400**。
3. **成功状态码**：**200 与 201 均视为成功**；禁止仅判断 `status === 200`。
4. **两类主体勿混用**：**用户 JWT**（登录接口返回）与 **App JWT**（安装码 `enroll` 返回）用途不同；不要把用户 JWT 当作更新器 / `/api/software/:appId/latest` 的 App 主体使用，除非对方运维明确约定（默认不混用）。
5. **错误解析**：失败时依据 **HTTP 4xx/5xx**，解析 JSON 体的 `statusCode`、`message`（及可选 `error`）。
6. **废弃能力**：不要实现或依赖已移除的 **`POST /api/auth/app/login`**（HMAC）或加密 **`.xd`** 导出链路；更新器场景见手册第 9 节索引。

---

## 1. 对接模式选择

| 第三方需求 | 身份方式 | 本手册重点 | 延伸阅读 |
|------------|----------|------------|----------|
| 业务系统用户登录（用户名密码） | `POST /api/auth/login` → **用户 JWT** | **第 2～5 节** | `doc/authnexus-integration.md` §2.1 |
| 桌面更新器 / CLI / 非人主体访问软件发布 API | `POST /api/auth/app/enroll` → **App JWT** | 仅索引 | `doc/CLIENT-API-SPEC.md` §0～1 |
| 两者都要 | 两套 Token 分别存储与刷新 | 第 4 节区分 Bearer | `doc/guide/authnexus-api-integration.md` §2.3 |

若当前任务仅为「测试用例管理平台登录」，实现 **用户登录行** 即可。

---

## 2. 运维前置条件（调用登录前必须成立）

由 AuthNexus **管理员在控制台**完成（AI 需提示人工确认）：

- 已在 AuthNexus 中创建第三方应用，并获得可读 **`appId`**（字符串）。
- 使用该平台的用户已被 **分配到该应用**，且用户全局状态为 **ACTIVE**（挂起 / 未启用会导致 401）。
- 获知部署 **`BASE_URL`**（示例：`https://auth.example.com` 或含端口的后端地址），并与运维确认 TLS / 反代路径（网关是否剥离前缀）。

---

## 3. HTTP 通用约定

| 项 | 约定 |
|----|------|
| Base URL | `BASE_URL` + `/api/...` |
| Content-Type | `POST` JSON 接口使用 `application/json` |
| 认证头 | 受保护接口：`Authorization: Bearer <access_token>` |
| 成功码 | **200** 或 **201** |
| 错误体 | NestJS 风格 JSON：`statusCode`、`message`、可选 `error` |

---

## 4. 人类用户登录（主路径）

**Endpoint：** `POST /api/auth/login`

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码 |
| `appId` | string | **是** | 业务可读应用标识（见 `doc/app-id-vs-uuid.md`） |

示例：

```json
{
  "username": "alice",
  "password": "***",
  "appId": "your-readable-app-id"
}
```

**成功（200）：** 响应体包含 **`access_token`**（用户 JWT）、`user`、`permissions` 等（字段以实际部署为准，见 `doc/authnexus-integration.md`）。

**常见错误：**

| HTTP | 含义（简述） |
|------|----------------|
| 400 | 缺少或非法参数（含缺少 `appId`） |
| 401 | 凭证错误、用户未启用、或用户不在该应用白名单 |
| 500 | 服务端异常 |

**登录后调用业务 API：** 在后续请求加请求头：

```http
Authorization: Bearer <access_token>
```

具体哪些路由接受用户 JWT、所需权限 scope，由业务模块与控制台的 RBAC 配置决定；实现新路由时需查阅后端 Swagger/OpenAPI 或对应模块 Guard。

---

## 5. `appId` 与内部 UUID

- **登录、`enroll`、URL 中的 `:appId`（如软件最新版本接口）**：使用 **`App.appId` 可读字符串**。
- **控制台应用详情部分 REST 路径**：可能使用内部 **`App.id`（UUID）**；二者勿混淆。
- **细则**：`doc/app-id-vs-uuid.md`。

---

## 6. 可选：本地校验 JWT

若需在服务端离线校验 AuthNexus 签发的 JWT：

- `GET /api/auth/jwt-public-key` → PEM 公钥（`application/x-pem-file`）。

详见 `doc/authnexus-integration.md` §2.4。

---

## 7. 可选：用户注册

- `POST /api/auth/register` — 创建用户；成功常为 **201**。新用户可能默认为挂起，需管理员放行后方可登录（策略见 `doc/user-status-policy.md`）。

---

## 8. 实现检查清单（交付前自验）

- [ ] 所有请求路径含 **`/api`** 前缀。
- [ ] 登录 body **含 `appId`**，且与运维下发字符串一致。
- [ ] 成功判断包含 **200 与 201**。
- [ ] 失败分支解析 **`statusCode` / `message`**。
- [ ] Bearer 使用 **登录返回的 `access_token`**。
- [ ] 未误用已移除的 HMAC app 登录或 `.xd` 链路。
- [ ] 若同时集成更新器：用户 JWT 与 App JWT **分开存储**，不混用。

---

## 9. 更新器 / App JWT / 软件发布 API（索引）

若第三方还需 AxUpdater 或自动化工具访问 **`GET /api/software/:appId/latest`** 等：

- **唯一推荐**：签名 **`target_config.signed.json`** + **`POST /api/auth/app/enroll`** + 运行时 **App JWT**。  
- **完整契约与验收清单**：`doc/CLIENT-API-SPEC.md`  
- **交付与验证 SOP**：`doc/operations/updater-release-validation.md`、`doc/operations/software-auto-update-sop.md`

---

## 10. 与其它文档的关系

| 文档 | 用途 |
|------|------|
| **本文** | AI 单文件入口：约束 + 登录主路径 + 索引 |
| `doc/authnexus-integration.md` | 中文：HTTP 约定、登录/enroll/注册/公钥、错误表 |
| `doc/CLIENT-API-SPEC.md` | 英文：客户端完整契约（含更新器 enroll） |
| `doc/guide/authnexus-api-integration.md` | 中文：产品边界与集成路径总览 |
| `doc/POST-AUTH-LOGIN-405-TROUBLESHOOTING.md` | 登录 405 / 路径错误排查 |

---

## 11. 给 AI 的提示词片段（可直接粘贴）

```text
你在实现 AuthNexus 集成时：仅用 BASE_URL + /api 前缀；用户登录 POST /api/auth/login，JSON body 必须含 username、password、可读 appId 字符串；200 与 201 都算成功；失败读 HTTP 状态码与 JSON 的 message；后续请求 Authorization: Bearer access_token。不要将用户 JWT 与 App JWT（enroll）混用。更新器场景另读 CLIENT-API-SPEC。UUID 与 appId 区别见 app-id-vs-uuid。
```

---

*手册版本说明：与仓库 `doc/authnexus-integration.md` 等保持一致；若生产行为与文档不符，以实际部署与 OpenAPI 为准并请反馈维护方。*
