# Route Agent Demo

一个最小路线规划 demo：在地图上选择起点和终点，调用 BRouter 在线服务生成骑行路线，并在本地分析路线距离、爬升、坡度区间和转向数量。

## 运行

```bash
npm start
```

打开：

```text
http://localhost:8799
```

## 当前能力

- 地图点选起点和终点。
- 调用 BRouter `/brouter` 接口生成 GeoJSON 路线。
- 支持 `trekking`、`fastbike`、`safety`、`shortest` profile。
- 计算路线距离、爬升、下降、最高海拔、最大坡度、平均坡度。
- 识别连续爬坡、下坡和平路区间。
- 根据路线几何估算直走、左转、右转、急转数量。
- 如果 BRouter 返回路面/道路标签，会汇总出现次数；否则显示暂无路面数据。

## 说明

BRouter 是 OSM 路由引擎，在线接口适合 demo 和验证。后续如果要稳定使用，可以自部署 BRouter，或者把 routing provider 抽象出来，支持 BRouter、GraphHopper、OSRM 等多种后端。

