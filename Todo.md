# Route Agent Todo

## 项目定位

Route Agent 是一个个人骑行路线规划实验项目。

核心目标：

- 输入地点、骑行需求和历史记录。
- 通过 AI agent 决定路线策略。
- 调用 BRouter、Strava、海拔和 GPX 工具。
- 生成一条真实可骑的 GPX 路线。

边界：

- Route Agent 只负责生成路线和 GPX。
- Rider Tracker 负责导入 GPX、街景模拟骑行、台子骑行、FIT 导出和活动上传。

## 当前 Demo

当前已经完成一个最小 JS/Node demo：

- 浏览器地图点选起点和终点。
- 本地 `/api/route` 代理请求 BRouter 在线服务。
- 返回 GeoJSON 路线。
- 本地分析距离、爬升、下降、坡度区间、转向数量、道路/路面标签。
- 支持 `trekking`、`fastbike`、`safety`、`shortest` profile。

当前定位：

- 个人测试工具。
- 用于验证 BRouter 在线接口能否满足路线规划原型。
- 暂时不急着自部署 BRouter。

## 后端技术栈调整

后续建议将后端从 Node.js 改成 Python FastAPI。

原因：

- FastAPI 适合写轻量 JSON API。
- Python 更适合 AI agent、路线分析、GPX/FIT 处理、历史轨迹分析。
- Python 调用 Strava API、BRouter、OpenAI API、海拔 API 都很自然。
- 前端地图交互仍然保留 JavaScript/TypeScript。

建议结构：

```text
route-agent/
  backend/
    main.py
    routing/
      brouter.py
    analysis/
      route_analysis.py
    strava/
      client.py
      oauth.py
      segments.py
      history.py
    export/
      gpx.py
    storage/
      database.py
      models.py
    requirements.txt
  public/
    index.html
    app.js
    style.css
  docs/
  Todo.md
  README.md
```

第一步迁移目标：

- 用 FastAPI 替换 `server.js`。
- 保留现有 `public/` 前端。
- FastAPI 同时提供静态文件和 `/api/route`。
- 将现有路线分析逻辑迁移到 Python。
- 继续调用 BRouter 在线接口。

## BRouter 能力

当前请求方式：

```text
GET https://brouter.de/brouter
  ?lonlats=lon,lat|lon,lat
  &profile=trekking
  &alternativeidx=0
  &format=geojson
  &timode=2
```

输入：

- 起点坐标。
- 终点坐标。
- 可选中间点。
- profile，例如 `trekking`、`fastbike`、`safety`、`shortest`。

输出：

- GeoJSON 路线。
- 路线点 `[lon, lat, elevation]`。
- `track-length`。
- `filtered ascend`。
- `total-time`。
- `total-energy`。
- `voicehints`。
- `messages`，包含 `WayTags`，可解析 `highway`、`surface` 等道路标签。

使用策略：

- 个人项目可以先直接使用 BRouter 在线服务。
- 如果后续请求频率高、路线很长、或者需要稳定服务，再考虑自部署。
- 后端应该保留 routing provider 抽象，后续支持 GraphHopper、OSRM、openrouteservice。

## Strava 能力

Strava API 可以通过 Python 调用。

Route Agent 后续可以使用 Strava 做：

- OAuth 登录。
- 保存 access token 和 refresh token。
- 查询用户历史 activities。
- 查询附近热门 segments。
- 查询 segment detail。
- 查询 segment efforts。
- 将热门赛段作为路线规划候选点。
- 根据历史记录判断路线重复率和熟悉程度。

常用 API：

```text
GET /api/v3/athlete/activities
GET /api/v3/segments/{id}
GET /api/v3/segments/explore
GET /api/v3/segments/{id}/streams
GET /api/v3/segment_efforts
```

注意：

- Strava API 是 REST API，不绑定 JavaScript。
- Rider Tracker 里用 JS 是因为它当前是 Node/浏览器项目。
- Route Agent 可以用 Python FastAPI 调同样的接口。
- 两个项目暂时不需要共享代码，只需要共享设计。

## 路线规划流程

最小可行流程：

```text
用户输入地点和需求
-> AI agent 转成结构化约束
-> 查询起点坐标
-> 查询附近 Strava segments
-> 筛选 1-3 个候选赛段
-> BRouter 连接起点、赛段、中间点和终点
-> 本地评分和校验
-> 生成候选路线
-> 导出 GPX
```

结构化约束示例：

```json
{
  "start": "current_location",
  "target_distance_km": 50,
  "route_shape": "loop",
  "effort": "moderate",
  "terrain": ["light_climb"],
  "avoid": ["too_steep", "too_repetitive"],
  "prefer": ["popular_segments", "scenic_roads"]
}
```

## 评分算法

第一版先用可解释的加权评分，不做机器学习。

建议评分项：

```text
score =
  distanceFit * 0.20 +
  elevationFit * 0.15 +
  segmentValue * 0.20 +
  novelty * 0.15 +
  rideability * 0.15 +
  scenicScore * 0.10 +
  loopQuality * 0.05
```

含义：

- `distanceFit`：总距离是否接近目标。
- `elevationFit`：爬升是否符合需求。
- `segmentValue`：Strava 赛段热度和价值。
- `novelty`：和历史骑行路线的重复程度。
- `rideability`：是否适合骑行，是否有碎路、急弯、过陡、断裂。
- `scenicScore`：是否靠近水系、公园、山路、景点、绿道。
- `loopQuality`：是否形成质量好的环线，是否出门和回程重复太多。

第一版优先实现：

- 距离匹配。
- 爬升匹配。
- 历史重复率。
- Strava segment 热度。

## 历史记录使用方式

历史记录可以从 Strava activities 或本地 GPX/FIT 导入。

可以用于：

- 计算新路线和历史路线的重合度。
- 推荐没骑过但附近热门的赛段。
- 避免重复太多熟路。
- 根据过去能力估算路线难度。

重复率计算思路：

1. 将历史路线按固定距离采样。
2. 将新路线按 50-100 米采样。
3. 判断新路线采样点是否靠近历史点，例如 30 米以内。
4. 得到重复比例。
5. 根据用户需求决定重复是加分还是扣分。

## GPX 输出

Route Agent 最终产物应该是 GPX。

GPX 可用于：

- 导入码表。
- 导入 Strava。
- 导入 Rider Tracker 做街景/台子模拟骑行。

后续需要实现：

- `RoutePlan -> GPX`。
- GPX 下载按钮。
- 路线名称、描述、统计信息写入 GPX metadata。
- 可选导出 GeoJSON，方便调试。

## AI Agent 边界

大模型负责：

- 理解自然语言需求。
- 判断骑行主题，例如爬坡、沿江、休闲、训练、探索新路。
- 选择候选区域和赛段策略。
- 调用工具。
- 解释推荐路线。

传统算法负责：

- 路网路径计算。
- 多点连接。
- 路线距离和爬升计算。
- 路线评分。
- 路线合法性校验。
- GPX 生成。

不要让大模型直接生成坐标点。它应该生成结构化规划，再调用地图和路由工具。

## 近期 Todo

- [ ] 将 Node 后端迁移为 Python FastAPI。
- [ ] 保留现有 `public/` 前端，FastAPI 负责静态文件服务。
- [ ] 将 `/api/route` 迁移到 Python。
- [ ] 将距离、爬升、坡度区间、转向、道路标签分析迁移到 Python。
- [ ] 添加 GPX 导出接口。
- [ ] 支持多个 waypoint。
- [ ] 支持 loop 路线生成。
- [ ] 添加 Strava OAuth。
- [ ] 查询附近 Strava segments。
- [ ] 查询用户历史 activities。
- [ ] 实现路线评分器。
- [ ] 加入 AI agent，将自然语言需求转成路线规划约束。

